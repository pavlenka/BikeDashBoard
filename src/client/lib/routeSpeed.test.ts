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

  it("groups long routes into a bounded number of continuous colored sections", () => {
    const points = Array.from({ length: 8_001 }, (_value, index) =>
      point(index * 0.000001, new Date(Date.UTC(2026, 0, 1, 10, 0, index)).toISOString(), 8),
    );
    const result = buildSpeedSegments(points);
    expect(result.segments).toHaveLength(800);
    expect(result.segments[0].coordinates[0]).toEqual([0, points[0].latitude]);
    expect(result.segments.at(-1)!.coordinates.at(-1)).toEqual([0, points.at(-1)!.latitude]);
    for (let index = 1; index < result.segments.length; index += 1) {
      expect(result.segments[index].coordinates[0]).toEqual(result.segments[index - 1].coordinates.at(-1));
    }
  });

  it("estimates relative speed from point spacing when local speed and time are unavailable", () => {
    const points = [
      point(0, "2026-01-01T10:00:00Z", -1),
      point(0.0001, "2026-01-01T10:00:00Z", -1),
      point(0.0003, "2026-01-01T10:00:00Z", -1),
    ];
    const result = buildSpeedSegments(points, 6);
    expect(result.segments[0].speedMps).toBeCloseTo(4);
    expect(result.segments[1].speedMps).toBeCloseTo(8);
    expect(result.range).not.toBeNull();
  });
});
