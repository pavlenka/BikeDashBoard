import { describe, expect, it } from "vitest";

import { formatGoalPeriod, formatPeriod, formatPeriodLabel, formatRouteCount, formatTime, periodStartForDate } from "./format";

describe("formatos de periodo en español", () => {
  it("presenta días y semanas sin formato ISO visible", () => {
    expect(formatPeriod("2026-07-27", "week", true)).toBe("27 jul");
    expect(formatPeriodLabel("2026-07-27", "week")).toBe("Semana del 27 jul 2026");
  });

  it("presenta meses y objetivos con nombres españoles", () => {
    expect(formatPeriod("2026-07-01", "month")).toBe("julio de 2026");
    expect(formatPeriod("2026-07", "month")).toBe("julio de 2026");
    expect(formatGoalPeriod("2026-07")).toBe("julio de 2026");
    expect(formatGoalPeriod("2026")).toBe("2026");
  });
});

describe("asignación local de periodos", () => {
  it("coincide con semanas, meses y años de Madrid", () => {
    expect(periodStartForDate("2026-08-20T22:30:00Z", "week")).toBe("2026-08-17");
    expect(periodStartForDate("2026-08-31T22:30:00Z", "month")).toBe("2026-09");
    expect(periodStartForDate("2026-12-31T23:30:00Z", "year")).toBe("2027");
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

describe("número de rutas", () => {
  it("presenta correctamente singular y plural", () => {
    expect(formatRouteCount(1)).toBe("1 ruta");
    expect(formatRouteCount(3)).toBe("3 rutas");
  });
});
