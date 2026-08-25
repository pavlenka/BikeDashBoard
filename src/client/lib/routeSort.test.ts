import { describe, expect, it } from "vitest";
import type { ActivitySummary } from "../../shared/contracts";
import { sortRoutes } from "./routeSort";

function route(id: string, overrides: Partial<ActivitySummary> = {}): ActivitySummary {
  return { id, sourceId: id, title: id, startAt: "2026-01-01T08:00:00Z", endAt: "2026-01-01T09:00:00Z", indoor: false, durationS: 3600, movingTimeS: 3500, distanceM: 20_000, energyKcal: 500, elevationGainM: 200, averageSpeedMps: 6, maximumSpeedMps: 10, averageHeartRateBpm: 140, averagePowerW: 180, averageCadenceRpm: 85, hasRoute: true, routePreview: [], routeSpeedPreview: [], ...overrides };
}

describe("sortRoutes", () => {
  it("sorts numeric fields in both directions", () => {
    const routes = [route("medium"), route("long", { distanceM: 40_000 }), route("short", { distanceM: 10_000 })];
    expect(sortRoutes(routes, "distanceM", "asc").map(({ id }) => id)).toEqual(["short", "medium", "long"]);
    expect(sortRoutes(routes, "distanceM", "desc").map(({ id }) => id)).toEqual(["long", "medium", "short"]);
  });

  it("keeps missing values at the end", () => {
    const routes = [route("missing", { averagePowerW: null }), route("high", { averagePowerW: 250 }), route("low", { averagePowerW: 120 })];
    expect(sortRoutes(routes, "averagePowerW", "desc").map(({ id }) => id)).toEqual(["high", "low", "missing"]);
  });

  it("sorts titles using Spanish collation", () => {
    const routes = [route("z", { title: "Zaragoza" }), route("a", { title: "Ávila" })];
    expect(sortRoutes(routes, "title", "asc").map(({ id }) => id)).toEqual(["a", "z"]);
  });
});
