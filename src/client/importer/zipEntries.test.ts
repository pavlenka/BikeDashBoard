import { describe, expect, it } from "vitest";

import { isHealthExportXml, isWorkoutRouteGpx } from "./zipEntries";

describe("localized Apple Health ZIP entries", () => {
  it.each([
    "apple_health_export/export.xml",
    "exportación.xml",
    "exportacion.xml",
    "datos/exportación.xml",
    "apple_health_export/exportacio�?n.xml",
  ])("recognizes %s as the Health export", (filename) => {
    expect(isHealthExportXml(filename)).toBe(true);
  });

  it("does not mistake the CDA document for the Health export", () => {
    expect(isHealthExportXml("export_cda.xml")).toBe(false);
  });

  it("recognizes GPX routes regardless of the localized folder name", () => {
    expect(isWorkoutRouteGpx("rutas_de_entrenamiento/ruta-2026-08-01.gpx")).toBe(true);
  });
});
