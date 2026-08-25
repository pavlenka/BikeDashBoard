import { SaxesParser, type SaxesTagPlain } from "saxes";

import {
  DATA_SCHEMA_VERSION,
  type ImportPreview,
  type MetricValue,
  type NormalizedCyclingActivityV1,
  type RoutePoint,
  type SensorSeriesPoint,
} from "../../shared/contracts";

type AttributeMap = Record<string, string>;
type XmlSource = Blob | string | ReadableStream<Uint8Array>;

interface RawStatistic {
  average?: number;
  maximum?: number;
  minimum?: number;
  sum?: number;
  unit?: string;
}

interface RawWorkout {
  sourceId: string;
  sourceName: string;
  startAt: string;
  endAt: string;
  timezone: string;
  durationS: number | null;
  distanceM: number | null;
  energyKcal: number | null;
  stats: Record<string, RawStatistic>;
  metadata: Record<string, string>;
  series: Record<string, SensorSeriesPoint[]>;
}

const RELEVANT_RECORD_TYPES = new Set([
  "HKQuantityTypeIdentifierHeartRate",
  "HKQuantityTypeIdentifierCyclingSpeed",
  "HKQuantityTypeIdentifierCyclingPower",
  "HKQuantityTypeIdentifierCyclingCadence",
]);

function attributes(tag: SaxesTagPlain): AttributeMap {
  return Object.fromEntries(
    Object.entries(tag.attributes).map(([key, value]) => [key, value]),
  );
}

export function parseAppleDate(value: string): string {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*([+-]\d{2})(\d{2})$/,
  );
  const normalized = match
    ? `${match[1]}T${match[2]}${match[3]}:${match[4]}`
    : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error(`Fecha de Apple no reconocida: ${value}`);
  return date.toISOString();
}

function timezoneFromDate(value: string) {
  const match = value.match(/([+-])(\d{2})(\d{2})$/);
  return match ? `UTC${match[1]}${match[2]}:${match[3]}` : "Europe/Madrid";
}

function number(value: string | undefined) {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function seconds(value: string | undefined, unit: string | undefined) {
  const amount = number(value);
  if (amount === null) return null;
  if (unit === "min") return amount * 60;
  if (unit === "h" || unit === "hr") return amount * 3600;
  return amount;
}

function meters(value: string | undefined, unit: string | undefined) {
  const amount = number(value);
  if (amount === null) return null;
  if (unit === "km") return amount * 1000;
  if (unit === "mi") return amount * 1609.344;
  if (unit === "ft") return amount * 0.3048;
  return amount;
}

function kcal(value: string | undefined, unit: string | undefined) {
  const amount = number(value);
  if (amount === null) return null;
  if (unit === "kJ") return amount / 4.184;
  return amount;
}

function speedMetersPerSecond(value: number | null | undefined, unit: string | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (unit === "km/hr" || unit === "km/h") return value / 3.6;
  if (unit === "mi/hr" || unit === "mph") return value * 0.44704;
  return value;
}

async function feedXml(
  source: XmlSource,
  configure: (parser: SaxesParser) => void,
  onProgress?: (progress: number) => void,
) {
  const parser = new SaxesParser({ xmlns: false });
  configure(parser);
  if (typeof source === "string") {
    parser.write(source).close();
    onProgress?.(1);
    return;
  }
  const stream = source instanceof Blob ? source.stream() : source;
  const totalSize = source instanceof Blob ? source.size : null;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let consumed = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      consumed += value.byteLength;
      parser.write(decoder.decode(value, { stream: true }));
      if (totalSize) onProgress?.(Math.min(consumed / totalSize, 0.99));
    }
    parser.write(decoder.decode()).close();
    onProgress?.(1);
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  }
}

