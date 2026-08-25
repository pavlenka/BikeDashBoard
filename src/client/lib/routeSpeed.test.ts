import { describe, expect, it } from "vitest";
import type { RoutePoint } from "../../shared/contracts";
import { buildSpeedSegments } from "./routeSpeed";

function point(latitude: number, timestamp: string, speedMps: number | null = null): RoutePoint {
  return { latitude, longitude: 0, elevationM: null, timestamp, speedMps };
}

describe("buildSpeedSegments", () => {
  it("uses recorded speeds and derives missing values from GPS time", () => {
    const result = buildSpeedSegments([
      point(0, "2026-01-01T10:00:00Z"),
      point(0.0001, "2026-01-01T10:00:02Z", 8),
      point(0.0002, "2026-01-01T10:00:04Z"),
    ]);
    expect(result.segments[0].speedMps).toBe(8);
    expect(result.segments[1].speedMps).toBeCloseTo(5.57, 1);
    expect(result.range).not.toBeNull();
  });

  it("ignores implausible speed spikes", () => {
    const result = buildSpeedSegments([
      point(0, "2026-01-01T10:00:00Z"),
      point(0.0001, "2026-01-01T10:00:02Z", 90),
    ]);
    expect(result.segments[0].speedMps).toBeCloseTo(5.57, 1);
  });
});
