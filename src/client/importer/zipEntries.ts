function basename(filename: string) {
  return filename.split("/").at(-1)?.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase() ?? "";
}

export function isHealthExportXml(filename: string) {
  const name = basename(filename);
  return name.endsWith(".xml") && name.startsWith("export") && name !== "export_cda.xml";
}

export function isWorkoutRouteGpx(filename: string) {
  return basename(filename).endsWith(".gpx");
}
