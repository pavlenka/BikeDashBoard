import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedCyclingActivityV1 } from "../shared/contracts.js";
import { DATA_SCHEMA_VERSION } from "../shared/contracts.js";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  transaction: vi.fn((callback: () => void) => callback),
}));

vi.mock("./db.js", () => ({ db: mocks }));
vi.mock("./auth.js", () => ({ requireSession: vi.fn() }));
vi.mock("./analytics.js", () => ({ dashboardSummary: vi.fn() }));

import { excludeActivity, upsertActivity } from "./activities.js";

function activity(): NormalizedCyclingActivityV1 {
  const unavailable = { value: null, origin: "unavailable" as const };
  return {
    schemaVersion: DATA_SCHEMA_VERSION,
    sourceId: "apple-ride-1",
    sourceName: "Apple Health",
    title: "Salida en bicicleta",
    startAt: "2026-08-20T05:00:00Z",
    endAt: "2026-08-20T06:00:00Z",
    timezone: "Europe/Madrid",
    indoor: false,
    durationS: unavailable,
    movingTimeS: unavailable,
    distanceM: unavailable,
    energyKcal: unavailable,
    elevationGainM: unavailable,
    averageSpeedMps: unavailable,
    maximumSpeedMps: unavailable,
    averageHeartRateBpm: unavailable,
    maximumHeartRateBpm: unavailable,
    averagePowerW: unavailable,
    maximumPowerW: unavailable,
    averageCadenceRpm: unavailable,
    maximumCadenceRpm: unavailable,
    route: [],
    series: { heartRate: [], power: [], cadence: [], speed: [] },
    warnings: [],
  };
}

describe("exclusión permanente de salidas", () => {
  beforeEach(() => {
    mocks.prepare.mockReset();
    mocks.transaction.mockClear();
  });

  it("ignora una salida excluida cuando vuelve a sincronizarse", () => {
    mocks.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ present: 1 }) });

    expect(upsertActivity("import-1", activity())).toBe("ignored");
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.prepare.mock.calls[0][0]).toContain("excluded_activities");
  });

  it("guarda la exclusión antes de eliminar la actividad", () => {
    const tombstoneRun = vi.fn();
    const deleteRun = vi.fn();
    mocks.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT source_id")) return { get: vi.fn().mockReturnValue({ sourceId: "apple-ride-1" }) };
      if (sql.includes("INSERT INTO excluded_activities")) return { run: tombstoneRun };
      if (sql.includes("DELETE FROM activities")) return { run: deleteRun };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    expect(excludeActivity("activity-1")).toBe(true);
    expect(tombstoneRun).toHaveBeenCalledWith("apple-ride-1", expect.any(String));
    expect(deleteRun).toHaveBeenCalledWith("activity-1");
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });
});
