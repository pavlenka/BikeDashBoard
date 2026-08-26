import { gunzipSync } from "node:zlib";

import type { FastifyInstance } from "fastify";

import type {
  ActivityTypeFilter,
  AnalyticsCoverage,
  AnalyticsOverview,
  AnalyticsPreferences,
  AnalyticsRecord,
  AnalyticsTotals,
  DashboardSummary,
  NormalizedCyclingActivityV1,
  PeriodGoal,
  PeriodGoalProgress,
  PeriodSeriesPoint,
  RoutePoint,
  TimeGranularity,
} from "../shared/contracts.js";
import { requireSession } from "./auth.js";
import { db } from "./db.js";

export interface ActivityRow {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  timezone: string;
  indoor: number;
  durationS: number | null;
  movingTimeS: number | null;
  distanceM: number | null;
  energyKcal: number | null;
  elevationGainM: number | null;
  averageSpeedMps: number | null;
  maximumSpeedMps: number | null;
  averageHeartRateBpm: number | null;
  maximumHeartRateBpm: number | null;
  averagePowerW: number | null;
  averageCadenceRpm: number | null;
  hasRoute: number;
}

interface BucketAccumulator extends PeriodSeriesPoint {
  heartRateWeighted: number;
  heartRateSeconds: number;
}

const activitySql = `SELECT id, title, start_at startAt, end_at endAt, timezone, indoor,
  duration_s durationS, moving_time_s movingTimeS, distance_m distanceM,
  energy_kcal energyKcal, elevation_gain_m elevationGainM,
  average_speed_mps averageSpeedMps, maximum_speed_mps maximumSpeedMps,
  average_heart_rate_bpm averageHeartRateBpm,
  maximum_heart_rate_bpm maximumHeartRateBpm, average_power_w averagePowerW,
  average_cadence_rpm averageCadenceRpm, has_route hasRoute
  FROM activities ORDER BY start_at`;

const cache = new Map<string, AnalyticsOverview>();
const DAY_MS = 86_400_000;
const EARTH_RADIUS_M = 6_378_137;

function allRows() {
  return db.prepare(activitySql).all() as ActivityRow[];
}

export function localDateParts(value: string | number | Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const result = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(result.year),
    month: Number(result.month),
    day: Number(result.day),
    hour: Number(result.hour),
  };
}

function ymd(year: number, month: number, day: number) {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function spanishPeriodLabel(value: string) {
  if (value.length === 4) return value;
  return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "Europe/Madrid" })
    .format(new Date(`${value.slice(0, 7)}-01T12:00:00Z`));
}

