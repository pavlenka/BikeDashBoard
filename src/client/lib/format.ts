const numberFormat = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });

export function formatDistance(meters: number | null | undefined) {
  return meters === null || meters === undefined ? "—" : `${numberFormat.format(meters / 1000)} km`;
}

export function formatElevation(meters: number | null | undefined) {
  return meters === null || meters === undefined ? "—" : `${Math.round(meters).toLocaleString("es-ES")} m`;
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "—";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  return hours ? `${hours} h ${minutes.toString().padStart(2, "0")} min` : `${minutes} min`;
}

export function formatSpeed(metersPerSecond: number | null | undefined) {
  return metersPerSecond === null || metersPerSecond === undefined
    ? "—"
    : `${numberFormat.format(metersPerSecond * 3.6)} km/h`;
}

export function formatDate(value: string, style: "short" | "long" = "long") {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: style === "long" ? "long" : "short",
    year: "numeric",
    ...(style === "long" ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
