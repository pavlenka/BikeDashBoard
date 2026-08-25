import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

import type { PeriodSeriesPoint, TimeGranularity } from "../../shared/contracts";
import { formatPeriod, formatPeriodLabel } from "../lib/format";

echarts.use([BarChart, GridComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

export function PeriodChart({ data, granularity }: { data: PeriodSeriesPoint[]; granularity: TimeGranularity }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const limits: Record<TimeGranularity, number> = { day: 31, week: 20, month: 12, year: 20 };
    const visible = data.slice(-limits[granularity]);
    const distances = visible.map((item) => Number((item.distanceM / 1000).toFixed(1)));
    const average = distances.length ? distances.reduce((total, value) => total + value, 0) / distances.length : 0;
    chart.setOption({
      animationDuration: 450,
      grid: { left: 42, right: 10, top: 14, bottom: 30 },
      tooltip: {
        trigger: "axis",
        formatter: (items: unknown) => {
          const item = (items as Array<{ axisValue: string; dataIndex: number; value: number }>)[0];
          const point = visible[item.dataIndex];
          return `${formatPeriodLabel(point.periodStart, granularity)}<br><strong>${Number(item.value).toLocaleString("es-ES", { maximumFractionDigits: 1 })} km</strong>`;
        },
      },
      xAxis: {
        type: "category",
        data: visible.map((item) => formatPeriod(item.periodStart, granularity, true)),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "#7c898d" } },
        axisLabel: { color: "#95a4aa", fontFamily: "IBM Plex Mono", interval: granularity === "week" ? 3 : 0 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#95a4aa", formatter: "{value} km", fontFamily: "IBM Plex Mono" },
        splitLine: { lineStyle: { color: "#2d383e" } },
      },
      series: [
        {
          type: "bar",
          data: distances,
          itemStyle: { color: "#27a8df" },
          emphasis: { itemStyle: { color: "#d6e22e" } },
          barMaxWidth: 26,
          markLine: average > 0 ? {
            silent: true,
            symbol: "none",
            lineStyle: { color: "#eef3f4", type: "dashed", width: 1.25, opacity: 0.85 },
            label: {
              show: true,
              position: "insideStartTop",
              distance: 5,
              color: "#eef3f4",
              fontFamily: "IBM Plex Mono",
              fontSize: 10,
              formatter: `Media ${average.toLocaleString("es-ES", { maximumFractionDigits: 1 })} km`,
            },
            data: [{ yAxis: average }],
          } : undefined,
        },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [data, granularity]);
  return <div className="weekly-chart" ref={ref} />;
}
