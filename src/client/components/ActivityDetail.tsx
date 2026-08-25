import { useCallback, useState } from "react";

import type { NormalizedCyclingActivityV1 } from "../../shared/contracts";
import { formatDate, formatDistance, formatDuration, formatElevation, formatSpeed } from "../lib/format";
import { RideChart } from "./RideChart";
import { RouteMap } from "./RouteMap";

function metric(value: number | null, suffix: string) {
  return value === null ? "—" : `${Math.round(value).toLocaleString("es-ES")} ${suffix}`;
}

export function ActivityDetail({ activity, onBack }: { activity: NormalizedCyclingActivityV1; onBack: () => void }) {
  const [hoverIndex, setHoverIndex] = useState(0);
  const onHover = useCallback((index: number) => setHoverIndex(index), []);
  const hovered = activity.route[hoverIndex];
  const route = activity.route.map((point) => [point.longitude, point.latitude] as [number, number]);
  return (
    <section className="activity-page">
      <button className="back-button" onClick={onBack}>← Volver al resumen</button>
      <header className="activity-heading">
        <div><p className="eyebrow">{formatDate(activity.startAt)}</p><h1>{formatDistance(activity.distanceM.value)}</h1><span>{activity.title}</span></div>
        <dl>
          <div><dt>Tiempo</dt><dd>{formatDuration(activity.durationS.value)}</dd></div>
          <div><dt>En movimiento</dt><dd>{formatDuration(activity.movingTimeS.value)}</dd></div>
          <div><dt>Desnivel</dt><dd>{formatElevation(activity.elevationGainM.value)}</dd></div>
          <div><dt>Velocidad media</dt><dd>{formatSpeed(activity.averageSpeedMps.value)}</dd></div>
        </dl>
      </header>
      <div className="activity-map-wrap">
        {route.length ? <RouteMap routes={[route]} activePoint={hovered ? [hovered.longitude, hovered.latitude] : null} /> : <div className="no-route-detail">Ruta no disponible para esta actividad</div>}
      </div>
      {route.length > 1 && <RideChart points={activity.route} onHover={onHover} />}
      <section className="sensor-strip">
        <div><span>Pulso medio</span><strong>{metric(activity.averageHeartRateBpm.value, "ppm")}</strong></div>
        <div><span>Pulso máximo</span><strong>{metric(activity.maximumHeartRateBpm.value, "ppm")}</strong></div>
        <div><span>Potencia media</span><strong>{metric(activity.averagePowerW.value, "W")}</strong></div>
        <div><span>Cadencia media</span><strong>{metric(activity.averageCadenceRpm.value, "rpm")}</strong></div>
        <div><span>Calorías</span><strong>{metric(activity.energyKcal.value, "kcal")}</strong></div>
        <div><span>Velocidad máxima</span><strong>{formatSpeed(activity.maximumSpeedMps.value)}</strong></div>
        <div><span>Potencia máxima</span><strong>{metric(activity.maximumPowerW.value, "W")}</strong></div>
        <div><span>Cadencia máxima</span><strong>{metric(activity.maximumCadenceRpm.value, "rpm")}</strong></div>
      </section>
      {activity.warnings.map((warning) => <p className="notice" key={warning}>{warning}</p>)}
    </section>
  );
}
