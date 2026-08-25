import type { RouteSpeedPoint } from "../../shared/contracts";

const EARTH_RADIUS_M = 6_378_137;
const MAX_CYCLING_SPEED_MPS = 120 / 3.6;

export interface SpeedSegment {
  coordinates: [[number, number], [number, number]];
  speedMps: number | null;
}

function haversineDistance(a: RouteSpeedPoint, b: RouteSpeedPoint) {
  const toRadians = Math.PI / 180;
  const latitudeA = a.latitude * toRadians;
  const latitudeB = b.latitude * toRadians;
  const deltaLatitude = (b.latitude - a.latitude) * toRadians;
  const deltaLongitude = (b.longitude - a.longitude) * toRadians;
  const value =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function validSpeed(value: number | null | undefined) {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0 && value <= MAX_CYCLING_SPEED_MPS
    ? value
    : null;
}

function segmentSpeed(previous: RouteSpeedPoint, point: RouteSpeedPoint) {
  const recorded = validSpeed(point.speedMps);
  if (recorded !== null) return recorded;
  if (!previous.timestamp || !point.timestamp) return null;
  const elapsedS = (Date.parse(point.timestamp) - Date.parse(previous.timestamp)) / 1_000;
  if (!Number.isFinite(elapsedS) || elapsedS <= 0 || elapsedS > 120) return null;
  return validSpeed(haversineDistance(previous, point) / elapsedS);
}

function percentile(sorted: number[], ratio: number) {
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const remainder = index - lower;
  return sorted[lower] + ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]) * remainder;
}

export function buildSpeedSegments(points: RouteSpeedPoint[]) {
  const segments: SpeedSegment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    segments.push({
      coordinates: [[previous.longitude, previous.latitude], [point.longitude, point.latitude]],
      speedMps: segmentSpeed(previous, point),
    });
  }
  const speeds = segments
    .map((segment) => segment.speedMps)
    .filter((speed): speed is number => speed !== null)
    .sort((a, b) => a - b);
  if (!speeds.length) return { segments, range: null };
  const low = percentile(speeds, 0.1);
  const high = percentile(speeds, 0.9);
  return {
    segments,
    range: high - low < 0.5
      ? { low: Math.max(0, low - 0.5), high: high + 0.5 }
      : { low, high },
  };
}

export function buildSpeedRoutes(routes: RouteSpeedPoint[][]) {
  const segments = routes.flatMap((route) => buildSpeedSegments(route).segments);
  const speeds = segments
    .map((segment) => segment.speedMps)
    .filter((speed): speed is number => speed !== null)
    .sort((a, b) => a - b);
  if (!speeds.length) return { segments, range: null };
  const low = percentile(speeds, 0.1);
  const high = percentile(speeds, 0.9);
  return {
    segments,
    range: high - low < 0.5
      ? { low: Math.max(0, low - 0.5), high: high + 0.5 }
      : { low, high },
  };
}
