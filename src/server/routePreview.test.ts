import { describe, expect, it } from "vitest";

import type { RoutePoint } from "../shared/contracts.js";
import { createRoutePreview } from "./routePreview.js";

function point(latitude: number, longitude: number): RoutePoint {
  return { latitude, longitude, elevationM: null, timestamp: null };
}

describe("route preview geometry", () => {
  it("removes redundant straight-line points", () => {
    const route = Array.from({ length: 500 }, (_value, index) => point(41.4, 2.1 + index * 0.00001));
    const preview = createRoutePreview(route);
    expect(preview).toEqual([[2.1, 41.4], [2.10499, 41.4]]);
  });

  it("keeps a sharp turn instead of cutting the corner", () => {
    const route = [
      ...Array.from({ length: 200 }, (_value, index) => point(41.4, 2.1 + index * 0.00001)),
      ...Array.from({ length: 200 }, (_value, index) => point(41.4 + index * 0.00001, 2.10199)),
    ];
    const preview = createRoutePreview(route);
    expect(preview.some(([longitude, latitude]) =>
      Math.abs(longitude - 2.10199) < 0.0000001 && Math.abs(latitude - 41.4) < 0.0000001,
    )).toBe(true);
    expect(preview.length).toBeLessThan(10);
  });

  it("caps exceptionally noisy routes while retaining their endpoints", () => {
    const route = Array.from({ length: 5_000 }, (_value, index) =>
      point(41.4 + (index % 2 ? 0.0001 : 0), 2.1 + index * 0.00001),
    );
    const preview = createRoutePreview(route);
    expect(preview.length).toBeLessThanOrEqual(1_000);
    expect(preview[0]).toEqual([route[0].longitude, route[0].latitude]);
    expect(preview.at(-1)).toEqual([route.at(-1)!.longitude, route.at(-1)!.latitude]);
  });
});
