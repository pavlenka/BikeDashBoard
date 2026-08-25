import { describe, expect, it } from "vitest";

import { formatGoalPeriod, formatPeriod, formatPeriodLabel } from "./format";

describe("formatos de periodo en español", () => {
  it("presenta días y semanas sin formato ISO visible", () => {
    expect(formatPeriod("2026-07-27", "week", true)).toBe("27 jul");
    expect(formatPeriodLabel("2026-07-27", "week")).toBe("Semana del 27 jul 2026");
  });

  it("presenta meses y objetivos con nombres españoles", () => {
    expect(formatPeriod("2026-07-01", "month")).toBe("julio de 2026");
    expect(formatGoalPeriod("2026-07")).toBe("julio de 2026");
    expect(formatGoalPeriod("2026")).toBe("2026");
  });
});
