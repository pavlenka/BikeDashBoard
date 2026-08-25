import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  DATA_SCHEMA_VERSION,
  type MetricValue,
  type NormalizedCyclingActivityV1,
  type RoutePoint,
  type SensorSeriesPoint,
} from "../shared/contracts.js";
import { upsertActivity } from "./activities.js";
import { config } from "./config.js";
import { db } from "./db.js";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

interface Quantity {
  qty: number;
  units: string;
}

function quantity(value: unknown): Quantity | null {
  const record = object(value);
  if (!record) return null;
  const qty = finite(record.qty);
  if (qty === null) return null;
  return { qty, units: text(record.units) ?? "" };
}

function convertDistance(value: unknown): number | null {
  const metric = quantity(value);
  if (!metric) return finite(value);
  const unit = metric.units.toLowerCase();
  if (["km", "kilometer", "kilometers"].includes(unit)) return metric.qty * 1000;
  if (["mi", "mile", "miles"].includes(unit)) return metric.qty * 1609.344;
  if (["ft", "foot", "feet"].includes(unit)) return metric.qty * 0.3048;
  if (["yd", "yard", "yards"].includes(unit)) return metric.qty * 0.9144;
  return metric.qty;
}

function convertEnergy(value: unknown): number | null {
  const metric = quantity(value);
  if (!metric) return finite(value);
  return metric.units.toLowerCase() === "kj" ? metric.qty / 4.184 : metric.qty;
}

function convertSpeed(value: unknown, defaultUnit = "m/s"): number | null {
  const metric = quantity(value);
  const qty = metric?.qty ?? finite(value);
  if (qty === null) return null;
  const unit = (metric?.units ?? defaultUnit).toLowerCase().replace(/\s+/g, "");
  // Health Auto Export can emit localized/HealthKit variants such as km/hr,
  // km/h, kmph or km·h⁻¹ depending on its unit transformation setting.
  if (unit.includes("km")) return qty / 3.6;
  if (unit.includes("mph") || unit.includes("mi/")) return qty * 0.44704;
  return qty;
}

function apple(value: number | null): MetricValue {
  return value === null
    ? { value: null, origin: "unavailable" }
    : { value, origin: "apple" };
}

function appleOrCalculated(appleValue: number | null, calculated: number | null): MetricValue {
  if (appleValue !== null) return { value: appleValue, origin: "apple" };
  if (calculated !== null && Number.isFinite(calculated)) {
    return { value: calculated, origin: "calculated" };
  }
  return { value: null, origin: "unavailable" };
}

export function parseHealthAutoExportDate(value: unknown): string {
  const raw = text(value);
  if (!raw) throw new Error("missing_date");
  const match = raw.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*([+-]\d{2})(\d{2})$/,
  );
  const normalized = match
    ? `${match[1]}T${match[2]}${match[3]}:${match[4]}`
    : raw.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error("invalid_date");
  return date.toISOString();
}

function timezoneFromDate(value: unknown) {
  const match = text(value)?.match(/([+-])(\d{2})(\d{2})$/);
  return match ? `UTC${match[1]}${match[2]}:${match[3]}` : "Europe/Madrid";
}

function quantitySeries(
  value: unknown,
  convert: (value: unknown) => number | null = (item) => quantity(item)?.qty ?? null,
): SensorSeriesPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = object(item);
    if (!record) return [];
    try {
      const timestamp = parseHealthAutoExportDate(record.date ?? record.timestamp);
      const converted = convert(record);
      return converted === null ? [] : [{ timestamp, value: converted }];
    } catch {
      return [];
    }
  });
}

function heartRateSeries(value: unknown): SensorSeriesPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = object(item);
    if (!record) return [];
    try {
      const timestamp = parseHealthAutoExportDate(record.date ?? record.timestamp);
      const bpm = finite(record.Avg ?? record.avg ?? record.qty);
      return bpm === null ? [] : [{ timestamp, value: bpm }];
    } catch {
      return [];
    }
  });
}

function routePoints(value: unknown): RoutePoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = object(item);
    if (!record) return [];
    const latitude = finite(record.latitude ?? record.lat);
    const longitude = finite(record.longitude ?? record.lon);
    if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return [];
    }
    let timestamp: string | null = null;
    try {
      if (record.timestamp) timestamp = parseHealthAutoExportDate(record.timestamp);
    } catch {
      // A coordinate is still useful if one timestamp is malformed.
    }
    return [{
      latitude,
      longitude,
      elevationM: finite(record.altitude),
      timestamp,
      speedMps: convertSpeed(record.speed),
    }];
  });
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

