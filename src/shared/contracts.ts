export const DATA_SCHEMA_VERSION = "apple-health-cycling/v1" as const;

export type MetricOrigin = "apple" | "calculated" | "unavailable";

export interface MetricValue {
  value: number | null;
  origin: MetricOrigin;
}

export interface RoutePoint {
  latitude: number;
  longitude: number;
  elevationM: number | null;
  timestamp: string | null;
  heartRateBpm?: number | null;
  speedMps?: number | null;
  powerW?: number | null;
  cadenceRpm?: number | null;
}

export interface SensorSeriesPoint {
  timestamp: string;
  value: number;
}

export interface NormalizedCyclingActivityV1 {
  schemaVersion: typeof DATA_SCHEMA_VERSION;
  sourceId: string;
  sourceName: string;
  title: string;
  startAt: string;
  endAt: string;
  timezone: string;
  indoor: boolean;
  durationS: MetricValue;
  movingTimeS: MetricValue;
  distanceM: MetricValue;
  energyKcal: MetricValue;
  elevationGainM: MetricValue;
  averageSpeedMps: MetricValue;
  maximumSpeedMps: MetricValue;
  averageHeartRateBpm: MetricValue;
  maximumHeartRateBpm: MetricValue;
  averagePowerW: MetricValue;
  maximumPowerW: MetricValue;
  averageCadenceRpm: MetricValue;
  maximumCadenceRpm: MetricValue;
  route: RoutePoint[];
  series: {
    heartRate: SensorSeriesPoint[];
    power: SensorSeriesPoint[];
    cadence: SensorSeriesPoint[];
    speed: SensorSeriesPoint[];
  };
  warnings: string[];
}

export interface ImportPreview {
  totalCyclingActivities: number;
  activitiesWithRoutes: number;
  activitiesWithoutRoutes: number;
  dateFrom: string | null;
  dateTo: string | null;
  warnings: string[];
}

export interface ActivitySummary {
  id: string;
  sourceId: string;
  title: string;
  startAt: string;
  endAt: string;
  indoor: boolean;
  durationS: number | null;
  movingTimeS: number | null;
  distanceM: number | null;
  energyKcal: number | null;
  elevationGainM: number | null;
  averageSpeedMps: number | null;
  maximumSpeedMps: number | null;
  averageHeartRateBpm: number | null;
  averagePowerW: number | null;
  averageCadenceRpm: number | null;
  hasRoute: boolean;
  routePreview: Array<[number, number]>;
}

export type TimeGranularity = "day" | "week" | "month" | "year";
export type ActivityTypeFilter = "all" | "outdoor" | "indoor";

export interface PeriodSeriesPoint {
  periodStart: string;
  rides: number;
  distanceM: number;
  durationS: number;
  movingTimeS: number;
  elevationGainM: number;
  energyKcal: number;
  averageSpeedMps: number | null;
  maximumSpeedMps: number | null;
  averageHeartRateBpm: number | null;
  trainingLoad: number;
}

export interface DashboardSummary {
  from: string | null;
  to: string | null;
  granularity: TimeGranularity;
  rides: number;
  distanceM: number;
  durationS: number;
  movingTimeS: number;
  elevationGainM: number;
  energyKcal: number;
  maximumSpeedMps: number | null;
  series: PeriodSeriesPoint[];
}

export interface AnalyticsPreferences {
  timezone: string;
  maximumHeartRateBpm: number | null;
  restingHeartRateBpm: number | null;
}

export interface PeriodGoal {
  period: string;
  distanceM: number | null;
  durationS: number | null;
  elevationGainM: number | null;
  rides: number | null;
}

export interface AnalyticsCoverage {
  rides: number;
  distance: number;
  duration: number;
  movingTime: number;
  elevation: number;
  energy: number;
  speed: number;
  heartRate: number;
  power: number;
  cadence: number;
  route: number;
}

export interface AnalyticsTotals {
  rides: number;
  distanceM: number;
  durationS: number;
  movingTimeS: number;
  elevationGainM: number;
  energyKcal: number;
  averageSpeedMps: number | null;
  maximumSpeedMps: number | null;
  averageHeartRateBpm: number | null;
}

export interface AnalyticsRecord {
  key: "distance" | "duration" | "elevation" | "speed" | "maxSpeed" | "load" | "day" | "week" | "month" | "year";
  label: string;
  value: number;
  unit: "m" | "s" | "mps" | "load";
  activityId: string | null;
  periodStart: string | null;
}

export interface PeriodGoalProgress extends PeriodGoal {
  actual: {
    distanceM: number;
    durationS: number;
    elevationGainM: number;
    rides: number;
  };
  elapsedRatio: number;
}

export interface AnalyticsOverview {
  range: { from: string | null; to: string | null; granularity: TimeGranularity; activityType: ActivityTypeFilter };
  totals: AnalyticsTotals;
  previousTotals: AnalyticsTotals | null;
  deltas: Record<keyof AnalyticsTotals, number | null>;
  coverage: AnalyticsCoverage;
  timeline: PeriodSeriesPoint[];
  previousTimeline: PeriodSeriesPoint[];
  calendar: Array<{ date: string; rides: number; distanceM: number; durationS: number }>;
  consistency: {
    activeDays: number;
    ridesPerWeek: number;
    ridesPerMonth: number;
    daysSinceLastRide: number | null;
    currentWeekStreak: number;
    longestWeekStreak: number;
  };
  records: AnalyticsRecord[];
  patterns: {
    weekdays: Array<{ day: number; rides: number; distanceM: number }>;
    hours: Array<{ hour: number; rides: number }>;
    weekdayRides: number;
    weekendRides: number;
  };
  terrain: {
    elevationPer100Km: number | null;
    flatRides: number;
    rollingRides: number;
    mountainRides: number;
    scatter: Array<{ activityId: string; distanceM: number; elevationGainM: number; averageSpeedMps: number | null; averageHeartRateBpm: number | null }>;
  };
  heartRate: {
    configured: boolean;
    zones: Array<{ zone: number; fromBpm: number; toBpm: number; seconds: number; percentage: number }>;
    totalLoad: number;
    scatter: Array<{ activityId: string; averageHeartRateBpm: number; averageSpeedMps: number | null; distanceM: number; elevationGainM: number }>;
  };
  exploration: {
    gpsDistanceM: number;
    cells: number;
    newCells: number;
    heatCells: Array<{ longitude: number; latitude: number; visits: number }>;
  };
  goals: PeriodGoalProgress[];
  insights: string[];
}

export interface AuthStatus {
  authenticated: boolean;
  setupRequired: boolean;
  recoverySession?: boolean;
}
