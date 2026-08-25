import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { LineChart } from "echarts/charts";
import { CanvasRenderer } from "echarts/renderers";

import type { RoutePoint } from "../../shared/contracts";

echarts.use([GridComponent, MarkLineComponent, TooltipComponent, LineChart, CanvasRenderer]);

type RideMetric = "elevationM" | "heartRateBpm" | "speedMps" | "powerW" | "cadenceRpm";

const metrics: Record<RideMetric, { label: string; unit: string; color: string; value: (point: RoutePoint) => number | null | undefined }> = {
  elevationM: { label: "Elevación", unit: "m", color: "#27a8df", value: (point) => point.elevationM },
  heartRateBpm: { label: "Pulso", unit: "ppm", color: "#ff6659", value: (point) => point.heartRateBpm },
  speedMps: { label: "Velocidad", unit: "km/h", color: "#d6e22e", value: (point) => point.speedMps === null || point.speedMps === undefined ? null : point.speedMps * 3.6 },
  powerW: { label: "Potencia", unit: "W", color: "#aa86ff", value: (point) => point.powerW },
  cadenceRpm: { label: "Cadencia", unit: "rpm", color: "#f5a742", value: (point) => point.cadenceRpm },
};

export function RideChart({ points, onHover }: { points: RoutePoint[]; onHover: (index: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const available = useMemo(() => (Object.keys(metrics) as RideMetric[]).filter((key) => points.some((point) => metrics[key].value(point) !== null && metrics[key].value(point) !== undefined)), [points]);
  const [metric, setMetric] = useState<RideMetric>(available.includes("elevationM") ? "elevationM" : available[0] ?? "elevationM");
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    const labels = points.map((point, index) => point.timestamp?.slice(11, 16) ?? String(index + 1));
    const values = points.map((point) => metrics[metric].value(point) ?? null);
    const numericValues = values.filter((value): value is number => value !== null);
    const average = numericValues.length ? numericValues.reduce((total, value) => total + value, 0) / numericValues.length : null;
    chart.setOption({
      animation: false,
      backgroundColor: "transparent",
      grid: { left: 52, right: 34, top: 18, bottom: 34 },
      tooltip: { trigger: "axis", confine: true },
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: "#7c898d" } },
        axisLabel: { color: "#556268", fontFamily: "IBM Plex Mono", hideOverlap: true },
      },
      yAxis: {
          type: "value",
          name: metrics[metric].unit,
          scale: true,
          axisLabel: { color: "#95a4aa", fontFamily: "IBM Plex Mono" },
          splitLine: { lineStyle: { color: "#2d383e" } },
        },
      series: [
        {
          name: metrics[metric].label,
          type: "line",
          data: values,
          showSymbol: false,
          smooth: 0.15,
          connectNulls: false,
          lineStyle: { color: metrics[metric].color, width: 2 },
          areaStyle: { color: `${metrics[metric].color}18` },
          markLine: average === null ? undefined : {
            silent: true,
            symbol: "none",
            lineStyle: { color: "#eef3f4", type: "dashed", width: 1.25, opacity: 0.85 },
            label: { color: "#eef3f4", fontFamily: "IBM Plex Mono", fontSize: 10, formatter: `Media ${average.toLocaleString("es-ES", { maximumFractionDigits: 1 })} ${metrics[metric].unit}` },
            data: [{ yAxis: average }],
          },
        },
      ],
    });
    chart.on("updateAxisPointer", (event: unknown) => {
      const info = event as { axesInfo?: Array<{ value?: number | string }> };
      const index = Number(info.axesInfo?.[0]?.value);
      if (Number.isFinite(index)) onHover(index);
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [metric, onHover, points]);
  return <div className="ride-chart-wrap"><div className="ride-chart-switch">{available.map((key) => <button key={key} className={metric === key ? "active" : ""} onClick={() => setMetric(key)}>{metrics[key].label}</button>)}</div><div className="ride-chart" ref={ref} /></div>;
}
