import type { RoutePoint } from "../shared/contracts.js";

const EARTH_RADIUS_M = 6_378_137;
const INITIAL_TOLERANCE_M = 2;
const MAX_PREVIEW_POINTS = 1_000;

interface ProjectedPoint {
  x: number;
  y: number;
}

function project(point: RoutePoint): ProjectedPoint {
  const latitude = Math.max(-85, Math.min(85, point.latitude));
  return {
    x: EARTH_RADIUS_M * point.longitude * Math.PI / 180,
    y: EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)),
  };
}

function segmentDistanceSquared(point: ProjectedPoint, start: ProjectedPoint, end: ProjectedPoint) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  if (deltaX === 0 && deltaY === 0) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  const ratio = Math.max(0, Math.min(1,
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / (deltaX ** 2 + deltaY ** 2),
  ));
  const nearestX = start.x + ratio * deltaX;
  const nearestY = start.y + ratio * deltaY;
  return (point.x - nearestX) ** 2 + (point.y - nearestY) ** 2;
}

function simplifyIndices(points: ProjectedPoint[], toleranceM: number) {
  if (points.length <= 2) return points.map((_point, index) => index);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  const toleranceSquared = toleranceM ** 2;

  while (stack.length) {
    const [startIndex, endIndex] = stack.pop()!;
    let furthestIndex = -1;
    let furthestDistance = toleranceSquared;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = segmentDistanceSquared(points[index], points[startIndex], points[endIndex]);
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthestIndex = index;
      }
    }
    if (furthestIndex === -1) continue;
    keep[furthestIndex] = 1;
    stack.push([startIndex, furthestIndex], [furthestIndex, endIndex]);
  }

  return Array.from(keep, (value, index) => value ? index : -1).filter((index) => index >= 0);
}

export function createRoutePreview(route: RoutePoint[]) {
  if (route.length <= 2) return route.map((point) => [point.longitude, point.latitude] as [number, number]);
  const projected = route.map(project);
  let toleranceM = INITIAL_TOLERANCE_M;
  let indices = simplifyIndices(projected, toleranceM);
  while (indices.length > MAX_PREVIEW_POINTS) {
    toleranceM *= 1.5;
    indices = simplifyIndices(projected, toleranceM);
  }
  return indices.map((index) => [route[index].longitude, route[index].latitude] as [number, number]);
}
