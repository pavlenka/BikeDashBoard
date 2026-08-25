import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

import type { PeriodSeriesPoint, TimeGranularity } from "../../shared/contracts";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export function PeriodChart({ data, granularity }: { data: PeriodSeriesPoint[]; granularity: TimeGranularity }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const limits: Record<TimeGranularity, number> = { day: 31, week: 20, month: 12, year: 20 };
    const visible = data.slice(-limits[granularity]);
    chart.setOption({
      animationDuration: 450,
      grid: { left: 42, right: 10, top: 14, bottom: 30 },
      tooltip: {
        trigger: "axis",
        formatter: (items: unknown) => {
          const item = (items as Array<{ axisValue: string; value: number }>)[0];
          return `${item.axisValue}<br><strong>${Number(item.value).toLocaleString("es-ES", { maximumFractionDigits: 1 })} km</strong>`;
        },
      },
      xAxis: {
        type: "category",
        data: visible.map((item) => granularity === "year" ? item.periodStart : item.periodStart.replace(/^\d{4}-/, "")),
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
          data: visible.map((item) => Number((item.distanceM / 1000).toFixed(1))),
          itemStyle: { color: "#27a8df" },
          emphasis: { itemStyle: { color: "#d6e22e" } },
          barMaxWidth: 26,
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