export function periodStart(value: string, granularity: TimeGranularity, timezone: string) {
  const parts = localDateParts(value, timezone);
  if (granularity === "year") return String(parts.year);
  if (granularity === "month") return ymd(parts.year, parts.month, 1).slice(0, 7);
  if (granularity === "day") return ymd(parts.year, parts.month, parts.day);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function totals(rows: ActivityRow[]): AnalyticsTotals {
  let heartRateWeighted = 0;
  let heartRateSeconds = 0;
  const result: AnalyticsTotals = {
    rides: rows.length,
    distanceM: 0,
    durationS: 0,
    movingTimeS: 0,
    elevationGainM: 0,
    energyKcal: 0,
    averageSpeedMps: null,
    maximumSpeedMps: null,
    averageHeartRateBpm: null,
  };
  for (const row of rows) {
    result.distanceM += row.distanceM ?? 0;
    result.durationS += row.durationS ?? 0;
    result.movingTimeS += row.movingTimeS ?? row.durationS ?? 0;
    result.elevationGainM += row.elevationGainM ?? 0;
    result.energyKcal += row.energyKcal ?? 0;
    if (row.averageHeartRateBpm !== null) {
      const weight = row.durationS ?? 1;
      heartRateWeighted += row.averageHeartRateBpm * weight;
      heartRateSeconds += weight;
    }
  }
  result.averageSpeedMps = result.movingTimeS > 0 && result.distanceM > 0
    ? result.distanceM / result.movingTimeS
    : null;
  const maximumSpeeds = rows.map((row) => row.maximumSpeedMps)
    .filter((speed): speed is number => speed !== null && speed >= 0 && speed <= 120 / 3.6);
  result.maximumSpeedMps = maximumSpeeds.length ? Math.max(...maximumSpeeds) : null;
  result.averageHeartRateBpm = heartRateSeconds > 0 ? heartRateWeighted / heartRateSeconds : null;
  return result;
}

export function buildSeries(
  rows: ActivityRow[],
  granularity: TimeGranularity,
  timezone: string,
  loads: Map<string, number> = new Map(),
) {
  const buckets = new Map<string, BucketAccumulator>();
  for (const row of rows) {
    const key = periodStart(row.startAt, granularity, timezone);
    const bucket = buckets.get(key) ?? {
      periodStart: key,
      rides: 0,
      distanceM: 0,
      durationS: 0,
      movingTimeS: 0,
      elevationGainM: 0,
      energyKcal: 0,
      averageSpeedMps: null,
      maximumSpeedMps: null,
      averageHeartRateBpm: null,
      trainingLoad: 0,
      heartRateWeighted: 0,
      heartRateSeconds: 0,
    };
    bucket.rides += 1;
    bucket.distanceM += row.distanceM ?? 0;
    bucket.durationS += row.durationS ?? 0;
    bucket.movingTimeS += row.movingTimeS ?? row.durationS ?? 0;
    bucket.elevationGainM += row.elevationGainM ?? 0;
    bucket.energyKcal += row.energyKcal ?? 0;
    bucket.trainingLoad += loads.get(row.id) ?? 0;
    if (row.maximumSpeedMps !== null && row.maximumSpeedMps >= 0 && row.maximumSpeedMps <= 120 / 3.6) {
      bucket.maximumSpeedMps = Math.max(bucket.maximumSpeedMps ?? 0, row.maximumSpeedMps);
    }
    if (row.averageHeartRateBpm !== null) {
      const weight = row.durationS ?? 1;
      bucket.heartRateWeighted += row.averageHeartRateBpm * weight;
      bucket.heartRateSeconds += weight;
    }
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.periodStart.localeCompare(b.periodStart)).map((bucket) => ({
    periodStart: bucket.periodStart,
    rides: bucket.rides,
    distanceM: bucket.distanceM,
    durationS: bucket.durationS,
    movingTimeS: bucket.movingTimeS,
    elevationGainM: bucket.elevationGainM,
    energyKcal: bucket.energyKcal,
    averageSpeedMps: bucket.movingTimeS > 0 && bucket.distanceM > 0 ? bucket.distanceM / bucket.movingTimeS : null,
    maximumSpeedMps: bucket.maximumSpeedMps,
    averageHeartRateBpm: bucket.heartRateSeconds > 0 ? bucket.heartRateWeighted / bucket.heartRateSeconds : null,
    trainingLoad: bucket.trainingLoad,
  } satisfies PeriodSeriesPoint));
}

function readPreferences(): AnalyticsPreferences {
  const row = db.prepare(
    `SELECT timezone, maximum_heart_rate_bpm maximumHeartRateBpm,
      resting_heart_rate_bpm restingHeartRateBpm FROM analytics_preferences WHERE id = 1`,
  ).get() as AnalyticsPreferences;
  return row;
}

function filterRows(
  rows: ActivityRow[],
  fromMs: number,
  toMs: number,
  activityType: ActivityTypeFilter,
) {
  return rows.filter((row) => {
    const time = Date.parse(row.startAt);
    const typeMatches = activityType === "all"
      || (activityType === "indoor" ? Boolean(row.indoor) : !row.indoor);
    return time >= fromMs && time <= toMs && typeMatches;
  });
}

function coverage(rows: ActivityRow[]): AnalyticsCoverage {
  const present = (field: keyof ActivityRow) => rows.filter((row) => row[field] !== null && row[field] !== undefined).length;
  return {
    rides: rows.length,
    distance: present("distanceM"),
    duration: present("durationS"),
    movingTime: present("movingTimeS"),
    elevation: present("elevationGainM"),
    energy: present("energyKcal"),
    speed: present("averageSpeedMps"),
    heartRate: present("averageHeartRateBpm"),
    power: present("averagePowerW"),
    cadence: present("averageCadenceRpm"),
    route: rows.filter((row) => Boolean(row.hasRoute)).length,
  };
}

function delta(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

function deltas(current: AnalyticsTotals, previous: AnalyticsTotals | null) {
  const keys = Object.keys(current) as Array<keyof AnalyticsTotals>;
  return Object.fromEntries(keys.map((key) => [key, previous ? delta(current[key], previous[key]) : null])) as Record<keyof AnalyticsTotals, number | null>;
}

function payload(activityId: string) {
  const row = db.prepare("SELECT payload_gzip payload FROM activity_payloads WHERE activity_id = ?")
    .get(activityId) as { payload: Buffer } | undefined;
  return row ? JSON.parse(gunzipSync(row.payload).toString("utf8")) as NormalizedCyclingActivityV1 : null;
}

function median(values: number[]) {
  if (!values.length) return 60;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function heartRateZones(preferences: AnalyticsPreferences) {
  const maximum = preferences.maximumHeartRateBpm;
  const resting = preferences.restingHeartRateBpm;
  if (maximum === null || resting === null || maximum <= resting) return [];
  const reserve = maximum - resting;
  const limits = [0.5, 0.6, 0.7, 0.8, 0.9, 1].map((ratio) => Math.round(resting + reserve * ratio));
  return Array.from({ length: 5 }, (_value, index) => ({
    zone: index + 1,
    fromBpm: limits[index],
    toBpm: limits[index + 1],
    seconds: 0,
    percentage: 0,
  }));
}

function activityHeartRate(activity: NormalizedCyclingActivityV1) {
  const direct = activity.series.heartRate;
  if (direct.length) return direct;
  return activity.route
    .filter((point) => point.timestamp && point.heartRateBpm !== null && point.heartRateBpm !== undefined)
    .map((point) => ({ timestamp: point.timestamp as string, value: point.heartRateBpm as number }));
}

export function calculateZoneSeconds(
  samples: Array<{ timestamp: string; value: number }>,
  zoneTemplate: ReturnType<typeof heartRateZones>,
) {
  const zones = zoneTemplate.map((zone) => ({ ...zone, seconds: 0, percentage: 0 }));
  if (!samples.length || !zones.length) return zones;
  const ordered = [...samples].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const differences = ordered.slice(1).map((sample, index) => (Date.parse(sample.timestamp) - Date.parse(ordered[index].timestamp)) / 1000)
    .filter((seconds) => seconds > 0 && seconds < 600);
  const cadence = Math.max(1, median(differences));
  ordered.forEach((sample, index) => {
    const raw = index < ordered.length - 1
      ? (Date.parse(ordered[index + 1].timestamp) - Date.parse(sample.timestamp)) / 1000
      : cadence;
    const seconds = Math.min(Math.max(raw, 1), cadence * 2);
    const zone = zones.find((candidate, zoneIndex) => sample.value >= candidate.fromBpm
      && (zoneIndex === zones.length - 1 ? sample.value <= candidate.toBpm : sample.value < candidate.toBpm));
    if (zone) zone.seconds += seconds;
  });
  const total = zones.reduce((sum, zone) => sum + zone.seconds, 0);
  zones.forEach((zone) => { zone.percentage = total ? zone.seconds / total : 0; });
  return zones;
}

function haversine(a: RoutePoint, b: RoutePoint) {
  const toRadians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRadians;
  const dLon = (b.longitude - a.longitude) * toRadians;
  const lat1 = a.latitude * toRadians;
  const lat2 = b.latitude * toRadians;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(value));
}

function routeCell(latitude: number, longitude: number) {
  const x = EARTH_RADIUS_M * longitude * Math.PI / 180;
  const safeLatitude = Math.max(-85, Math.min(85, latitude));
  const y = EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + safeLatitude * Math.PI / 360));
  return `${Math.floor(x / 250)},${Math.floor(y / 250)}`;
}

