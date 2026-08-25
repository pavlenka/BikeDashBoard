import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

import type { AnalyticsOverview, PeriodSeriesPoint } from "../../shared/contracts";

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export type EvolutionMetric = "distanceM" | "durationS" | "elevationGainM" | "rides" | "energyKcal" | "averageSpeedMps" | "maximumSpeedMps" | "averageHeartRateBpm" | "trainingLoad";

const metricInfo: Record<EvolutionMetric, { label: string; unit: string; transform: (value: number) => number }> = {
  distanceM: { label: "Distancia", unit: "km", transform: (value) => value / 1000 },
  durationS: { label: "Tiempo", unit: "h", transform: (value) => value / 3600 },
  elevationGainM: { label: "Desnivel", unit: "m", transform: (value) => value },
  rides: { label: "Salidas", unit: "", transform: (value) => value },
  energyKcal: { label: "Energía", unit: "kcal", transform: (value) => value },
  averageSpeedMps: { label: "Velocidad", unit: "km/h", transform: (value) => value * 3.6 },
  maximumSpeedMps: { label: "Vel. máxima", unit: "km/h", transform: (value) => value * 3.6 },
  averageHeartRateBpm: { label: "Pulso", unit: "ppm", transform: (value) => value },
  trainingLoad: { label: "Carga", unit: "pts", transform: (value) => value },
};

export function EvolutionChart({ data, previous, metric, goalTarget }: { data: PeriodSeriesPoint[]; previous: PeriodSeriesPoint[]; metric: EvolutionMetric; goalTarget?: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const info = metricInfo[metric];
    const values = data.map((point) => {
      const raw = point[metric];
      return raw === null ? null : Number(info.transform(raw).toFixed(2));
    });
    const previousValues = previous.map((point) => {
      const raw = point[metric];
      return raw === null ? null : Number(info.transform(raw).toFixed(2));
    });
    let running = 0;
    const cumulative = values.map((value) => {
      running += value ?? 0;
      return Number(running.toFixed(2));
    });
    const transformedGoal = goalTarget ? info.transform(goalTarget) : null;
    chart.setOption({
      animationDuration: 350,
      backgroundColor: "transparent",
      grid: { left: 54, right: 48, top: 42, bottom: 38 },
      legend: { top: 0, right: 0, textStyle: { color: "#95a4aa", fontFamily: "IBM Plex Mono", fontSize: 10 } },
      tooltip: { trigger: "axis", confine: true, valueFormatter: (value: unknown) => `${Number(value).toLocaleString("es-ES", { maximumFractionDigits: 1 })} ${info.unit}` },
      xAxis: { type: "category", data: data.map((point) => point.periodStart), axisTick: { show: false }, axisLine: { lineStyle: { color: "#46545b" } }, axisLabel: { color: "#95a4aa", fontFamily: "IBM Plex Mono", hideOverlap: true } },
      yAxis: [
        { type: "value", name: info.unit, nameTextStyle: { color: "#95a4aa" }, axisLabel: { color: "#95a4aa", fontFamily: "IBM Plex Mono" }, splitLine: { lineStyle: { color: "#2d383e" } } },
        { type: "value", show: false },
      ],
      series: [
        { name: info.label, type: "bar", data: values, barMaxWidth: 34, itemStyle: { color: "#27a8df" }, emphasis: { itemStyle: { color: "#d6e22e" } } },
        { name: "Periodo anterior", type: "line", data: data.map((_point, index) => previousValues[index] ?? null), showSymbol: false, lineStyle: { color: "#77868d", type: "dashed", width: 1.5 } },
        ...(metric === "distanceM" || metric === "durationS" || metric === "elevationGainM" || metric === "rides" ? [{ name: "Acumulado", type: "line" as const, yAxisIndex: 1, data: cumulative, showSymbol: false, lineStyle: { color: "#d6e22e", width: 2.5 }, areaStyle: { color: "rgba(214,226,46,.05)" } }] : []),
        ...(transformedGoal ? [{ name: "Objetivo", type: "line" as const, yAxisIndex: 1, data: data.map((_point, index) => transformedGoal * (index + 1) / Math.max(1, data.length)), showSymbol: false, lineStyle: { color: "#eef3f4", width: 1, type: "dotted" as const } }] : []),
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [data, goalTarget, metric, previous]);
  return <div className="analytics-evolution" ref={ref} />;
}

export function PerformanceScatter({ points, onSelect }: { points: AnalyticsOverview["heartRate"]["scatter"]; onSelect: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      animationDuration: 300,
      grid: { left: 52, right: 24, top: 24, bottom: 42 },
      tooltip: { formatter: (item: unknown) => { const value = (item as { value: number[] }).value; return `<strong>${value[1]} ppm</strong><br>${value[0].toLocaleString("es-ES", { maximumFractionDigits: 1 })} km/h · ${value[2].toLocaleString("es-ES", { maximumFractionDigits: 1 })} km`; } },
      xAxis: { type: "value", name: "km/h", nameTextStyle: { color: "#95a4aa" }, axisLabel: { color: "#95a4aa" }, splitLine: { lineStyle: { color: "#2d383e" } } },
      yAxis: { type: "value", name: "ppm", nameTextStyle: { color: "#95a4aa" }, axisLabel: { color: "#95a4aa" }, splitLine: { lineStyle: { color: "#2d383e" } } },
      series: [{
        type: "scatter",
        data: points.filter((point) => point.averageSpeedMps !== null).map((point) => ({
          value: [(point.averageSpeedMps ?? 0) * 3.6, point.averageHeartRateBpm, point.distanceM / 1000, point.elevationGainM],
          activityId: point.activityId,
        })),
        symbolSize: (value: number[]) => Math.max(8, Math.min(28, 7 + Math.sqrt(value[2]))),
        itemStyle: { color: "#dc4a3d", opacity: 0.82, borderColor: "#f4f7f7", borderWidth: 1 },
      }],
    });
    chart.on("click", (event: unknown) => {
      const activityId = (event as { data?: { activityId?: string } }).data?.activityId;
      if (activityId) onSelect(activityId);
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [onSelect, points]);
  return <div className="performance-scatter" ref={ref} />;
}
