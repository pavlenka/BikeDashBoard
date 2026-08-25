import type { ActivitySummary } from "../../shared/contracts";
import { formatDate, formatDistance } from "../lib/format";
import { RouteMap } from "./RouteMap";

export function RoutesView({ activities, onSelect }: { activities: ActivitySummary[]; onSelect: (id: string) => void }) {
  const routed = activities.filter((activity) => activity.hasRoute);
  return (
    <section className="routes-page">
      <header className="page-heading page-heading--inline">
        <div><p className="eyebrow">Atlas personal</p><h1>Todas tus rutas</h1></div>
        <p>{routed.length} trazados con GPS</p>
      </header>
      <div className="atlas-map"><RouteMap routes={routed.map((activity) => activity.routePreview)} /></div>
      <div className="route-index">
        {routed.map((activity) => (
          <button key={activity.id} onClick={() => onSelect(activity.id)}>
            <span>{formatDate(activity.startAt, "short")}</span><strong>{formatDistance(activity.distanceM)}</strong><i>→</i>
          </button>
        ))}
      </div>
    </section>
  );
}