export async function parseCyclingWorkouts(
  xml: XmlSource,
  onProgress?: (progress: number) => void,
): Promise<RawWorkout[]> {
  const workouts: RawWorkout[] = [];
  let current: RawWorkout | null = null;

  await feedXml(
    xml,
    (parser) => {
      parser.on("opentag", (tag) => {
        const attrs = attributes(tag);
        if (tag.name === "Workout") {
          if (!attrs.workoutActivityType?.includes("Cycling")) {
            current = null;
            return;
          }
          current = {
            sourceId: attrs.uuid || `${attrs.sourceName}-${attrs.startDate}`,
            sourceName: attrs.sourceName || "Apple Health",
            startAt: parseAppleDate(attrs.startDate),
            endAt: parseAppleDate(attrs.endDate),
            timezone: timezoneFromDate(attrs.startDate),
            durationS: seconds(attrs.duration, attrs.durationUnit),
            distanceM: meters(attrs.totalDistance, attrs.totalDistanceUnit),
            energyKcal: kcal(attrs.totalEnergyBurned, attrs.totalEnergyBurnedUnit),
            stats: {},
            metadata: {},
            series: {},
          };
        } else if (tag.name === "WorkoutStatistics" && current) {
          current.stats[attrs.type] = {
            average: number(attrs.average) ?? undefined,
            maximum: number(attrs.maximum) ?? undefined,
            minimum: number(attrs.minimum) ?? undefined,
            sum: number(attrs.sum) ?? undefined,
            unit: attrs.unit,
          };
        } else if (tag.name === "MetadataEntry" && current && attrs.key) {
          current.metadata[attrs.key] = attrs.value ?? "";
        }
      });
      parser.on("closetag", (tag) => {
        if (tag.name === "Workout" && current) workouts.push(current);
        if (tag.name === "Workout") current = null;
      });
    },
    onProgress,
  );
  return workouts.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

function findWorkoutAt(workouts: RawWorkout[], timestamp: string) {
  const time = Date.parse(timestamp);
  let low = 0;
  let high = workouts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const workout = workouts[middle];
    if (time < Date.parse(workout.startAt)) high = middle - 1;
    else if (time > Date.parse(workout.endAt)) low = middle + 1;
    else return workout;
  }
  return null;
}

export async function attachSensorSeries(
  xml: XmlSource,
  workouts: RawWorkout[],
  onProgress?: (progress: number) => void,
) {
  await feedXml(
    xml,
    (parser) => {
      parser.on("opentag", (tag) => {
        if (tag.name !== "Record") return;
        const attrs = attributes(tag);
        if (!RELEVANT_RECORD_TYPES.has(attrs.type)) return;
        const rawValue = number(attrs.value);
        const parsed =
          attrs.type === "HKQuantityTypeIdentifierCyclingSpeed"
            ? speedMetersPerSecond(rawValue, attrs.unit)
            : rawValue;
        if (parsed === null || !attrs.startDate) return;
        const timestamp = parseAppleDate(attrs.startDate);
        const workout = findWorkoutAt(workouts, timestamp);
        if (!workout) return;
        const bucket = (workout.series[attrs.type] ??= []);
        bucket.push({ timestamp, value: parsed });
      });
    },
    onProgress,
  );
}

export async function parseGpx(source: XmlSource): Promise<RoutePoint[]> {
  const points: RoutePoint[] = [];
  let current: RoutePoint | null = null;
  let field: "ele" | "time" | null = null;
  let text = "";
  await feedXml(source, (parser) => {
    parser.on("opentag", (tag) => {
      if (tag.name === "trkpt") {
        const attrs = attributes(tag);
        current = {
          latitude: Number(attrs.lat),
          longitude: Number(attrs.lon),
          elevationM: null,
          timestamp: null,
        };
      } else if (current && (tag.name === "ele" || tag.name === "time")) {
        field = tag.name;
        text = "";
      }
    });
    parser.on("text", (value) => {
      if (field) text += value;
    });
    parser.on("closetag", (tag) => {
      if (current && tag.name === "ele") current.elevationM = number(text.trim());
      if (current && tag.name === "time") {
        const date = new Date(text.trim());
        current.timestamp = Number.isNaN(date.getTime()) ? null : date.toISOString();
      }
      if (tag.name === "ele" || tag.name === "time") field = null;
      if (tag.name === "trkpt" && current) {
        if (Number.isFinite(current.latitude) && Number.isFinite(current.longitude)) {
          points.push(current);
        }
        current = null;
      }
    });
  });
  return points;
}

