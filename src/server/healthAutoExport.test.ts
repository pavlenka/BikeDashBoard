import { describe, expect, it, vi } from "vitest";

vi.mock("./activities.js", () => ({ upsertActivity: vi.fn() }));
vi.mock("./db.js", () => ({ db: {} }));

import {
  normalizeHealthAutoExportWorkout,
  parseHealthAutoExportDate,
  validHealthAutoExportAuthorization,
} from "./healthAutoExport.js";

describe("Health Auto Export workout v2", () => {
  it("normalizes dates, units, route and workout series", () => {
    const activity = normalizeHealthAutoExportWorkout({
      id: "ride-auto-1",
      name: "Cycling",
      start: "2026-08-23 08:00:00 +0200",
      end: "2026-08-23 09:00:00 +0200",
      duration: 3600,
      location: "Outdoor",
      distance: { qty: 25, units: "km" },
      activeEnergyBurned: { qty: 520, units: "kcal" },
      elevationUp: { qty: 410, units: "m" },
      avgSpeed: { qty: 25, units: "kmph" },
      maxSpeed: { qty: 54, units: "kmph" },
      heartRate: {
        avg: { qty: 148, units: "bpm" },
        max: { qty: 181, units: "bpm" },
      },
      heartRateData: [
        { date: "2026-08-23 08:00:00 +0200", Min: 130, Avg: 145, Max: 150, units: "bpm" },
      ],
      cyclingPower: [
        { date: "2026-08-23 08:00:00 +0200", qty: 210, units: "W" },
      ],
      cyclingCadence: [
        { date: "2026-08-23 08:00:00 +0200", qty: 87, units: "rpm" },
      ],
      cyclingSpeed: [
        { date: "2026-08-23 08:00:00 +0200", qty: 27, units: "kmph" },
      ],
      route: [
        {
          latitude: 40.4,
          longitude: -3.7,
          altitude: 650,
          timestamp: "2026-08-23 08:00:00 +0200",
          speed: 7.5,
        },
        {
          latitude: 40.4005,
          longitude: -3.6995,
          altitude: 655,
          timestamp: "2026-08-23 08:01:00 +0200",
          speed: 8,
        },
      ],
    });

    expect(activity.sourceId).toBe("ride-auto-1");
    expect(activity.startAt).toBe("2026-08-23T06:00:00.000Z");
    expect(activity.timezone).toBe("UTC+02:00");
    expect(activity.distanceM).toEqual({ value: 25_000, origin: "apple" });
    expect(activity.averageSpeedMps.value).toBeCloseTo(25 / 3.6);
    expect(activity.maximumSpeedMps.value).toBeCloseTo(15);
    expect(activity.averageHeartRateBpm.value).toBe(148);
    expect(activity.averagePowerW.value).toBe(210);
    expect(activity.averageCadenceRpm.value).toBe(87);
    expect(activity.series.speed[0].value).toBeCloseTo(7.5);
    expect(activity.route[0]).toMatchObject({
      elevationM: 650,
      speedMps: 7.5,
      heartRateBpm: 145,
      powerW: 210,
      cadenceRpm: 87,
    });
  });

  it("recognizes HealthKit metric speed unit variants", () => {
    const base = {
      id: "unit-variant",
      name: "Cycling",
      start: "2026-08-23 08:00:00 +0200",
      end: "2026-08-23 09:00:00 +0200",
      duration: 3600,
    };
    for (const units of ["kmph", "km/h", "km / hr", "km·h⁻¹"]) {
      const activity = normalizeHealthAutoExportWorkout({
        ...base,
        avgSpeed: { qty: 36, units },
      });
      expect(activity.averageSpeedMps.value, units).toBeCloseTo(10);
    }
  });

  it("accepts the documented Apple date and rejects invalid ranges", () => {
    expect(parseHealthAutoExportDate("2024-02-06 07:00:00 -0800")).toBe(
      "2024-02-06T15:00:00.000Z",
    );
    expect(() =>
      normalizeHealthAutoExportWorkout({
        id: "bad",
        name: "Cycling",
        start: "2026-08-23 09:00:00 +0200",
        end: "2026-08-23 08:00:00 +0200",
        duration: 1,
      }),
    ).toThrow("invalid_workout_range");
  });

  it("uses an exact independent bearer token", () => {
    const token = "a".repeat(64);
    expect(validHealthAutoExportAuthorization(`Bearer ${token}`, token)).toBe(true);
    expect(validHealthAutoExportAuthorization(`Bearer ${"b".repeat(64)}`, token)).toBe(false);
    expect(validHealthAutoExportAuthorization(undefined, token)).toBe(false);
  });
});
