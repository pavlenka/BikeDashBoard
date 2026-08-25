import { useMemo, useState } from "react";
import type { ActivitySummary } from "../../shared/contracts";
import { formatDate, formatDistance, formatDuration, formatElevation, formatSpeed } from "../lib/format";
import { sortRoutes, type RouteSortDirection, type RouteSortKey } from "../lib/routeSort";
import { RouteMap } from "./RouteMap";

const columns: Array<{ key: RouteSortKey; label: string; align?: "right" }> = [
  { key: "startAt", label: "Fecha" },
  { key: "title", label: "Ruta" },
  { key: "distanceM", label: "Distancia", align: "right" },
  { key: "durationS", label: "Tiempo", align: "right" },
  { key: "elevationGainM", label: "Desnivel", align: "right" },
  { key: "averageSpeedMps", label: "Vel. media", align: "right" },
  { key: "averageHeartRateBpm", label: "Pulso", align: "right" },
  { key: "averagePowerW", label: "Potencia", align: "right" },
];

function formatInteger(value: number | null, unit: string) {
  return value === null ? "—" : `${Math.round(value).toLocaleString("es-ES")} ${unit}`;
}

export function RoutesView({ activities, onSelect }: { activities: ActivitySummary[]; onSelect: (id: string) => void }) {
  const routed = useMemo(() => activities.filter((activity) => activity.hasRoute), [activities]);
  const [sortKey, setSortKey] = useState<RouteSortKey>("startAt");
  const [sortDirection, setSortDirection] = useState<RouteSortDirection>("desc");
  const sortedRoutes = useMemo(() => sortRoutes(routed, sortKey, sortDirection), [routed, sortDirection, sortKey]);
  const mapRoutes = useMemo(() => routed.map((activity) => activity.routePreview), [routed]);
  const speedRoutes = useMemo(() => routed.map((activity) => activity.routeSpeedPreview), [routed]);
  const averageSpeeds = useMemo(() => routed.map((activity) => activity.averageSpeedMps), [routed]);

  function changeSort(nextKey: RouteSortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "title" ? "asc" : "desc");
  }

  return (
    <section className="routes-page">
      <header className="page-heading page-heading--inline">
        <div><p className="eyebrow">Atlas personal</p><h1>Todas tus rutas</h1></div>
        <p>{routed.length} trazados con GPS</p>
      </header>
      <div className="atlas-map"><RouteMap routes={mapRoutes} speedRoutes={speedRoutes} averageSpeeds={averageSpeeds} /></div>
      <section className="route-ledger" aria-labelledby="route-ledger-title">
        <header className="route-ledger__heading">
          <div><p className="eyebrow">Archivo de salidas</p><h2 id="route-ledger-title">Libro de ruta</h2></div>
          <p>Selecciona una cabecera para ordenar</p>
        </header>
        <div className="route-table-wrap">
          <table className="route-table">
            <thead><tr>
              {columns.map((column) => {
                const active = sortKey === column.key;
                return (
                  <th key={column.key} className={column.align === "right" ? "numeric" : undefined} aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" onClick={() => changeSort(column.key)}>
                      {column.label}<span className={active ? "active" : ""} aria-hidden="true">{active ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}</span>
                    </button>
                  </th>
                );
              })}
              <th><span className="visually-hidden">Abrir</span></th>
            </tr></thead>
            <tbody>
              {sortedRoutes.map((activity) => (
                <tr key={activity.id}>
                  <td><time dateTime={activity.startAt}>{formatDate(activity.startAt, "short")}</time></td>
                  <td className="route-table__title"><button type="button" onClick={() => onSelect(activity.id)}>{activity.title}</button></td>
                  <td className="numeric route-table__distance">{formatDistance(activity.distanceM)}</td>
                  <td className="numeric">{formatDuration(activity.durationS)}</td>
                  <td className="numeric">{formatElevation(activity.elevationGainM)}</td>
                  <td className="numeric">{formatSpeed(activity.averageSpeedMps)}</td>
                  <td className="numeric">{formatInteger(activity.averageHeartRateBpm, "ppm")}</td>
                  <td className="numeric">{formatInteger(activity.averagePowerW, "W")}</td>
                  <td className="route-table__open"><button type="button" onClick={() => onSelect(activity.id)} aria-label={`Abrir ${activity.title}`}>→</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
