import { describe, expect, it } from "vitest";

import {
  attachSensorSeries,
  normalizeWorkouts,
  parseAppleDate,
  parseCyclingWorkouts,
  parseGpx,
} from "./parser";

const healthExport = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Apple Watch" unit="count/min" value="140" startDate="2026-08-20 07:10:00 +0200" endDate="2026-08-20 07:10:01 +0200" />
  <Record type="HKQuantityTypeIdentifierCyclingSpeed" sourceName="Apple Watch" unit="km/hr" value="21.6" startDate="2026-08-20 07:10:00 +0200" endDate="2026-08-20 07:10:01 +0200" />
  <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="iPhone" unit="kg" value="75" startDate="2026-08-20 07:10:00 +0200" endDate="2026-08-20 07:10:01 +0200" />
  <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" sourceName="Apple Watch" uuid="run-1" startDate="2026-08-20 06:00:00 +0200" endDate="2026-08-20 06:30:00 +0200" />
  <Workout workoutActivityType="HKWorkoutActivityTypeCycling" duration="3600" durationUnit="s" totalDistance="12.5" totalDistanceUnit="km" totalEnergyBurned="450" totalEnergyBurnedUnit="kcal" sourceName="Apple Watch" uuid="ride-1" startDate="2026-08-20 07:00:00 +0200" endDate="2026-08-20 08:00:00 +0200">
    <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="142" maximum="177" unit="count/min" />
    <WorkoutStatistics type="HKQuantityTypeIdentifierCyclingSpeed" average="18" maximum="43.2" unit="km/hr" />
    <WorkoutStatistics type="HKQuantityTypeIdentifierElevationAscended" sum="120" unit="m" />
  </Workout>
</HealthData>`;

const routeGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1"><trk><trkseg>
  <trkpt lat="40.4000" lon="-3.7000"><ele>650</ele><time>2026-08-20T05:00:00Z</time></trkpt>
  <trkpt lat="40.4001" lon="-3.6999"><ele>652</ele><time>2026-08-20T05:10:00Z</time></trkpt>
  <trkpt lat="40.4002" lon="-3.6998"><ele>657</ele><time>2026-08-20T05:20:00Z</time></trkpt>
</trkseg></trk></gpx>`;

describe("Apple Health cycling importer", () => {
  it("normalizes Apple timezone dates", () => {
    expect(parseAppleDate("2026-08-20 07:00:00 +0200")).toBe("2026-08-20T05:00:00.000Z");
  });

  it("keeps only cycling data and normalizes metric units", async () => {
    const workouts = await parseCyclingWorkouts(new Blob([healthExport]).stream());
    expect(workouts).toHaveLength(1);

    await attachSensorSeries(new Blob([healthExport]).stream(), workouts);
    const route = await parseGpx(routeGpx);
    const { activities, preview } = normalizeWorkouts(workouts, [route]);
    const activity = activities[0];

    expect(preview).toMatchObject({
      totalCyclingActivities: 1,
      activitiesWithRoutes: 1,
      activitiesWithoutRoutes: 0,
    });
    expect(activity.sourceId).toBe("ride-1");
    expect(activity.distanceM).toEqual({ value: 12_500, origin: "apple" });
    expect(activity.averageSpeedMps.value).toBeCloseTo(5);
    expect(activity.maximumSpeedMps.value).toBeCloseTo(12);
    expect(activity.series.speed[0].value).toBeCloseTo(6);
    expect(activity.averageHeartRateBpm.value).toBe(142);
    expect(activity.route).toHaveLength(3);
  });
});