function routeCalculations(route: RoutePoint[]) {
  let distanceM = 0;
  let movingTimeS = 0;
  let elevationGainM = 0;
  let previousElevation: number | null = null;
  const speeds: number[] = [];
  for (let index = 0; index < route.length; index += 1) {
    const point = route[index];
    if (point.elevationM !== null) {
      if (previousElevation !== null && point.elevationM - previousElevation >= 3) {
        elevationGainM += point.elevationM - previousElevation;
      }
      previousElevation = point.elevationM;
    }
    if (index === 0) continue;
    const previous = route[index - 1];
    const segmentDistance = haversine(previous, point);
    distanceM += segmentDistance;
    if (previous.timestamp && point.timestamp) {
      const deltaS = (Date.parse(point.timestamp) - Date.parse(previous.timestamp)) / 1000;
      if (deltaS > 0 && deltaS <= 120) {
        const speed = point.speedMps ?? segmentDistance / deltaS;
        if (point.speedMps === null || point.speedMps === undefined) point.speedMps = speed;
        speeds.push(speed);
        if (speed >= 1) movingTimeS += deltaS;
      }
    }
  }
  return {
    distanceM: distanceM || null,
    movingTimeS: movingTimeS || null,
    elevationGainM: elevationGainM || null,
    averageSpeedMps: speeds.length ? speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length : null,
    maximumSpeedMps: speeds.length ? Math.max(...speeds) : null,
  };
}

function average(series: SensorSeriesPoint[]) {
  return series.length ? series.reduce((sum, point) => sum + point.value, 0) / series.length : null;
}

function maximum(series: SensorSeriesPoint[]) {
  return series.length ? Math.max(...series.map((point) => point.value)) : null;
}

function summaryQuantity(record: JsonObject, directKey: string, groupKey: string, member: string) {
  const direct = quantity(record[directKey]);
  if (direct) return direct.qty;
  return quantity(object(record[groupKey])?.[member])?.qty ?? null;
}

function nearest(series: SensorSeriesPoint[], timestamp: string | null) {
  if (!timestamp || !series.length) return null;
  const target = Date.parse(timestamp);
  let closest = series[0];
  for (const point of series) {
    if (Math.abs(Date.parse(point.timestamp) - target) < Math.abs(Date.parse(closest.timestamp) - target)) {
      closest = point;
    }
  }
  return Math.abs(Date.parse(closest.timestamp) - target) <= 90_000 ? closest.value : null;
}

