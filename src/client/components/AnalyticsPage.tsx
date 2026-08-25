import { useCallback, useEffect, useMemo, useState } from "react";

import type { ActivitySummary, ActivityTypeFilter, AnalyticsOverview, AnalyticsRecord, TimeGranularity } from "../../shared/contracts";
import { api } from "../lib/api";
import { formatDate, formatDistance, formatDuration, formatElevation, formatGoalPeriod, formatPeriod, formatSpeed } from "../lib/format";
import { EvolutionChart, type EvolutionMetric, PerformanceScatter } from "./AnalyticsCharts";
import { RouteMap } from "./RouteMap";

type RangePreset = "month" | "90d" | "12m" | "year" | "all" | "custom";

const metricLabels: Record<EvolutionMetric, string> = {
  distanceM: "Distancia",
  durationS: "Tiempo",
  elevationGainM: "Desnivel",
  rides: "Salidas",
  energyKcal: "Energía",
  averageSpeedMps: "Velocidad",
  maximumSpeedMps: "Vel. máxima",
  averageHeartRateBpm: "Pulso",
  trainingLoad: "Carga",
};

const weekdays = ["L", "M", "X", "J", "V", "S", "D"];

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rangeFor(preset: RangePreset, customFrom: string, customTo: string) {
  const now = new Date();
  const to = new Date(now);
  let from = new Date(now);
  if (preset === "month") from = new Date(now.getFullYear(), now.getMonth(), 1);
  if (preset === "90d") from = new Date(now.getTime() - 89 * 86_400_000);
  if (preset === "12m") from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  if (preset === "year") from = new Date(now.getFullYear(), 0, 1);
  if (preset === "all") from = new Date(0);
  if (preset === "custom") {
    from = new Date(`${customFrom}T00:00:00`);
    const customEnd = new Date(`${customTo}T23:59:59.999`);
    return { from: from.toISOString(), to: customEnd.toISOString(), compare: "previous" as const };
  }
  return { from: from.toISOString(), to: to.toISOString(), compare: preset === "all" ? "none" as const : "previous" as const };
}

function percentage(value: number | null) {
  if (value === null) return "Sin comparación";
  return `${value >= 0 ? "+" : ""}${Math.round(value * 100)} %`;
}

function recordValue(record: AnalyticsRecord) {
  if (record.unit === "mps") return formatSpeed(record.value);
  if (record.unit === "s") return formatDuration(record.value);
  if (record.unit === "load") return `${Math.round(record.value)} pts`;
  return record.key === "elevation" ? formatElevation(record.value) : formatDistance(record.value);
}

function localDay(value: string) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function daysInYear(year: number) {
  const result: string[] = [];
  const current = new Date(year, 0, 1);
  while (current.getFullYear() === year) {
    result.push(dateInputValue(current));
    current.setDate(current.getDate() + 1);
  }
  return result;
}

function GoalPanel({ goal }: { goal: AnalyticsOverview["goals"][number] }) {
  const metrics = [
    { label: "Kilómetros", actual: goal.actual.distanceM, target: goal.distanceM, format: (value: number) => `${Math.round(value / 1000).toLocaleString("es-ES")} km` },
    { label: "Horas", actual: goal.actual.durationS, target: goal.durationS, format: (value: number) => `${Math.round(value / 3600).toLocaleString("es-ES")} h` },
    { label: "Desnivel", actual: goal.actual.elevationGainM, target: goal.elevationGainM, format: (value: number) => formatElevation(value) },
    { label: "Salidas", actual: goal.actual.rides, target: goal.rides, format: (value: number) => Math.round(value).toLocaleString("es-ES") },
  ].filter((metric) => metric.target !== null);
  return (
    <article className="goal-panel">
      <header><span>{goal.period.length === 4 ? "Objetivo anual" : "Objetivo mensual"}</span><strong>{formatGoalPeriod(goal.period)}</strong></header>
      {metrics.map((metric) => {
        const target = metric.target ?? 0;
        const ratio = target ? metric.actual / target : 0;
        const projected = goal.elapsedRatio ? metric.actual / goal.elapsedRatio : metric.actual;
        return <div className="goal-row" key={metric.label}>
          <div><span>{metric.label}</span><strong>{metric.format(metric.actual)} <small>/ {metric.format(target)}</small></strong></div>
          <div className="goal-track"><span style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>
          <small>{Math.round(ratio * 100)} % · proyección {metric.format(projected)}</small>
        </div>;
      })}
    </article>
  );
}

