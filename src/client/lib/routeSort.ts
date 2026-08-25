import type { ActivitySummary } from "../../shared/contracts";

export type RouteSortDirection = "asc" | "desc";
export type RouteSortKey = "startAt" | "title" | "distanceM" | "durationS" | "elevationGainM" | "averageSpeedMps" | "averageHeartRateBpm" | "averagePowerW";

const collator = new Intl.Collator("es-ES", { numeric: true, sensitivity: "base" });

export function sortRoutes(routes: ActivitySummary[], key: RouteSortKey, direction: RouteSortDirection) {
  return routes.map((route, index) => ({ route, index })).sort((left, right) => {
    const a = left.route[key];
    const b = right.route[key];
    if (a === null) return b === null ? left.index - right.index : 1;
    if (b === null) return -1;
    const comparison = typeof a === "number" && typeof b === "number"
      ? a - b
      : key === "startAt" ? Date.parse(String(a)) - Date.parse(String(b)) : collator.compare(String(a), String(b));
    return (direction === "asc" ? comparison : -comparison) || left.index - right.index;
  }).map(({ route }) => route);
}
