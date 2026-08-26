import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true, mode: 0o700 });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id TEXT PRIMARY KEY,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '[]',
    device_type TEXT NOT NULL,
    backed_up INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS auth_challenges (
    id TEXT PRIMARY KEY,
    flow TEXT NOT NULL CHECK(flow IN ('registration', 'authentication')),
    challenge TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    recovery_session INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recovery_codes (
    salt TEXT NOT NULL,
    code_hash TEXT PRIMARY KEY,
    used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS import_runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('open', 'complete', 'failed')),
    expected_count INTEGER,
    received_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    warnings TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS data_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL UNIQUE,
    source_name TEXT NOT NULL,
    title TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    indoor INTEGER NOT NULL DEFAULT 0,
    duration_s REAL,
    moving_time_s REAL,
    distance_m REAL,
    energy_kcal REAL,
    elevation_gain_m REAL,
    average_speed_mps REAL,
    maximum_speed_mps REAL,
    average_heart_rate_bpm REAL,
    maximum_heart_rate_bpm REAL,
    average_power_w REAL,
    maximum_power_w REAL,
    average_cadence_rpm REAL,
    maximum_cadence_rpm REAL,
    has_route INTEGER NOT NULL DEFAULT 0,
    route_preview TEXT NOT NULL DEFAULT '[]',
    seen_import_id TEXT NOT NULL REFERENCES import_runs(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS activities_start_at_idx ON activities(start_at DESC);
  CREATE INDEX IF NOT EXISTS activities_seen_import_idx ON activities(seen_import_id);

  CREATE TABLE IF NOT EXISTS excluded_activities (
    source_id TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_payloads (
    activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
    schema_version TEXT NOT NULL,
    payload_gzip BLOB NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analytics_preferences (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
    maximum_heart_rate_bpm REAL,
    resting_heart_rate_bpm REAL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS period_goals (
    period TEXT PRIMARY KEY,
    distance_m REAL,
    duration_s REAL,
    elevation_gain_m REAL,
    rides INTEGER,
    updated_at TEXT NOT NULL
  );
`);

const activityColumns = db.prepare("PRAGMA table_info(activities)").all() as Array<{ name: string }>;
if (!activityColumns.some((column) => column.name === "route_speed_preview")) {
  db.exec("ALTER TABLE activities ADD COLUMN route_speed_preview TEXT NOT NULL DEFAULT '[]'");
}

db.prepare(
  `INSERT INTO analytics_preferences(id, timezone, updated_at)
   VALUES (1, 'Europe/Madrid', ?)
   ON CONFLICT(id) DO NOTHING`,
).run(new Date().toISOString());

export function cleanupExpiredAuthState() {
  const now = new Date().toISOString();
  db.prepare("DELETE FROM auth_challenges WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
}
