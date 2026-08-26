import { describe, expect, it } from "vitest";

import { formatGoalPeriod, formatPeriod, formatPeriodLabel, formatTime } from "./format";

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

describe("hora local de las rutas", () => {
  it("aplica automáticamente el horario de verano de Madrid", () => {
    expect(formatTime("2026-08-20T05:00:00Z")).toBe("07:00");
  });

  it("aplica automáticamente el horario de invierno de Madrid", () => {
    expect(formatTime("2026-11-20T05:00:00Z")).toBe("06:00");
  });
});