export function normalizeHealthAutoExportWorkout(rawValue: unknown): NormalizedCyclingActivityV1 {
  const raw = object(rawValue);
  if (!raw) throw new Error("invalid_workout");
  const id = text(raw.id);
  const name = text(raw.name);
  if (!id || !name) throw new Error("invalid_workout");
  const startAt = parseHealthAutoExportDate(raw.start);
  const endAt = parseHealthAutoExportDate(raw.end);
  if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error("invalid_workout_range");

  const heartRate = heartRateSeries(raw.heartRateData);
  const power = quantitySeries(raw.cyclingPower);
  const cadence = quantitySeries(raw.cyclingCadence);
  const speed = quantitySeries(raw.cyclingSpeed, (item) => {
    const metric = object(item);
    return metric ? convertSpeed({ qty: metric.qty, units: metric.units }) : null;
  });
  const route = routePoints(raw.route);
  const calculated = routeCalculations(route);

  route.forEach((point) => {
    point.heartRateBpm = nearest(heartRate, point.timestamp);
    point.powerW = nearest(power, point.timestamp);
    point.cadenceRpm = nearest(cadence, point.timestamp);
    point.speedMps ??= nearest(speed, point.timestamp);
  });

  const durationS = finite(raw.duration) ?? (Date.parse(endAt) - Date.parse(startAt)) / 1000;
  const distanceM = convertDistance(raw.distance);
  const averageSpeedMps = convertSpeed(raw.avgSpeed ?? raw.speed);
  const maximumSpeedMps = convertSpeed(raw.maxSpeed);
  const elevationGainM = convertDistance(raw.elevationUp);
  const averageHeartRateBpm = summaryQuantity(raw, "avgHeartRate", "heartRate", "avg");
  const maximumHeartRateBpm = summaryQuantity(raw, "maxHeartRate", "heartRate", "max");
  const averagePowerW = summaryQuantity(raw, "avgPower", "cyclingPowerSummary", "avg");
  const maximumPowerW = summaryQuantity(raw, "maxPower", "cyclingPowerSummary", "max");
  const averageCadenceRpm = summaryQuantity(raw, "avgCadence", "cyclingCadenceSummary", "avg");
  const maximumCadenceRpm = summaryQuantity(raw, "maxCadence", "cyclingCadenceSummary", "max");
  const metadata = object(raw.metadata);
  const sourceName =
    text(raw.sourceName) ?? text(raw.source) ?? text(metadata?.source) ?? "Health Auto Export";
  const isIndoor =
    raw.isIndoor === true ||
    text(raw.location)?.toLowerCase() === "indoor" ||
    metadata?.HKIndoorWorkout === true ||
    metadata?.HKIndoorWorkout === 1 ||
    metadata?.HKIndoorWorkout === "1";

  return {
    schemaVersion: DATA_SCHEMA_VERSION,
    sourceId: id,
    sourceName,
    title: "Salida en bicicleta",
    startAt,
    endAt,
    timezone: timezoneFromDate(raw.start),
    indoor: isIndoor,
    durationS: apple(durationS),
    movingTimeS: appleOrCalculated(finite(raw.movingTime), calculated.movingTimeS),
    distanceM: appleOrCalculated(distanceM, calculated.distanceM),
    energyKcal: apple(convertEnergy(raw.activeEnergyBurned ?? raw.activeEnergy ?? raw.totalEnergy)),
    elevationGainM: appleOrCalculated(elevationGainM, calculated.elevationGainM),
    averageSpeedMps: appleOrCalculated(averageSpeedMps, average(speed) ?? calculated.averageSpeedMps),
    maximumSpeedMps: appleOrCalculated(maximumSpeedMps, maximum(speed) ?? calculated.maximumSpeedMps),
    averageHeartRateBpm: appleOrCalculated(averageHeartRateBpm, average(heartRate)),
    maximumHeartRateBpm: appleOrCalculated(maximumHeartRateBpm, maximum(heartRate)),
    averagePowerW: appleOrCalculated(averagePowerW, average(power)),
    maximumPowerW: appleOrCalculated(maximumPowerW, maximum(power)),
    averageCadenceRpm: appleOrCalculated(averageCadenceRpm, average(cadence)),
    maximumCadenceRpm: appleOrCalculated(maximumCadenceRpm, maximum(cadence)),
    route,
    series: { heartRate, power, cadence, speed },
    warnings: route.length ? [] : ["Ruta GPS no disponible para esta actividad."],
  };
}

function workoutsFromPayload(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  const root = object(body);
  if (!root) return null;
  if (Array.isArray(root.workouts)) return root.workouts;
  const data = object(root.data);
  return data && Array.isArray(data.workouts) ? data.workouts : null;
}

function isCyclingWorkout(value: unknown) {
  const name = text(object(value)?.name)?.toLowerCase() ?? "";
  return /(cycling|ciclismo|cyclisme|radfahren|fietsen|bicicleta)/i.test(name);
}

function tokenDigest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function validHealthAutoExportAuthorization(authorization: string | undefined, token: string) {
  if (!token || !authorization?.startsWith("Bearer ")) return false;
  return timingSafeEqual(tokenDigest(authorization.slice(7)), tokenDigest(token));
}