export function AnalyticsPage({ activities, onSelect, onConfigure }: { activities: ActivitySummary[]; onSelect: (id: string) => void; onConfigure: () => void }) {
  const now = new Date();
  const [preset, setPreset] = useState<RangePreset>("year");
  const [granularity, setGranularity] = useState<TimeGranularity>("month");
  const [activityType, setActivityType] = useState<ActivityTypeFilter>("all");
  const [customFrom, setCustomFrom] = useState(`${now.getFullYear()}-01-01`);
  const [customTo, setCustomTo] = useState(dateInputValue(now));
  const [metric, setMetric] = useState<EvolutionMetric>("distanceM");
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [calendarYear, setCalendarYear] = useState(now.getFullYear());

  useEffect(() => {
    const controller = new AbortController();
    const range = rangeFor(preset, customFrom, customTo);
    const query = new URLSearchParams({ from: range.from, to: range.to, groupBy: granularity, activityType, compare: range.compare });
    setLoading(true);
    setError("");
    api<AnalyticsOverview>(`/api/analytics?${query}`, { signal: controller.signal })
      .then(setOverview)
      .catch((nextError) => { if ((nextError as Error).name !== "AbortError") setError("No se pudo calcular el análisis."); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [activityType, customFrom, customTo, granularity, preset]);

  const handleSelect = useCallback((id: string) => onSelect(id), [onSelect]);
  const calendarValues = useMemo(() => new Map(overview?.calendar.map((day) => [day.date, day]) ?? []), [overview]);
  const calendarDays = useMemo(() => daysInYear(calendarYear), [calendarYear]);
  const calendarOffset = (new Date(calendarYear, 0, 1).getDay() + 6) % 7;
  const maxCalendarDistance = Math.max(1, ...calendarDays.map((day) => calendarValues.get(day)?.distanceM ?? 0));
  const selectedActivities = selectedDay ? activities.filter((activity) => localDay(activity.startAt) === selectedDay) : [];
  const maxWeekday = Math.max(1, ...(overview?.patterns.weekdays.map((day) => day.rides) ?? [1]));
  const maxHour = Math.max(1, ...(overview?.patterns.hours.map((hour) => hour.rides) ?? [1]));
  const currentGoal = overview?.goals.find((goal) => goal.period.length === 4) ?? overview?.goals[0];
  const goalTarget = currentGoal ? {
    distanceM: currentGoal.distanceM,
    durationS: currentGoal.durationS,
    elevationGainM: currentGoal.elevationGainM,
    rides: currentGoal.rides,
    energyKcal: null,
    averageSpeedMps: null,
    maximumSpeedMps: null,
    averageHeartRateBpm: null,
    trainingLoad: null,
  }[metric] : null;

  return (
    <section className="analytics-page">
      <header className="analytics-heading">
        <div><p className="eyebrow">Cuaderno de temporada</p><h1>Análisis</h1><p>Ritmo, constancia, esfuerzo y territorio. Todo el historial, sin perder el hilo de cada salida.</p></div>
        <div className="analytics-heading__stamp"><span>ACTUALIZACIÓN</span><strong>{new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(now)}</strong></div>
      </header>

      <div className="analytics-filters" aria-label="Filtros de análisis">
        <div><span>Periodo</span><div className="segmented">{(["month", "90d", "12m", "year", "all", "custom"] as const).map((value) => <button key={value} className={preset === value ? "active" : ""} onClick={() => setPreset(value)}>{value === "month" ? "Este mes" : value === "90d" ? "90 días" : value === "12m" ? "12 meses" : value === "year" ? "Este año" : value === "all" ? "Todo" : "Fechas"}</button>)}</div></div>
        <div><span>Agrupar</span><div className="segmented">{(["day", "week", "month", "year"] as const).map((value) => <button key={value} className={granularity === value ? "active" : ""} onClick={() => setGranularity(value)}>{value === "day" ? "Día" : value === "week" ? "Semana" : value === "month" ? "Mes" : "Año"}</button>)}</div></div>
        <div><span>Tipo</span><select value={activityType} onChange={(event) => setActivityType(event.target.value as ActivityTypeFilter)}><option value="all">Todas</option><option value="outdoor">Exterior</option><option value="indoor">Interior</option></select></div>
        {preset === "custom" && <div className="date-range"><label>Desde<input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><label>Hasta<input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}
      </div>

      {error && <p className="notice notice--error">{error}</p>}
      {!overview && loading ? <div className="analysis-loading">Calculando temporada…</div> : overview && <>
        <section className="analytics-kpis" aria-label="Indicadores del periodo">
          {[
            ["Distancia", formatDistance(overview.totals.distanceM), overview.deltas.distanceM],
            ["Tiempo", formatDuration(overview.totals.durationS), overview.deltas.durationS],
            ["En movimiento", formatDuration(overview.totals.movingTimeS), overview.deltas.movingTimeS],
            ["Desnivel", formatElevation(overview.totals.elevationGainM), overview.deltas.elevationGainM],
            ["Salidas", overview.totals.rides.toLocaleString("es-ES"), overview.deltas.rides],
            ["Energía", `${Math.round(overview.totals.energyKcal).toLocaleString("es-ES")} kcal`, overview.deltas.energyKcal],
            ["Velocidad", formatSpeed(overview.totals.averageSpeedMps), overview.deltas.averageSpeedMps],
            ["Velocidad máxima", formatSpeed(overview.totals.maximumSpeedMps), overview.deltas.maximumSpeedMps],
            ["Pulso medio", overview.totals.averageHeartRateBpm ? `${Math.round(overview.totals.averageHeartRateBpm)} ppm` : "—", overview.deltas.averageHeartRateBpm],
          ].map(([label, value, change]) => <div key={String(label)}><span>{label}</span><strong>{value}</strong><small className={typeof change === "number" && change < 0 ? "negative" : ""}>{percentage(change as number | null)}</small></div>)}
        </section>

        {overview.insights.length > 0 && <section className="insight-ticker"><span>EN CLARO</span><div>{overview.insights.map((insight) => <p key={insight}>{insight}</p>)}</div></section>}

        <section className="analysis-panel analysis-panel--wide season-line">
          <header><div><p className="eyebrow">Evolución</p><h2>La línea de la temporada</h2></div><div className="metric-switch">{(Object.keys(metricLabels) as EvolutionMetric[]).map((value) => <button key={value} className={metric === value ? "active" : ""} onClick={() => setMetric(value)}>{metricLabels[value]}</button>)}</div></header>
          <EvolutionChart data={overview.timeline} previous={overview.previousTimeline} metric={metric} granularity={granularity} goalTarget={goalTarget} />
        </section>

        <section className="goals-grid">
          {overview.goals.length ? overview.goals.map((goal) => <GoalPanel goal={goal} key={goal.period} />) : <button className="goal-empty" onClick={onConfigure}><span>OBJETIVOS</span><strong>Define el ritmo que quieres llevar</strong><small>Configura metas mensuales y anuales →</small></button>}
        </section>

        <div className="analysis-columns">
          <section className="analysis-panel calendar-panel">
            <header><div><p className="eyebrow">Calendario</p><h2>Días sobre la bici</h2></div><select value={calendarYear} onChange={(event) => setCalendarYear(Number(event.target.value))}>{[...new Set(activities.map((activity) => new Date(activity.startAt).getFullYear()))].sort().map((year) => <option key={year}>{year}</option>)}</select></header>
            <div className="calendar-grid"><div className="calendar-weekdays">{weekdays.map((day) => <span key={day}>{day}</span>)}</div><div className="ride-calendar">{Array.from({ length: calendarOffset }, (_value, index) => <i key={`offset-${index}`} />)}{calendarDays.map((day) => { const value = calendarValues.get(day); const intensity = value ? Math.max(0.18, value.distanceM / maxCalendarDistance) : 0; const label = formatPeriod(day, "day"); return <button key={day} title={`${label}: ${value ? formatDistance(value.distanceM) : "sin salida"}`} style={{ "--intensity": intensity } as React.CSSProperties} className={value ? "active" : ""} onClick={() => value && setSelectedDay(day)} aria-label={`${label}, ${value?.rides ?? 0} salidas`} />; })}</div></div>
            {selectedDay && <div className="calendar-selection"><span>{formatPeriod(selectedDay, "day")}</span>{selectedActivities.map((activity) => <button key={activity.id} onClick={() => onSelect(activity.id)}><strong>{formatDistance(activity.distanceM)}</strong><small>{formatDate(activity.startAt, "short")} · {activity.title}</small>→</button>)}</div>}
          </section>

          <section className="analysis-panel consistency-panel">
            <header><div><p className="eyebrow">Constancia</p><h2>El hábito cuenta</h2></div></header>
            <dl className="stat-ledger">
              <div><dt>Días activos</dt><dd>{overview.consistency.activeDays}</dd></div>
              <div><dt>Salidas / semana</dt><dd>{overview.consistency.ridesPerWeek.toLocaleString("es-ES", { maximumFractionDigits: 1 })}</dd></div>
              <div><dt>Salidas / mes</dt><dd>{overview.consistency.ridesPerMonth.toLocaleString("es-ES", { maximumFractionDigits: 1 })}</dd></div>
              <div><dt>Desde la última</dt><dd>{overview.consistency.daysSinceLastRide ?? "—"}<small>días</small></dd></div>
              <div><dt>Racha actual</dt><dd>{overview.consistency.currentWeekStreak}<small>semanas</small></dd></div>
              <div><dt>Mejor racha</dt><dd>{overview.consistency.longestWeekStreak}<small>semanas</small></dd></div>
            </dl>
          </section>
        </div>

        <section className="analysis-panel records-panel">
          <header><div><p className="eyebrow">Marcas personales</p><h2>El listón</h2></div><span>{overview.records.length} referencias</span></header>
          <div className="records-grid">{overview.records.map((record) => <button key={`${record.key}-${record.periodStart ?? record.activityId}`} disabled={!record.activityId} onClick={() => record.activityId && onSelect(record.activityId)}><span>{record.label}</span><strong>{recordValue(record)}</strong><small>{record.periodStart ? formatPeriod(record.periodStart, record.key === "day" || record.key === "week" || record.key === "month" || record.key === "year" ? record.key : "day") : (record.activityId ? "Abrir salida →" : "")}</small></button>)}</div>
        </section>

        <div className="analysis-columns analysis-columns--balanced">
          <section className="analysis-panel habits-panel">
            <header><div><p className="eyebrow">Hábitos</p><h2>Cuándo sales</h2></div><span>{overview.patterns.weekendRides} fin de semana · {overview.patterns.weekdayRides} laborables</span></header>
            <div className="weekday-bars">{overview.patterns.weekdays.map((day) => <div key={day.day}><span style={{ height: `${day.rides / maxWeekday * 100}%` }} /><strong>{weekdays[day.day]}</strong><small>{day.rides}</small></div>)}</div>
            <div className="hour-bars">{overview.patterns.hours.map((hour) => <i key={hour.hour} style={{ height: `${Math.max(2, hour.rides / maxHour * 100)}%` }} title={`${hour.hour}:00 · ${hour.rides} salidas`} />)}</div>
            <div className="hour-labels"><span>00 h</span><span>06 h</span><span>12 h</span><span>18 h</span><span>24 h</span></div>
          </section>

          <section className="analysis-panel terrain-panel">
            <header><div><p className="eyebrow">Terreno</p><h2>Cómo sube tu año</h2></div><strong>{overview.terrain.elevationPer100Km ? formatElevation(overview.terrain.elevationPer100Km) : "—"}<small>por 100 km</small></strong></header>
            <div className="terrain-spectrum"><div style={{ flex: overview.terrain.flatRides || 1 }}><span>Plano</span><strong>{overview.terrain.flatRides}</strong></div><div style={{ flex: overview.terrain.rollingRides || 1 }}><span>Ondulado</span><strong>{overview.terrain.rollingRides}</strong></div><div style={{ flex: overview.terrain.mountainRides || 1 }}><span>Montaña</span><strong>{overview.terrain.mountainRides}</strong></div></div>
            <p>Clasificación relativa a tus propias salidas, según el desnivel recorrido por kilómetro.</p>
          </section>
        </div>

        <section className="heart-section">
          <header><div><p className="eyebrow">Pulso y rendimiento</p><h2>La intensidad, con contexto</h2></div><strong>{Math.round(overview.heartRate.totalLoad).toLocaleString("es-ES")}<small>puntos de carga</small></strong></header>
          {!overview.heartRate.configured ? <button className="heart-empty" onClick={onConfigure}><strong>Configura tu FC máxima y en reposo</strong><span>Sin esos valores no inventaremos zonas ni carga de entrenamiento. Ajustarlas lleva menos de un minuto →</span></button> : <div className="heart-grid">
            <div className="zone-stack">{overview.heartRate.zones.map((zone) => <div key={zone.zone} className={`zone zone--${zone.zone}`}><span>Z{zone.zone}</span><strong>{formatDuration(zone.seconds)}</strong><i style={{ width: `${zone.percentage * 100}%` }} /><small>{zone.fromBpm}–{zone.toBpm} ppm · {Math.round(zone.percentage * 100)} %</small></div>)}</div>
            <div><p className="chart-caption">Cada punto es una salida. Tamaño = distancia; altura = pulso.</p><PerformanceScatter points={overview.heartRate.scatter} onSelect={handleSelect} /></div>
          </div>}
        </section>

        <section className="exploration-section">
          <div className="exploration-map"><RouteMap routes={[]} heatCells={overview.exploration.heatCells} /></div>
          <div className="exploration-copy"><p className="eyebrow">GPS y exploración</p><h2>Tu territorio</h2><dl><div><dt>Kilómetros con GPS</dt><dd>{formatDistance(overview.exploration.gpsDistanceM)}</dd></div><div><dt>Celdas recorridas</dt><dd>{overview.exploration.cells.toLocaleString("es-ES")}</dd></div><div><dt>Territorio nuevo</dt><dd>+{overview.exploration.newCells.toLocaleString("es-ES")}</dd></div></dl><p>Cada celda representa aproximadamente 250 metros. El brillo indica cuántas salidas han pasado por allí.</p></div>
        </section>

        <footer className="coverage-ledger"><span>COBERTURA DEL PERIODO</span>{Object.entries(overview.coverage).filter(([key]) => key !== "rides").map(([key, value]) => <div key={key}><strong>{key === "heartRate" ? "Pulso" : key === "movingTime" ? "Movimiento" : key === "route" ? "GPS" : key === "elevation" ? "Desnivel" : key === "energy" ? "Energía" : key === "power" ? "Potencia" : key === "cadence" ? "Cadencia" : key === "speed" ? "Velocidad" : key === "distance" ? "Distancia" : "Duración"}</strong><small>{value}/{overview.coverage.rides}</small></div>)}</footer>
      </>}
      {loading && overview && <div className="loading-line" />}
    </section>
  );
}
