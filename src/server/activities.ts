import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import type { FastifyInstance } from "fastify";

import type {
  ActivitySummary,
  DashboardSummary,
  NormalizedCyclingActivityV1,
} from "../shared/contracts.js";
import { DATA_SCHEMA_VERSION } from "../shared/contracts.js";
import { db } from "./db.js";
import { requireSession } from "./auth.js";
import { dashboardSummary } from "./analytics.js";
import type { TimeGranularity } from "../shared/contracts.js";
import { createRoutePreview } from "./routePreview.js";

function value(metric: { value: number | null }) {
  return Number.isFinite(metric.value) ? metric.value : null;
}

function assertActivity(activity: NormalizedCyclingActivityV1) {
  if (activity.schemaVersion !== DATA_SCHEMA_VERSION) throw new Error("unsupported_schema");
  if (!activity.sourceId || !Date.parse(activity.startAt) || !Date.parse(activity.endAt)) {
    throw new Error("invalid_activity");
  }
  if (activity.route.length > 250_000) throw new Error("route_too_large");
}

function rebuildRoutePreviews() {
  const migrationId = "geometry-aware-route-previews-v1";
  if (db.prepare("SELECT 1 FROM data_migrations WHERE id = ?").get(migrationId)) return;
  const rows = db.prepare(
    `SELECT a.id, p.payload_gzip
       FROM activities a
       JOIN activity_payloads p ON p.activity_id = a.id
      WHERE a.has_route = 1`,
  ).all() as Array<{ id: string; payload_gzip: Buffer }>;

  db.transaction(() => {
    const update = db.prepare("UPDATE activities SET route_preview = ? WHERE id = ?");
    for (const row of rows) {
      const activity = JSON.parse(gunzipSync(row.payload_gzip).toString("utf8")) as NormalizedCyclingActivityV1;
      update.run(JSON.stringify(createRoutePreview(activity.route)), row.id);
    }
    db.prepare("INSERT INTO data_migrations(id, applied_at) VALUES (?, ?)").run(
      migrationId,
      new Date().toISOString(),
    );
  })();
}

export function upsertActivity(
  importId: string,
  activity: NormalizedCyclingActivityV1,
  { updateImportMarker = true }: { updateImportMarker?: boolean } = {},
) {
  assertActivity(activity);
  const existing = db
    .prepare("SELECT id, created_at FROM activities WHERE source_id = ?")
    .get(activity.sourceId) as { id: string; created_at: string } | undefined;
  const id = existing?.id ?? randomUUID();
  const now = new Date().toISOString();
  const preview = createRoutePreview(activity.route);

  const seenImportUpdate = updateImportMarker
    ? "seen_import_id=excluded.seen_import_id, updated_at=excluded.updated_at"
    : "updated_at=excluded.updated_at";

  db.prepare(
    `INSERT INTO activities (
      id, source_id, source_name, title, start_at, end_at, timezone, indoor,
      duration_s, moving_time_s, distance_m, energy_kcal, elevation_gain_m,
      average_speed_mps, maximum_speed_mps, average_heart_rate_bpm,
      maximum_heart_rate_bpm, average_power_w, maximum_power_w,
      average_cadence_rpm, maximum_cadence_rpm, has_route, route_preview,
      seen_import_id, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    ) ON CONFLICT(source_id) DO UPDATE SET
      source_name=excluded.source_name, title=excluded.title, start_at=excluded.start_at,
      end_at=excluded.end_at, timezone=excluded.timezone, indoor=excluded.indoor,
      duration_s=excluded.duration_s, moving_time_s=excluded.moving_time_s,
      distance_m=excluded.distance_m, energy_kcal=excluded.energy_kcal,
      elevation_gain_m=excluded.elevation_gain_m,
      average_speed_mps=excluded.average_speed_mps,
      maximum_speed_mps=excluded.maximum_speed_mps,
      average_heart_rate_bpm=excluded.average_heart_rate_bpm,
      maximum_heart_rate_bpm=excluded.maximum_heart_rate_bpm,
      average_power_w=excluded.average_power_w, maximum_power_w=excluded.maximum_power_w,
      average_cadence_rpm=excluded.average_cadence_rpm,
      maximum_cadence_rpm=excluded.maximum_cadence_rpm,
      has_route=excluded.has_route, route_preview=excluded.route_preview,
      ${seenImportUpdate}`,
  ).run(
    id,
    activity.sourceId,
    activity.sourceName,
    activity.title,
    activity.startAt,
    activity.endAt,
    activity.timezone,
    activity.indoor ? 1 : 0,
    value(activity.durationS),
    value(activity.movingTimeS),
    value(activity.distanceM),
    value(activity.energyKcal),
    value(activity.elevationGainM),
    value(activity.averageSpeedMps),
    value(activity.maximumSpeedMps),
    value(activity.averageHeartRateBpm),
    value(activity.maximumHeartRateBpm),
    value(activity.averagePowerW),
    value(activity.maximumPowerW),
    value(activity.averageCadenceRpm),
    value(activity.maximumCadenceRpm),
    activity.route.length ? 1 : 0,
    JSON.stringify(preview),
    importId,
    existing?.created_at ?? now,
    now,
  );

  db.prepare(
    `INSERT INTO activity_payloads(activity_id, schema_version, payload_gzip)
     VALUES (?, ?, ?)
     ON CONFLICT(activity_id) DO UPDATE SET
       schema_version=excluded.schema_version, payload_gzip=excluded.payload_gzip`,
  ).run(id, DATA_SCHEMA_VERSION, gzipSync(Buffer.from(JSON.stringify(activity))));

  return existing ? "updated" : "created";
}

