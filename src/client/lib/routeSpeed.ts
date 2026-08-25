import type { RouteSpeedPoint } from "../../shared/contracts";

const EARTH_RADIUS_M = 6_378_137;
const MAX_CYCLING_SPEED_MPS = 120 / 3.6;
const MAX_SPEED_SEGMENTS_PER_ROUTE = 800;

export interface SpeedSegment {
  coordinates: Array<[number, number]>;
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

export function buildSpeedSegments(points: RouteSpeedPoint[], fallbackAverageSpeedMps?: number | null) {
  const segments: SpeedSegment[] = [];
  const pointSpeeds = points.slice(1).map((point, index) => segmentSpeed(points[index], point));
  if (
    !pointSpeeds.some((speed) => speed !== null) &&
    fallbackAverageSpeedMps !== null &&
    fallbackAverageSpeedMps !== undefined &&
    Number.isFinite(fallbackAverageSpeedMps) &&
    fallbackAverageSpeedMps > 0
  ) {
    const distances = points.slice(1).map((point, index) => haversineDistance(points[index], point));
    const averageDistance = distances.reduce((total, distance) => total + distance, 0) / distances.length;
    if (averageDistance > 0) {
      distances.forEach((distance, index) => {
        pointSpeeds[index] = validSpeed(distance / averageDistance * fallbackAverageSpeedMps);
      });
    }
  }
  const chunkSize = Math.max(1, Math.ceil((points.length - 1) / MAX_SPEED_SEGMENTS_PER_ROUTE));
  for (let firstIndex = 1; firstIndex < points.length; firstIndex += chunkSize) {
    const lastIndex = Math.min(points.length - 1, firstIndex + chunkSize - 1);
    const chunkSpeeds: number[] = [];
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const speed = pointSpeeds[index - 1];
      if (speed !== null) chunkSpeeds.push(speed);
    }
    segments.push({
      coordinates: points
        .slice(firstIndex - 1, lastIndex + 1)
        .map((point) => [point.longitude, point.latitude] as [number, number]),
      speedMps: chunkSpeeds.length
        ? chunkSpeeds.reduce((total, speed) => total + speed, 0) / chunkSpeeds.length
        : null,
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

export function buildSpeedRoutes(routes: RouteSpeedPoint[][], fallbackAverageSpeeds: Array<number | null> = []) {
  const segments = routes.flatMap((route, index) => buildSpeedSegments(route, fallbackAverageSpeeds[index]).segments);
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
