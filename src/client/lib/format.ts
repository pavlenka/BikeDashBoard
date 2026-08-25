import type { TimeGranularity } from "../../shared/contracts";

const numberFormat = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });
const timezone = "Europe/Madrid";

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
    timeZone: timezone,
  }).format(new Date(value));
}

function periodDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`);
}

export function formatPeriod(value: string, granularity: TimeGranularity, compact = false) {
  if (granularity === "year") return value.slice(0, 4);
  const date = periodDate(value);
  if (granularity === "month") {
    return new Intl.DateTimeFormat("es-ES", {
      month: compact ? "short" : "long",
      ...(compact ? {} : { year: "numeric" }),
      timeZone: timezone,
    }).format(date);
  }
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    ...(compact ? {} : { year: "numeric" }),
    timeZone: timezone,
  }).format(date);
}

export function formatPeriodLabel(value: string, granularity: TimeGranularity) {
  const formatted = formatPeriod(value, granularity);
  return granularity === "week" ? `Semana del ${formatted}` : formatted;
}

export function formatGoalPeriod(value: string) {
  return value.length === 4 ? value : formatPeriod(`${value}-01`, "month");
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