export async function registerActivityRoutes(app: FastifyInstance) {
  rebuildRoutePreviews();

  app.post<{ Body: { expectedCount?: number; warnings?: string[] } }>(
    "/api/imports",
    { preHandler: requireSession },
    async (request) => {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO import_runs(id, status, expected_count, started_at, warnings)
         VALUES (?, 'open', ?, ?, ?)`,
      ).run(
        id,
        request.body.expectedCount ?? null,
        new Date().toISOString(),
        JSON.stringify(request.body.warnings ?? []),
      );
      return { id };
    },
  );

  app.post<{ Params: { id: string }; Body: { activities: NormalizedCyclingActivityV1[] } }>(
    "/api/imports/:id/activities",
    { preHandler: requireSession },
    async (request, reply) => {
      const run = db
        .prepare("SELECT status FROM import_runs WHERE id = ?")
        .get(request.params.id) as { status: string } | undefined;
      if (!run || run.status !== "open") {
        return reply.code(409).send({ error: "import_not_open" });
      }
      if (!Array.isArray(request.body.activities) || request.body.activities.length > 20) {
        return reply.code(400).send({ error: "invalid_batch" });
      }
      try {
        db.transaction(() => {
          request.body.activities.forEach((activity) => upsertActivity(request.params.id, activity));
          db.prepare(
            "UPDATE import_runs SET received_count = received_count + ? WHERE id = ?",
          ).run(request.body.activities.length, request.params.id);
        })();
      } catch (error) {
        request.log.warn({ err: error }, "Rejected activity batch");
        return reply.code(400).send({ error: "invalid_activity_batch" });
      }
      return { accepted: request.body.activities.length };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/imports/:id/finalize",
    { preHandler: requireSession },
    async (request, reply) => {
      const run = db
        .prepare("SELECT expected_count, received_count, status FROM import_runs WHERE id = ?")
        .get(request.params.id) as
        | { expected_count: number | null; received_count: number; status: string }
        | undefined;
      if (!run || run.status !== "open") {
        return reply.code(409).send({ error: "import_not_open" });
      }
      if (run.expected_count !== null && run.expected_count !== run.received_count) {
        return reply.code(409).send({
          error: "import_incomplete",
          expected: run.expected_count,
          received: run.received_count,
        });
      }
      db.transaction(() => {
        db.prepare("DELETE FROM activities WHERE seen_import_id <> ?").run(request.params.id);
        db.prepare(
          "UPDATE import_runs SET status='complete', completed_at=? WHERE id=?",
        ).run(new Date().toISOString(), request.params.id);
      })();
      return { complete: true, activities: run.received_count };
    },
  );

  app.get<{ Querystring: { from?: string; to?: string; groupBy?: TimeGranularity } }>(
    "/api/dashboard/summary",
    { preHandler: requireSession },
    async (request): Promise<DashboardSummary> => dashboardSummary(request.query),
  );

  app.get<{ Querystring: { from?: string; to?: string; limit?: number } }>(
    "/api/activities",
    { preHandler: requireSession },
    async (request): Promise<ActivitySummary[]> => {
      const where: string[] = [];
      const params: Array<string | number> = [];
      if (request.query.from) {
        where.push("start_at >= ?");
        params.push(request.query.from);
      }
      if (request.query.to) {
        where.push("start_at <= ?");
        params.push(request.query.to);
      }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      params.push(Math.min(Math.max(Number(request.query.limit ?? 500), 1), 2000));
      const rows = db
        .prepare(
          `SELECT id, source_id sourceId, title, start_at startAt, end_at endAt,
            indoor, duration_s durationS, moving_time_s movingTimeS,
            distance_m distanceM, energy_kcal energyKcal,
            elevation_gain_m elevationGainM, average_speed_mps averageSpeedMps,
            maximum_speed_mps maximumSpeedMps,
            average_heart_rate_bpm averageHeartRateBpm,
            average_power_w averagePowerW, average_cadence_rpm averageCadenceRpm,
            has_route hasRoute, route_preview routePreview
           FROM activities ${clause} ORDER BY start_at DESC LIMIT ?`,
        )
        .all(...params) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        ...(row as unknown as ActivitySummary),
        indoor: Boolean(row.indoor),
        hasRoute: Boolean(row.hasRoute),
        routePreview: JSON.parse(String(row.routePreview)),
      }));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/activities/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const row = db
        .prepare("SELECT payload_gzip FROM activity_payloads WHERE activity_id = ?")
        .get(request.params.id) as { payload_gzip: Buffer } | undefined;
      if (!row) return reply.code(404).send({ error: "activity_not_found" });
      return JSON.parse(gunzipSync(row.payload_gzip).toString("utf8"));
    },
  );
}
