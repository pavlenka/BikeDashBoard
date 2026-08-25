import { useEffect, useMemo, useState } from "react";

import type { ActivitySummary, DashboardSummary, TimeGranularity } from "../../shared/contracts";
import { api } from "../lib/api";
import { formatDate, formatDistance, formatDuration, formatElevation, formatSpeed } from "../lib/format";
import { RouteMap } from "./RouteMap";
import { PeriodChart } from "./WeeklyChart";

export function Dashboard({ summary, activities, onSelect, onImport }: { summary: DashboardSummary; activities: ActivitySummary[]; onSelect: (id: string) => void; onImport: () => void }) {
  const [granularity, setGranularity] = useState<TimeGranularity>("week");
  const [chartSummary, setChartSummary] = useState(summary);
  useEffect(() => {
    if (granularity === summary.granularity) {
      setChartSummary(summary);
      return;
    }
    api<DashboardSummary>(`/api/dashboard/summary?groupBy=${granularity}`).then(setChartSummary);
  }, [granularity, summary]);
  const highlights = useMemo(() => {
    const best = [...chartSummary.series].sort((a, b) => b.distanceM - a.distanceM)[0];
    const longest = [...activities].filter((item) => item.distanceM !== null).sort((a, b) => (b.distanceM ?? 0) - (a.distanceM ?? 0))[0];
    const last = chartSummary.series.at(-1);
    const previous = chartSummary.series.at(-2);
    const change = last && previous?.distanceM ? (last.distanceM - previous.distanceM) / previous.distanceM : null;
    return { best, longest, change };
  }, [activities, chartSummary.series]);
  const latest = activities[0];
  if (!activities.length) {
    return (
      <section className="empty-state">
        <div className="empty-route"><span /><span /><span /></div>
        <p className="eyebrow">Kilómetro cero</p>
        <h1>Tu cuaderno todavía está en blanco</h1>
        <p>Importa la exportación de Salud para dibujar tus primeras rutas.</p>
        <button className="button button--primary" onClick={onImport}>Importar Apple Fitness</button>
      </section>
    );
  }
  return (
    <div className="dashboard-page">
      <section className="ride-hero">
        <div className="ride-hero__map">
          <RouteMap routes={latest.hasRoute ? [latest.routePreview] : []} />
          {!latest.hasRoute && <div className="map-empty">Ruta no disponible</div>}
        </div>
        <div className="ride-hero__copy">
          <p className="eyebrow">Última salida · {formatDate(latest.startAt, "short")}</p>
          <h1>{formatDistance(latest.distanceM)}</h1>
          <p>{latest.title}</p>
          <dl className="hero-metrics">
            <div><dt>Tiempo</dt><dd>{formatDuration(latest.durationS)}</dd></div>
            <div><dt>Desnivel</dt><dd>{formatElevation(latest.elevationGainM)}</dd></div>
            <div><dt>Pulso medio</dt><dd>{latest.averageHeartRateBpm ? `${Math.round(latest.averageHeartRateBpm)} ppm` : "—"}</dd></div>
            <div><dt>Velocidad máxima</dt><dd>{formatSpeed(latest.maximumSpeedMps)}</dd></div>
          </dl>
          <button className="button button--dark" onClick={() => onSelect(latest.id)}>Ver la salida</button>
        </div>
      </section>

      <section className="totals-strip" aria-label="Totales del periodo">
        <div><span>Distancia</span><strong>{formatDistance(summary.distanceM)}</strong></div>
        <div><span>Tiempo</span><strong>{formatDuration(summary.durationS)}</strong></div>
        <div><span>Desnivel</span><strong>{formatElevation(summary.elevationGainM)}</strong></div>
        <div><span>Salidas</span><strong>{summary.rides}</strong></div>
        <div><span>Energía</span><strong>{Math.round(summary.energyKcal).toLocaleString("es-ES")} kcal</strong></div>
      </section>

      <section className="highlight-rail" aria-label="Destacados">
        <div><span>Mejor {granularity === "week" ? "semana" : granularity === "month" ? "mes" : "año"}</span><strong>{highlights.best ? formatDistance(highlights.best.distanceM) : "—"}</strong><small>{highlights.best?.periodStart ?? "Sin datos"}</small></div>
        <div><span>Salida más larga</span><strong>{formatDistance(highlights.longest?.distanceM)}</strong><small>{highlights.longest ? formatDate(highlights.longest.startAt, "short") : "Sin datos"}</small></div>
        <div><span>Último cambio</span><strong>{highlights.change === null ? "—" : `${highlights.change >= 0 ? "+" : ""}${Math.round(highlights.change * 100)} %`}</strong><small>frente al periodo anterior</small></div>
      </section>

      <section className="content-grid">
        <article className="chart-panel">
          <header><div><p className="eyebrow">Ritmo reciente</p><h2>Distancia por periodo</h2></div><div className="segmented" aria-label="Agrupar resumen">
            {(["week", "month", "year"] as const).map((value) => <button key={value} className={granularity === value ? "active" : ""} onClick={() => setGranularity(value)}>{value === "week" ? "Semanas" : value === "month" ? "Meses" : "Años"}</button>)}
          </div></header>
          <PeriodChart data={chartSummary.series} granularity={granularity} />
        </article>
        <article className="ride-list-panel">
          <header><p className="eyebrow">Historial</p><h2>Salidas recientes</h2></header>
          <ol className="ride-list">
            {activities.slice(0, 8).map((activity) => (
              <li key={activity.id}>
                <button onClick={() => onSelect(activity.id)}>
                  <time>{formatDate(activity.startAt, "short")}</time>
                  <span>{formatDistance(activity.distanceM)}</span>
                  <small>{formatElevation(activity.elevationGainM)}</small>
                  <i aria-hidden="true">→</i>
                </button>
              </li>
            ))}
          </ol>
        </article>
      </section>
    </div>
  );
}