function haversine(left: RoutePoint, right: RoutePoint) {
  const radius = 6_371_000;
  const toRad = Math.PI / 180;
  const lat1 = left.latitude * toRad;
  const lat2 = right.latitude * toRad;
  const deltaLat = (right.latitude - left.latitude) * toRad;
  const deltaLon = (right.longitude - left.longitude) * toRad;
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function routeCalculations(route: RoutePoint[]) {
  let distanceM = 0;
  let movingTimeS = 0;
  let maximumSpeedMps = 0;
  const elevations = route.map((point, index) => {
    const nearby = route
      .slice(Math.max(0, index - 2), Math.min(route.length, index + 3))
      .map((candidate) => candidate.elevationM)
      .filter((value): value is number => value !== null);
    return nearby.length ? median(nearby) : null;
  });
  let elevationGainM = 0;
  for (let index = 1; index < route.length; index += 1) {
    const previous = route[index - 1];
    const point = route[index];
    const segmentDistance = haversine(previous, point);
    distanceM += segmentDistance;
    if (previous.timestamp && point.timestamp) {
      const delta = (Date.parse(point.timestamp) - Date.parse(previous.timestamp)) / 1000;
      if (delta > 0 && delta <= 120) {
        const speed = segmentDistance / delta;
        point.speedMps = speed;
        maximumSpeedMps = Math.max(maximumSpeedMps, speed);
        if (speed >= 1) movingTimeS += delta;
      }
    }
    const elevationDelta =
      elevations[index] !== null && elevations[index - 1] !== null
        ? elevations[index]! - elevations[index - 1]!
        : 0;
    if (elevationDelta >= 3) elevationGainM += elevationDelta;
  }
  return { distanceM, movingTimeS, maximumSpeedMps, elevationGainM };
}

function appleOrCalculated(apple: number | null | undefined, calculated?: number | null): MetricValue {
  if (apple !== null && apple !== undefined && Number.isFinite(apple)) {
    return { value: apple, origin: "apple" };
  }
  if (calculated !== null && calculated !== undefined && Number.isFinite(calculated)) {
    return { value: calculated, origin: "calculated" };
  }
  return { value: null, origin: "unavailable" };
}

function average(series: SensorSeriesPoint[]) {
  return series.length ? series.reduce((sum, point) => sum + point.value, 0) / series.length : null;
}

function maximum(series: SensorSeriesPoint[]) {
  return series.length ? Math.max(...series.map((point) => point.value)) : null;
}

function closestValue(series: SensorSeriesPoint[], timestamp: string | null, cursor: { index: number }) {
  if (!timestamp || !series.length) return null;
  const target = Date.parse(timestamp);
  while (
    cursor.index + 1 < series.length &&
    Math.abs(Date.parse(series[cursor.index + 1].timestamp) - target) <=
      Math.abs(Date.parse(series[cursor.index].timestamp) - target)
  ) {
    cursor.index += 1;
  }
  const point = series[cursor.index];
  return Math.abs(Date.parse(point.timestamp) - target) <= 15_000 ? point.value : null;
}

function stat(workout: RawWorkout, type: string) {
  return workout.stats[type] ?? {};
}

export function normalizeWorkouts(
  workouts: RawWorkout[],
  routes: RoutePoint[][],
): { activities: NormalizedCyclingActivityV1[]; preview: ImportPreview } {
  const availableRoutes = routes
    .filter((route) => route.length > 1 && route[0].timestamp)
    .map((route) => ({ route, used: false, start: Date.parse(route[0].timestamp!) }));
  const globalWarnings: string[] = [];

  const activities = workouts.map((workout) => {
    const start = Date.parse(workout.startAt);
    const end = Date.parse(workout.endAt);
    const routeCandidate = availableRoutes
      .filter((candidate) => !candidate.used)
      .map((candidate) => ({ ...candidate, delta: Math.abs(candidate.start - start) }))
      .filter((candidate) => candidate.start >= start - 5 * 60_000 && candidate.start <= end + 5 * 60_000)
      .sort((a, b) => a.delta - b.delta)[0];
    if (routeCandidate) {
      const original = availableRoutes.find((candidate) => candidate.route === routeCandidate.route);
      if (original) original.used = true;
    }
    const route = routeCandidate?.route ?? [];
    const calculated = routeCalculations(route);
    const heartRate = workout.series.HKQuantityTypeIdentifierHeartRate ?? [];
    const power = workout.series.HKQuantityTypeIdentifierCyclingPower ?? [];
    const cadence = workout.series.HKQuantityTypeIdentifierCyclingCadence ?? [];
    const speed = workout.series.HKQuantityTypeIdentifierCyclingSpeed ?? [];
    const cursors = {
      heartRate: { index: 0 },
      power: { index: 0 },
      cadence: { index: 0 },
      speed: { index: 0 },
    };
    route.forEach((point) => {
      point.heartRateBpm = closestValue(heartRate, point.timestamp, cursors.heartRate);
      point.powerW = closestValue(power, point.timestamp, cursors.power);
      point.cadenceRpm = closestValue(cadence, point.timestamp, cursors.cadence);
      point.speedMps ??= closestValue(speed, point.timestamp, cursors.speed);
    });
    const heartStat = stat(workout, "HKQuantityTypeIdentifierHeartRate");
    const powerStat = stat(workout, "HKQuantityTypeIdentifierCyclingPower");
    const cadenceStat = stat(workout, "HKQuantityTypeIdentifierCyclingCadence");
    const speedStat = stat(workout, "HKQuantityTypeIdentifierCyclingSpeed");
    const elevationStat = stat(workout, "HKQuantityTypeIdentifierElevationAscended");
    const distanceStat = stat(workout, "HKQuantityTypeIdentifierDistanceCycling");
    const energyStat = stat(workout, "HKQuantityTypeIdentifierActiveEnergyBurned");
    const warnings: string[] = [];
    if (!route.length) warnings.push("Ruta GPS no disponible para esta actividad.");

    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      sourceId: workout.sourceId,
      sourceName: workout.sourceName,
      title: "Salida en bicicleta",
      startAt: workout.startAt,
      endAt: workout.endAt,
      timezone: workout.timezone,
      indoor:
        workout.metadata.HKIndoorWorkout === "1" ||
        workout.metadata.HKIndoorWorkout?.toLowerCase() === "true",
      durationS: appleOrCalculated(workout.durationS, (end - start) / 1000),
      movingTimeS: appleOrCalculated(null, calculated.movingTimeS || null),
      distanceM: appleOrCalculated(
        workout.distanceM ?? meters(String(distanceStat.sum ?? ""), distanceStat.unit),
        calculated.distanceM || null,
      ),
      energyKcal: appleOrCalculated(
        workout.energyKcal ?? kcal(String(energyStat.sum ?? ""), energyStat.unit),
      ),
      elevationGainM: appleOrCalculated(
        meters(String(elevationStat.sum ?? ""), elevationStat.unit),
        calculated.elevationGainM || null,
      ),
      averageSpeedMps: appleOrCalculated(
        speedMetersPerSecond(speedStat.average, speedStat.unit),
        average(speed) ??
          (calculated.movingTimeS ? calculated.distanceM / calculated.movingTimeS : null),
      ),
      maximumSpeedMps: appleOrCalculated(
        speedMetersPerSecond(speedStat.maximum, speedStat.unit),
        maximum(speed) ?? (calculated.maximumSpeedMps || null),
      ),
      averageHeartRateBpm: appleOrCalculated(heartStat.average, average(heartRate)),
      maximumHeartRateBpm: appleOrCalculated(heartStat.maximum, maximum(heartRate)),
      averagePowerW: appleOrCalculated(powerStat.average, average(power)),
      maximumPowerW: appleOrCalculated(powerStat.maximum, maximum(power)),
      averageCadenceRpm: appleOrCalculated(cadenceStat.average, average(cadence)),
      maximumCadenceRpm: appleOrCalculated(cadenceStat.maximum, maximum(cadence)),
      route,
      series: { heartRate, power, cadence, speed },
      warnings,
    } satisfies NormalizedCyclingActivityV1;
  });

  const unusedRoutes = availableRoutes.filter((route) => !route.used).length;
  if (unusedRoutes) globalWarnings.push(`${unusedRoutes} rutas GPX no pudieron asociarse a una salida.`);
  const dates = activities.map((activity) => activity.startAt).sort();
  return {
    activities,
    preview: {
      totalCyclingActivities: activities.length,
      activitiesWithRoutes: activities.filter((activity) => activity.route.length > 0).length,
      activitiesWithoutRoutes: activities.filter((activity) => activity.route.length === 0).length,
      dateFrom: dates.at(0) ?? null,
      dateTo: dates.at(-1) ?? null,
      warnings: globalWarnings,
    },
  };
}
