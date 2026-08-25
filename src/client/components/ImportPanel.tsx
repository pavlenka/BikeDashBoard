import { useEffect, useRef, useState } from "react";

import type { ImportPreview, NormalizedCyclingActivityV1 } from "../../shared/contracts";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";

interface WorkerProgress {
  stage: string;
  value: number;
  detail: string;
}

export function ImportPanel({ onImported }: { onImported: () => void }) {
  const workerRef = useRef<Worker | null>(null);
  const [progress, setProgress] = useState<WorkerProgress | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [activities, setActivities] = useState<NormalizedCyclingActivityV1[]>([]);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);

  useEffect(() => () => workerRef.current?.terminate(), []);

  function parse(file: File) {
    workerRef.current?.terminate();
    setError("");
    setPreview(null);
    setActivities([]);
    setProgress({ stage: "zip", value: 0.01, detail: "Preparando la exportación…" });
    const worker = new Worker(new URL("../importer/import.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event) => {
      if (event.data.type === "progress") setProgress(event.data);
      if (event.data.type === "complete") {
        setProgress(null);
        setPreview(event.data.preview);
        setActivities(event.data.activities);
        worker.terminate();
      }
      if (event.data.type === "error") {
        setProgress(null);
        setError(event.data.message);
        worker.terminate();
      }
    };
    worker.onerror = () => {
      setProgress(null);
      setError("El navegador no pudo procesar el archivo.");
      worker.terminate();
    };
    worker.postMessage({ type: "parse", file });
  }

  async function sync() {
    if (!preview || !activities.length) return;
    setSyncing(true);
    setError("");
    try {
      const run = await api<{ id: string }>("/api/imports", {
        method: "POST",
        body: JSON.stringify({ expectedCount: activities.length, warnings: preview.warnings }),
      });
      for (let index = 0; index < activities.length; index += 5) {
        const batch = activities.slice(index, index + 5);
        await api(`/api/imports/${run.id}/activities`, {
          method: "POST",
          body: JSON.stringify({ activities: batch }),
        });
        setProgress({
          stage: "sync",
          value: Math.min((index + batch.length) / activities.length, 0.99),
          detail: `Sincronizando ${index + batch.length}/${activities.length} salidas…`,
        });
      }
      await api(`/api/imports/${run.id}/finalize`, { method: "POST", body: "{}" });
      setActivities([]);
      setPreview(null);
      setProgress(null);
      onImported();
    } catch {
      setError("La sincronización se interrumpió. El dashboard anterior sigue intacto.");
      setProgress(null);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="import-page">
      <header className="page-heading">
        <p className="eyebrow">Actualizar datos</p>
        <h1>Trae tus salidas desde Apple Fitness</h1>
        <p>Selecciona la exportación completa de Salud. El ZIP se procesa en este Mac; solo las rutas y métricas ciclistas viajarán al VPS.</p>
      </header>

      <label className={`drop-zone ${progress ? "drop-zone--busy" : ""}`}>
        <input type="file" accept=".zip,application/zip" disabled={Boolean(progress) || syncing} onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) parse(file);
          event.target.value = "";
        }} />
        <span className="drop-zone__icon" aria-hidden="true">↥</span>
        <strong>{progress ? progress.detail : "Seleccionar export.zip"}</strong>
        <small>{progress ? `${Math.round(progress.value * 100)}%` : "El archivo completo nunca sale del navegador"}</small>
        {progress && <span className="progress-track"><span style={{ width: `${progress.value * 100}%` }} /></span>}
      </label>

      {error && <div className="notice notice--error" role="alert"><strong>No se pudo completar</strong><span>{error}</span></div>}

      {preview && (
        <section className="import-preview">
          <div>
            <p className="eyebrow">Vista previa</p>
            <h2>{preview.totalCyclingActivities} salidas listas</h2>
            <p>{preview.dateFrom && preview.dateTo ? `${formatDate(preview.dateFrom, "short")} — ${formatDate(preview.dateTo, "short")}` : "Sin intervalo disponible"}</p>
          </div>
          <dl>
            <div><dt>Con ruta</dt><dd>{preview.activitiesWithRoutes}</dd></div>
            <div><dt>Sin ruta</dt><dd>{preview.activitiesWithoutRoutes}</dd></div>
            <div><dt>Otros datos de Salud</dt><dd>Descartados</dd></div>
          </dl>
          {preview.warnings.map((warning) => <p className="import-warning" key={warning}>{warning}</p>)}
          <button className="button button--primary" disabled={syncing} onClick={sync}>
            {syncing ? "Sincronizando…" : "Sincronizar ciclismo"}
          </button>
        </section>
      )}
    </section>
  );
}