function repairLegacyHealthAutoExportSpeeds() {
  const migrationId = "health-auto-export-speed-units-v1";
  if (db.prepare("SELECT 1 FROM data_migrations WHERE id = ?").get(migrationId)) return;

  const rows = db.prepare(
    `SELECT a.id, a.distance_m, a.moving_time_s, a.average_speed_mps,
            a.maximum_speed_mps, p.payload_gzip
       FROM activities a
       JOIN activity_payloads p ON p.activity_id = a.id
      WHERE a.source_name = 'Health Auto Export'
        AND a.has_route = 1
        AND a.distance_m IS NOT NULL
        AND a.moving_time_s IS NOT NULL
        AND a.moving_time_s > 0
        AND a.average_speed_mps IS NOT NULL`,
  ).all() as Array<{
    id: string;
    distance_m: number;
    moving_time_s: number;
    average_speed_mps: number;
    maximum_speed_mps: number | null;
    payload_gzip: Buffer;
  }>;

  db.transaction(() => {
    for (const row of rows) {
      const expectedMovingSpeed = row.distance_m / row.moving_time_s;
      // A second km/h→m/s conversion makes the stored value roughly 3.6×
      // the speed implied by GPS. The 2.5 guard leaves legitimate values alone.
      if (row.average_speed_mps / expectedMovingSpeed <= 2.5) continue;
      const averageSpeedMps = row.average_speed_mps / 3.6;
      const maximumSpeedMps = row.maximum_speed_mps === null ? null : row.maximum_speed_mps / 3.6;
      const payload = JSON.parse(
        gunzipSync(row.payload_gzip).toString("utf8"),
      ) as NormalizedCyclingActivityV1;
      payload.averageSpeedMps = { value: averageSpeedMps, origin: "apple" };
      payload.maximumSpeedMps = maximumSpeedMps === null
        ? { value: null, origin: "unavailable" }
        : { value: maximumSpeedMps, origin: "apple" };
      db.prepare(
        `UPDATE activities
            SET average_speed_mps = ?, maximum_speed_mps = ?, updated_at = ?
          WHERE id = ?`,
      ).run(averageSpeedMps, maximumSpeedMps, new Date().toISOString(), row.id);
      db.prepare("UPDATE activity_payloads SET payload_gzip = ? WHERE activity_id = ?").run(
        gzipSync(Buffer.from(JSON.stringify(payload))),
        row.id,
      );
    }
    db.prepare("INSERT INTO data_migrations(id, applied_at) VALUES (?, ?)").run(
      migrationId,
      new Date().toISOString(),
    );
  })();
}

async function requireHealthAutoExportToken(request: FastifyRequest, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  if (!config.healthAutoExportToken) {
    return reply.code(503).send({ error: "auto_export_not_configured" });
  }
  if (!validHealthAutoExportAuthorization(request.headers.authorization, config.healthAutoExportToken)) {
    return reply.code(401).send({ error: "invalid_auto_export_token" });
  }
}

export async function registerHealthAutoExportRoutes(app: FastifyInstance) {
  repairLegacyHealthAutoExportSpeeds();
  app.post<{ Body: unknown }>(
    "/api/auto-export/workouts",
    { preHandler: requireHealthAutoExportToken },
    async (request, reply) => {
      const workouts = workoutsFromPayload(request.body);
      if (!workouts) return reply.code(400).send({ error: "invalid_auto_export_payload" });
      if (workouts.length > 500) return reply.code(413).send({ error: "too_many_workouts" });

      const cycling = workouts.filter(isCyclingWorkout);
      let activities: NormalizedCyclingActivityV1[];
      try {
        activities = cycling.map(normalizeHealthAutoExportWorkout);
      } catch (error) {
        request.log.warn({ err: error }, "Rejected Health Auto Export payload");
        return reply.code(400).send({ error: "invalid_auto_export_workout" });
      }

      const importId = randomUUID();
      let created = 0;
      let updated = 0;
      try {
        db.transaction(() => {
          const now = new Date().toISOString();
          db.prepare(
            `INSERT INTO import_runs(id, status, expected_count, received_count, started_at, completed_at, warnings)
             VALUES (?, 'complete', ?, ?, ?, ?, ?)`,
          ).run(
            importId,
            activities.length,
            activities.length,
            now,
            now,
            JSON.stringify([
              `Health Auto Export: ${request.headers["automation-name"] ?? "automation"}`,
              `Session: ${request.headers["session-id"] ?? "not-provided"}`,
            ]),
          );
          activities.forEach((activity) => {
            const result = upsertActivity(importId, activity, { updateImportMarker: false });
            if (result === "created") created += 1;
            else updated += 1;
          });
        })();
      } catch (error) {
        request.log.warn({ err: error }, "Failed to store Health Auto Export payload");
        return reply.code(400).send({ error: "invalid_auto_export_payload" });
      }

      return {
        accepted: activities.length,
        created,
        updated,
        ignored: workouts.length - cycling.length,
      };
    },
  );
}