function cellCenter(key: string) {
  const [cellX, cellY] = key.split(",").map(Number);
  const x = (cellX + 0.5) * 250;
  const y = (cellY + 0.5) * 250;
  return {
    longitude: x / EARTH_RADIUS_M * 180 / Math.PI,
    latitude: (2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - Math.PI / 2) * 180 / Math.PI,
  };
}

export function routeCells(route: RoutePoint[]) {
  const cells = new Set<string>();
  if (!route.length) return cells;
  cells.add(routeCell(route[0].latitude, route[0].longitude));
  for (let index = 1; index < route.length; index += 1) {
    const a = route[index - 1];
    const b = route[index];
    const steps = Math.max(1, Math.ceil(haversine(a, b) / 100));
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      cells.add(routeCell(
        a.latitude + (b.latitude - a.latitude) * ratio,
        a.longitude + (b.longitude - a.longitude) * ratio,
      ));
    }
  }
  return cells;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return ymd(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

function consistency(rows: ActivityRow[], timezone: string) {
  const days = [...new Set(rows.map((row) => periodStart(row.startAt, "day", timezone)))].sort();
  const weeks = [...new Set(rows.map((row) => periodStart(row.startAt, "week", timezone)))].sort();
  let longest = 0;
  let run = 0;
  let previous = "";
  for (const week of weeks) {
    run = previous && addDays(previous, 7) === week ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = week;
  }
  const span = rows.length > 1
    ? Math.max(1, (Date.parse(rows.at(-1)!.startAt) - Date.parse(rows[0].startAt)) / DAY_MS)
    : 1;
  const latest = rows.at(-1);
  return {
    activeDays: days.length,
    ridesPerWeek: rows.length / Math.max(1, span / 7),
    ridesPerMonth: rows.length / Math.max(1, span / 30.4375),
    daysSinceLastRide: latest ? Math.max(0, Math.floor((Date.now() - Date.parse(latest.startAt)) / DAY_MS)) : null,
    currentWeekStreak: run,
    longestWeekStreak: longest,
  };
}

function records(rows: ActivityRow[], timezone: string, loads: Map<string, number>) {
  const result: AnalyticsRecord[] = [];
  const addRide = (
    key: AnalyticsRecord["key"], label: string, field: keyof ActivityRow,
    unit: AnalyticsRecord["unit"], candidates = rows,
  ) => {
    const best = [...candidates].filter((row) => typeof row[field] === "number")
      .sort((a, b) => Number(b[field]) - Number(a[field]))[0];
    if (best) result.push({ key, label, value: Number(best[field]), unit, activityId: best.id, periodStart: null });
  };
  addRide("distance", "Salida más larga", "distanceM", "m");
  addRide("duration", "Más tiempo sobre la bici", "durationS", "s");
  addRide("elevation", "Mayor desnivel", "elevationGainM", "m");
  addRide("speed", "Mayor velocidad media", "averageSpeedMps", "mps", rows.filter((row) => (row.distanceM ?? 0) >= 5_000 && (row.durationS ?? 0) >= 900));
  addRide("maxSpeed", "Punta de velocidad", "maximumSpeedMps", "mps", rows.filter((row) => (row.distanceM ?? 0) >= 5_000 && (row.durationS ?? 0) >= 900 && (row.maximumSpeedMps ?? Infinity) <= 120 / 3.6));
  const loadRide = [...loads.entries()].sort((a, b) => b[1] - a[1])[0];
  if (loadRide && loadRide[1] > 0) result.push({ key: "load", label: "Mayor carga de pulso", value: loadRide[1], unit: "load", activityId: loadRide[0], periodStart: null });
  for (const granularity of ["day", "week", "month", "year"] as const) {
    const best = buildSeries(rows, granularity, timezone).sort((a, b) => b.distanceM - a.distanceM)[0];
    if (best) result.push({ key: granularity, label: `Mejor ${granularity === "day" ? "día" : granularity === "week" ? "semana" : granularity === "month" ? "mes" : "año"}`, value: best.distanceM, unit: "m", activityId: null, periodStart: best.periodStart });
  }
  return result;
}

function patterns(rows: ActivityRow[], timezone: string) {
  const weekdays = Array.from({ length: 7 }, (_value, day) => ({ day, rides: 0, distanceM: 0 }));
  const hours = Array.from({ length: 24 }, (_value, hour) => ({ hour, rides: 0 }));
  let weekdayRides = 0;
  let weekendRides = 0;
  for (const row of rows) {
    const parts = localDateParts(row.startAt, timezone);
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    const sundayDay = date.getUTCDay();
    const mondayDay = (sundayDay + 6) % 7;
    weekdays[mondayDay].rides += 1;
    weekdays[mondayDay].distanceM += row.distanceM ?? 0;
    hours[parts.hour].rides += 1;
    if (mondayDay >= 5) weekendRides += 1;
    else weekdayRides += 1;
  }
  return { weekdays, hours, weekdayRides, weekendRides };
}

function terrain(rows: ActivityRow[]) {
  const ratios = rows.filter((row) => (row.distanceM ?? 0) > 0 && row.elevationGainM !== null)
    .map((row) => (row.elevationGainM ?? 0) / (row.distanceM ?? 1)).sort((a, b) => a - b);
  const low = ratios[Math.floor(ratios.length / 3)] ?? 0;
  const high = ratios[Math.floor(ratios.length * 2 / 3)] ?? 0;
  let flatRides = 0;
  let rollingRides = 0;
  let mountainRides = 0;
  for (const ratio of ratios) {
    if (ratio <= low) flatRides += 1;
    else if (ratio <= high) rollingRides += 1;
    else mountainRides += 1;
  }
  const totalDistance = rows.reduce((sum, row) => sum + (row.distanceM ?? 0), 0);
  const totalElevation = rows.reduce((sum, row) => sum + (row.elevationGainM ?? 0), 0);
  return {
    elevationPer100Km: totalDistance > 0 ? totalElevation / totalDistance * 100_000 : null,
    flatRides,
    rollingRides,
    mountainRides,
    scatter: rows.filter((row) => row.distanceM !== null && row.elevationGainM !== null).map((row) => ({
      activityId: row.id,
      distanceM: row.distanceM ?? 0,
      elevationGainM: row.elevationGainM ?? 0,
      averageSpeedMps: row.averageSpeedMps,
      averageHeartRateBpm: row.averageHeartRateBpm,
    })),
  };
}

function goalElapsedRatio(period: string, now: Date) {
  const start = period.length === 4 ? new Date(`${period}-01-01T00:00:00Z`) : new Date(`${period}-01T00:00:00Z`);
  const end = period.length === 4
    ? new Date(`${Number(period) + 1}-01-01T00:00:00Z`)
    : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  if (now < start) return 0;
  if (now >= end) return 1;
  return (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
}

function goalProgress(rows: ActivityRow[], timezone: string) {
  const now = new Date();
  const parts = localDateParts(now, timezone);
  const periods = [String(parts.year), `${parts.year}-${parts.month.toString().padStart(2, "0")}`];
  const goals = db.prepare(`SELECT period, distance_m distanceM, duration_s durationS,
    elevation_gain_m elevationGainM, rides FROM period_goals WHERE period IN (?, ?) ORDER BY length(period)`)
    .all(...periods) as PeriodGoal[];
  return goals.map((goal) => {
    const selected = rows.filter((row) => {
      const date = periodStart(row.startAt, goal.period.length === 4 ? "year" : "month", timezone);
      return date === goal.period;
    });
    const actual = totals(selected);
    return {
      ...goal,
      actual: {
        distanceM: actual.distanceM,
        durationS: actual.durationS,
        elevationGainM: actual.elevationGainM,
        rides: actual.rides,
      },
      elapsedRatio: goalElapsedRatio(goal.period, now),
    } satisfies PeriodGoalProgress;
  });
}

function comparisonRange(fromMs: number, toMs: number, timezone: string) {
  const from = localDateParts(fromMs, timezone);
  const to = localDateParts(toMs, timezone);
  const now = localDateParts(Date.now(), timezone);
  if (from.month === 1 && from.day === 1 && from.year === now.year && to.year === now.year) {
    const previousFrom = Date.UTC(from.year - 1, 0, 1);
    const previousTo = Date.UTC(to.year - 1, to.month - 1, to.day, to.hour);
    return [previousFrom, previousTo] as const;
  }
  const duration = toMs - fromMs;
  return [fromMs - duration - 1, fromMs - 1] as const;
}

function queryRange(from: string | undefined, to: string | undefined, timezone: string) {
  const now = new Date();
  const parts = localDateParts(now, timezone);
  const fromMs = from ? Date.parse(from) : Date.parse(`${parts.year}-01-01T00:00:00Z`);
  const toMs = to ? Date.parse(to) : now.getTime();
  return { fromMs, toMs };
}

function signature() {
  const activity = db.prepare("SELECT COUNT(*) count, COALESCE(MAX(updated_at), '') value FROM activities").get() as { count: number; value: string };
  const preferences = db.prepare("SELECT updated_at value FROM analytics_preferences WHERE id = 1").get() as { value: string };
  const goals = db.prepare("SELECT COALESCE(MAX(updated_at), '') value FROM period_goals").get() as { value: string };
  return `${activity.count}:${activity.value}|${preferences.value}|${goals.value}`;
}

export function dashboardSummary(query: { from?: string; to?: string; groupBy?: TimeGranularity }): DashboardSummary {
  const preferences = readPreferences();
  const granularity = ["day", "week", "month", "year"].includes(query.groupBy ?? "")
    ? query.groupBy as TimeGranularity
    : "week";
  const rows = allRows();
  const fromMs = query.from ? Date.parse(query.from) : Number.NEGATIVE_INFINITY;
  const toMs = query.to ? Date.parse(query.to) : Number.POSITIVE_INFINITY;
  const selected = filterRows(rows, fromMs, toMs, "all");
  const summary = totals(selected);
  return {
    from: query.from ?? null,
    to: query.to ?? null,
    granularity,
    ...summary,
    series: buildSeries(selected, granularity, preferences.timezone),
  };
}

function overview(query: {
  from?: string;
  to?: string;
  groupBy?: TimeGranularity;
  activityType?: ActivityTypeFilter;
  compare?: "previous" | "none";
}) {
  const preferences = readPreferences();
  const granularity = ["day", "week", "month", "year"].includes(query.groupBy ?? "") ? query.groupBy as TimeGranularity : "month";
  const activityType = ["all", "outdoor", "indoor"].includes(query.activityType ?? "") ? query.activityType as ActivityTypeFilter : "all";
  const { fromMs, toMs } = queryRange(query.from, query.to, preferences.timezone);
  const key = `${signature()}|${fromMs}|${toMs}|${granularity}|${activityType}|${query.compare ?? "previous"}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const rows = allRows();
  const selected = filterRows(rows, fromMs, toMs, activityType);
  const [previousFrom, previousTo] = comparisonRange(fromMs, toMs, preferences.timezone);
  const previous = query.compare === "none" ? [] : filterRows(rows, previousFrom, previousTo, activityType);
  const zoneTemplate = heartRateZones(preferences);
  const aggregateZones = zoneTemplate.map((zone) => ({ ...zone }));
  const loads = new Map<string, number>();
  const selectedCells = new Map<string, number>();
  const historicCells = new Set<string>();

  for (const row of rows.filter((candidate) => Date.parse(candidate.startAt) < fromMs && candidate.hasRoute)) {
    const full = payload(row.id);
    if (full) routeCells(full.route).forEach((cell) => historicCells.add(cell));
  }
  for (const row of selected) {
    const full = payload(row.id);
    if (!full) continue;
    const zones = calculateZoneSeconds(activityHeartRate(full), zoneTemplate);
    const load = zones.reduce((sum, zone) => sum + zone.seconds / 60 * zone.zone, 0);
    loads.set(row.id, load);
    zones.forEach((zone, index) => { aggregateZones[index].seconds += zone.seconds; });
    if (full.route.length) {
      routeCells(full.route).forEach((cell) => selectedCells.set(cell, (selectedCells.get(cell) ?? 0) + 1));
    }
  }
  const totalZoneSeconds = aggregateZones.reduce((sum, zone) => sum + zone.seconds, 0);
  aggregateZones.forEach((zone) => { zone.percentage = totalZoneSeconds ? zone.seconds / totalZoneSeconds : 0; });
  const currentTotals = totals(selected);
  const previousTotals = query.compare === "none" ? null : totals(previous);
  const calendar = buildSeries(selected, "day", preferences.timezone).map((point) => ({
    date: point.periodStart, rides: point.rides, distanceM: point.distanceM, durationS: point.durationS,
  }));
  const goalValues = goalProgress(rows, preferences.timezone);
  const insights: string[] = [];
  const distanceDelta = previousTotals ? delta(currentTotals.distanceM, previousTotals.distanceM) : null;
  if (distanceDelta !== null && Math.abs(distanceDelta) >= 0.1) insights.push(
    `${Math.abs(distanceDelta * 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })} % ${distanceDelta > 0 ? "más" : "menos"} distancia que en el periodo anterior.`,
  );
  const bestMonth = buildSeries(selected, "month", preferences.timezone).sort((a, b) => b.distanceM - a.distanceM)[0];
  if (bestMonth) {
    const label = spanishPeriodLabel(bestMonth.periodStart);
    insights.push(`${label.charAt(0).toUpperCase()}${label.slice(1)} es tu mes más largo del periodo, con ${(bestMonth.distanceM / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} km.`);
  }
  const newCells = [...selectedCells.keys()].filter((cell) => !historicCells.has(cell)).length;
  if (newCells > 0) insights.push(`Has recorrido ${newCells.toLocaleString("es-ES")} zonas nuevas del mapa que no aparecían en tu historial anterior.`);
  const distanceGoal = goalValues.find((goal) => goal.distanceM);
  if (distanceGoal?.distanceM && distanceGoal.elapsedRatio > 0) {
    const pace = distanceGoal.actual.distanceM / distanceGoal.distanceM - distanceGoal.elapsedRatio;
    insights.push(`Vas ${pace >= 0 ? "por delante" : "por detrás"} del ritmo de tu objetivo de ${spanishPeriodLabel(distanceGoal.period)}.`);
  }

  const result: AnalyticsOverview = {
    range: {
      from: Number.isFinite(fromMs) ? new Date(fromMs).toISOString() : null,
      to: Number.isFinite(toMs) ? new Date(toMs).toISOString() : null,
      granularity,
      activityType,
    },
    totals: currentTotals,
    previousTotals,
    deltas: deltas(currentTotals, previousTotals),
    coverage: coverage(selected),
    timeline: buildSeries(selected, granularity, preferences.timezone, loads),
    previousTimeline: buildSeries(previous, granularity, preferences.timezone),
    calendar,
    consistency: consistency(selected, preferences.timezone),
    records: records(selected, preferences.timezone, loads),
    patterns: patterns(selected, preferences.timezone),
    terrain: terrain(selected),
    heartRate: {
      configured: zoneTemplate.length > 0,
      zones: aggregateZones,
      totalLoad: [...loads.values()].reduce((sum, value) => sum + value, 0),
      scatter: selected.filter((row) => row.averageHeartRateBpm !== null).map((row) => ({
        activityId: row.id,
        averageHeartRateBpm: row.averageHeartRateBpm as number,
        averageSpeedMps: row.averageSpeedMps,
        distanceM: row.distanceM ?? 0,
        elevationGainM: row.elevationGainM ?? 0,
      })),
    },
    exploration: {
      gpsDistanceM: selected.filter((row) => row.hasRoute).reduce((sum, row) => sum + (row.distanceM ?? 0), 0),
      cells: selectedCells.size,
      newCells,
      heatCells: [...selectedCells.entries()].map(([cell, visits]) => ({ ...cellCenter(cell), visits })),
    },
    goals: goalValues,
    insights: insights.slice(0, 4),
  };
  cache.set(key, result);
  if (cache.size > 32) cache.delete(cache.keys().next().value as string);
  return result;
}

function validPreference(body: AnalyticsPreferences) {
  const maximum = body.maximumHeartRateBpm;
  const resting = body.restingHeartRateBpm;
  return typeof body.timezone === "string" && body.timezone.length <= 80
    && (maximum === null || (maximum >= 100 && maximum <= 230))
    && (resting === null || (resting >= 30 && resting <= 100))
    && (maximum === null || resting === null || maximum > resting);
}

function validGoal(period: string, body: PeriodGoal) {
  const validPeriod = /^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(period);
  const values = [body.distanceM, body.durationS, body.elevationGainM, body.rides];
  return validPeriod && values.every((value) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0));
}

export async function registerAnalyticsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { from?: string; to?: string; groupBy?: TimeGranularity; activityType?: ActivityTypeFilter; compare?: "previous" | "none" } }>(
    "/api/analytics",
    { preHandler: requireSession },
    async (request) => overview(request.query),
  );

  app.get("/api/analytics/preferences", { preHandler: requireSession }, async () => readPreferences());
  app.put<{ Body: AnalyticsPreferences }>(
    "/api/analytics/preferences",
    { preHandler: requireSession },
    async (request, reply) => {
      if (!validPreference(request.body)) return reply.code(400).send({ error: "invalid_analytics_preferences" });
      db.prepare(`UPDATE analytics_preferences SET timezone = ?, maximum_heart_rate_bpm = ?,
        resting_heart_rate_bpm = ?, updated_at = ? WHERE id = 1`).run(
        request.body.timezone,
        request.body.maximumHeartRateBpm,
        request.body.restingHeartRateBpm,
        new Date().toISOString(),
      );
      cache.clear();
      return readPreferences();
    },
  );

  app.get<{ Params: { period: string } }>(
    "/api/analytics/goals/:period",
    { preHandler: requireSession },
    async (request, reply) => {
      if (!/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(request.params.period)) return reply.code(400).send({ error: "invalid_goal_period" });
      const goal = db.prepare(`SELECT period, distance_m distanceM, duration_s durationS,
        elevation_gain_m elevationGainM, rides FROM period_goals WHERE period = ?`).get(request.params.period) as PeriodGoal | undefined;
      return goal ?? { period: request.params.period, distanceM: null, durationS: null, elevationGainM: null, rides: null };
    },
  );
  app.put<{ Params: { period: string }; Body: PeriodGoal }>(
    "/api/analytics/goals/:period",
    { preHandler: requireSession },
    async (request, reply) => {
      if (!validGoal(request.params.period, request.body)) return reply.code(400).send({ error: "invalid_period_goal" });
      db.prepare(`INSERT INTO period_goals(period, distance_m, duration_s, elevation_gain_m, rides, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(period) DO UPDATE SET distance_m=excluded.distance_m,
        duration_s=excluded.duration_s, elevation_gain_m=excluded.elevation_gain_m,
        rides=excluded.rides, updated_at=excluded.updated_at`).run(
        request.params.period,
        request.body.distanceM,
        request.body.durationS,
        request.body.elevationGainM,
        request.body.rides,
        new Date().toISOString(),
      );
      cache.clear();
      return { ...request.body, period: request.params.period };
    },
  );
}
