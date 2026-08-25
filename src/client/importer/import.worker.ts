/// <reference lib="webworker" />

import {
  BlobReader,
  BlobWriter,
  ZipReader,
  type FileEntry,
} from "@zip.js/zip.js";

import { attachSensorSeries, normalizeWorkouts, parseCyclingWorkouts, parseGpx } from "./parser";
import { isHealthExportXml, isWorkoutRouteGpx } from "./zipEntries";

type WorkerRequest = { type: "parse"; file: File };

function progress(stage: string, value: number, detail: string) {
  self.postMessage({ type: "progress", stage, value, detail });
}

async function consumeEntry<T>(
  entry: FileEntry,
  consume: (stream: ReadableStream<Uint8Array>) => Promise<T>,
  onProgress: (value: number) => void,
) {
  const bridge = new TransformStream<Uint8Array, Uint8Array>();
  const consumed = consume(bridge.readable);
  const extracted = entry.getData(bridge.writable, {
    onprogress: (index, max) => onProgress(max ? index / max : 0),
  });
  const [result] = await Promise.all([consumed, extracted]);
  return result;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type !== "parse") return;
  const zipReader = new ZipReader(new BlobReader(event.data.file));
  try {
    progress("zip", 0.03, "Abriendo la exportación…");
    const entries = await zipReader.getEntries();
    const xmlEntry = entries.find(
      (entry): entry is FileEntry => !entry.directory && isHealthExportXml(entry.filename),
    );
    if (!xmlEntry) throw new Error("El ZIP no contiene export.xml ni exportación.xml.");
    progress("workouts", 0.08, "Buscando entrenamientos ciclistas…");
    const workouts = await consumeEntry(
      xmlEntry,
      (stream) => parseCyclingWorkouts(stream),
      (value) => progress("workouts", 0.08 + value * 0.25, "Leyendo entrenamientos…"),
    );
    if (!workouts.length) throw new Error("No se encontraron entrenamientos de ciclismo.");
    await consumeEntry(
      xmlEntry,
      (stream) => attachSensorSeries(stream, workouts),
      (value) => progress("sensors", 0.33 + value * 0.27, "Relacionando sensores y entrenamientos…"),
    );
    const routeEntries = entries.filter(
      (entry): entry is FileEntry =>
        !entry.directory && isWorkoutRouteGpx(entry.filename),
    );
    const routes = [];
    for (let index = 0; index < routeEntries.length; index += 1) {
      const entry = routeEntries[index];
      const blob = await entry.getData(new BlobWriter("application/gpx+xml"));
      const route = await parseGpx(blob);
      if (route.length) routes.push(route);
      progress(
        "routes",
        0.6 + ((index + 1) / Math.max(routeEntries.length, 1)) * 0.32,
        `Leyendo rutas GPS ${index + 1}/${routeEntries.length}…`,
      );
    }
    progress("normalize", 0.94, "Calculando métricas y preparando la vista previa…");
    const result = normalizeWorkouts(workouts, routes);
    self.postMessage({ type: "complete", ...result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "No se pudo procesar la exportación.",
    });
  } finally {
    await zipReader.close();
  }
};
