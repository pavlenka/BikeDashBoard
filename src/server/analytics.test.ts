import { describe, expect, it } from "vitest";

import type { AnalyticsPreferences, RoutePoint } from "../shared/contracts.js";
import {
  buildSeries,
  calculateZoneSeconds,
  heartRateZones,
  localDateParts,
  periodStart,
  routeCells,
  spanishPeriodLabel,
  type ActivityRow,
} from "./analytics.js";

function activity(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id: "ride",
    title: "Salida",
    startAt: "2026-01-01T10:00:00Z",
    endAt: "2026-01-01T11:00:00Z",
    timezone: "Europe/Madrid",
    indoor: 0,
    durationS: 3600,
    movingTimeS: 3600,
    distanceM: 10_000,
    energyKcal: 400,
    elevationGainM: 200,
    averageSpeedMps: 10 / 3.6,
    maximumSpeedMps: 10,
    averageHeartRateBpm: 140,
    maximumHeartRateBpm: 170,
    averagePowerW: null,
    averageCadenceRpm: null,
    hasRoute: 1,
    ...overrides,
  };
}

describe("analytics calendar", () => {
  it("uses ISO Monday when a week crosses a year", () => {
    expect(periodStart("2026-01-01T10:00:00Z", "week", "Europe/Madrid")).toBe("2025-12-29");
  });

  it("groups using Madrid local time across daylight saving", () => {
    expect(localDateParts("2026-03-29T22:30:00Z", "Europe/Madrid")).toMatchObject({ year: 2026, month: 3, day: 30, hour: 0 });
  });

  it("presents stored periods as Spanish calendar labels", () => {
    expect(spanishPeriodLabel("2026-07")).toBe("julio de 2026");
    expect(spanishPeriodLabel("2026")).toBe("2026");
  });
});

describe("analytics aggregation", () => {
  it("weights speed from total distance and moving time", () => {
    const series = buildSeries([
      activity({ id: "a", distanceM: 10_000, movingTimeS: 1800, maximumSpeedMps: 12 }),
      activity({ id: "b", distanceM: 20_000, movingTimeS: 3600, maximumSpeedMps: 15 }),
    ], "month", "Europe/Madrid");
    expect(series[0].averageSpeedMps).toBeCloseTo(30_000 / 5400);
    expect(series[0].maximumSpeedMps).toBe(15);
    expect(series[0].distanceM).toBe(30_000);
  });
});

describe("heart-rate reserve", () => {
  const preferences: AnalyticsPreferences = { timezone: "Europe/Madrid", maximumHeartRateBpm: 180, restingHeartRateBpm: 60 };

  it("builds five Karvonen zones and weights sample intervals", () => {
    const template = heartRateZones(preferences);
    expect(template.map((zone) => zone.fromBpm)).toEqual([120, 132, 144, 156, 168]);
    const zones = calculateZoneSeconds([
      { timestamp: "2026-01-01T10:00:00Z", value: 125 },
      { timestamp: "2026-01-01T10:01:00Z", value: 136 },
      { timestamp: "2026-01-01T10:02:00Z", value: 150 },
      { timestamp: "2026-01-01T10:03:00Z", value: 160 },
      { timestamp: "2026-01-01T10:04:00Z", value: 172 },
    ], template);
    expect(zones.map((zone) => zone.seconds)).toEqual([60, 60, 60, 60, 60]);
    expect(zones.reduce((sum, zone) => sum + zone.percentage, 0)).toBeCloseTo(1);
  });
});

describe("route exploration", () => {
  it("resamples sparse GPS segments into 250 metre cells", () => {
    const route: RoutePoint[] = [
      { latitude: 41.38, longitude: 2.15, elevationM: 20, timestamp: null },
      { latitude: 41.38, longitude: 2.165, elevationM: 20, timestamp: null },
    ];
    expect(routeCells(route).size).toBeGreaterThanOrEqual(5);
  });
});
