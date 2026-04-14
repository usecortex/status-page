import {
  isDownStatus,
  computeDailyUptime,
  computeRollingUptime,
  computeUptimeMetrics,
  mergeHistoricalData,
  deriveOverallStatus,
  deriveDayStatus,
} from "@/lib/uptime";
import { Incident, DailyUptime } from "@/types/status";

describe("isDownStatus", () => {
  it("returns true for down statuses", () => {
    expect(isDownStatus("full_outage")).toBe(true);
    expect(isDownStatus("partial_outage")).toBe(true);
    expect(isDownStatus("investigating")).toBe(true);
    expect(isDownStatus("identified")).toBe(true);
    expect(isDownStatus("outage")).toBe(true);
  });

  it("returns false for up statuses", () => {
    expect(isDownStatus("operational")).toBe(false);
    expect(isDownStatus("degraded_performance")).toBe(false);
    expect(isDownStatus("under_maintenance")).toBe(false);
    expect(isDownStatus("degraded")).toBe(false);
    expect(isDownStatus("maintenance")).toBe(false);
    expect(isDownStatus("watching")).toBe(false);
  });

  it("returns false for unknown statuses", () => {
    expect(isDownStatus("unknown")).toBe(false);
    expect(isDownStatus("")).toBe(false);
  });
});

describe("computeDailyUptime", () => {
  it("returns 100% for a day with no incidents", () => {
    const result = computeDailyUptime([], "hybrid-search", "2026-04-14");
    expect(result).toEqual({ date: "2026-04-14", status: "operational", uptime_pct: 100 });
  });

  it("returns 100% when incident does not affect this component", () => {
    const incidents: Incident[] = [{
      id: "inc_1",
      name: "Test",
      status: "investigating",
      started_at: "2026-04-14T06:00:00Z",
      components: ["other-component"],
      updates: [],
    }];
    const result = computeDailyUptime(incidents, "hybrid-search", "2026-04-14");
    expect(result.uptime_pct).toBe(100);
  });

  it("computes partial downtime for a resolved incident with down status", () => {
    // 2 hours of downtime = 120 minutes out of 1440
    const incidents: Incident[] = [{
      id: "inc_1",
      name: "Test",
      status: "investigating",
      started_at: "2026-04-14T10:00:00Z",
      resolved_at: "2026-04-14T12:00:00Z",
      components: ["hybrid-search"],
      updates: [],
    }];
    const result = computeDailyUptime(incidents, "hybrid-search", "2026-04-14");
    expect(result.uptime_pct).toBeCloseTo(91.67, 1);
    expect(result.status).toBe("outage"); // < 95%
  });

  it("computes downtime for an unresolved incident (runs to end of day)", () => {
    // Started at 22:00, unresolved = 2 hours of downtime
    const incidents: Incident[] = [{
      id: "inc_1",
      name: "Test",
      status: "investigating",
      started_at: "2026-04-14T22:00:00Z",
      components: ["hybrid-search"],
      updates: [],
    }];
    const result = computeDailyUptime(incidents, "hybrid-search", "2026-04-14");
    expect(result.uptime_pct).toBeCloseTo(91.67, 1);
  });

  it("ignores unscoped incidents (empty components array)", () => {
    const incidents: Incident[] = [{
      id: "inc_1",
      name: "Unscoped",
      status: "investigating",
      started_at: "2026-04-14T00:00:00Z",
      components: [],
      updates: [],
    }];
    const result = computeDailyUptime(incidents, "hybrid-search", "2026-04-14");
    expect(result.uptime_pct).toBe(100);
  });

  it("handles incident spanning multiple days (only counts overlap with target day)", () => {
    // Incident started yesterday, resolved today at 06:00
    const incidents: Incident[] = [{
      id: "inc_1",
      name: "Multi-day",
      status: "investigating",
      started_at: "2026-04-13T20:00:00Z",
      resolved_at: "2026-04-14T06:00:00Z",
      components: ["hybrid-search"],
      updates: [],
    }];
    const result = computeDailyUptime(incidents, "hybrid-search", "2026-04-14");
    // 6 hours = 360 minutes down out of 1440
    expect(result.uptime_pct).toBe(75);
    expect(result.status).toBe("outage");
  });

  it("does not count resolved/watching incidents as downtime", () => {
    // An incident with status "resolved" should NOT count as downtime
    const incidents: Incident[] = [{
      id: "inc_1",
      name: "Resolved Issue",
      status: "resolved",
      started_at: "2026-04-14T10:00:00Z",
      resolved_at: "2026-04-14T12:00:00Z",
      components: ["hybrid-search"],
      updates: [],
    }];
    const result = computeDailyUptime(incidents, "hybrid-search", "2026-04-14");
    expect(result.uptime_pct).toBe(100);
    expect(result.status).toBe("operational");
  });

  it("does not count watching incidents as downtime", () => {
    const incidents: Incident[] = [{
      id: "inc_1",
      name: "Watching Issue",
      status: "watching",
      started_at: "2026-04-14T10:00:00Z",
      components: ["hybrid-search"],
      updates: [],
    }];
    const result = computeDailyUptime(incidents, "hybrid-search", "2026-04-14");
    expect(result.uptime_pct).toBe(100);
    expect(result.status).toBe("operational");
  });
});

describe("computeRollingUptime", () => {
  it("returns 100 for empty history", () => {
    expect(computeRollingUptime([], 30)).toBe(100);
  });

  it("averages uptime over the last N days", () => {
    const history: DailyUptime[] = [
      { date: "2026-04-12", status: "operational", uptime_pct: 100 },
      { date: "2026-04-13", status: "degraded", uptime_pct: 98 },
      { date: "2026-04-14", status: "operational", uptime_pct: 100 },
    ];
    expect(computeRollingUptime(history, 30)).toBeCloseTo(99.33, 1);
  });

  it("only uses the last N entries", () => {
    const history: DailyUptime[] = [
      { date: "2026-04-11", status: "outage", uptime_pct: 50 },
      { date: "2026-04-12", status: "operational", uptime_pct: 100 },
      { date: "2026-04-13", status: "operational", uptime_pct: 100 },
    ];
    // Only last 2 entries
    expect(computeRollingUptime(history, 2)).toBe(100);
  });
});

describe("computeUptimeMetrics", () => {
  it("returns 100 for all durations with empty history", () => {
    const result = computeUptimeMetrics([]);
    expect(result).toEqual({ "30d": 100, "60d": 100, "90d": 100 });
  });
});

describe("mergeHistoricalData", () => {
  it("replaces existing entries with matching dates", () => {
    const existing: DailyUptime[] = [
      { date: "2026-04-13", status: "operational", uptime_pct: 100 },
      { date: "2026-04-14", status: "operational", uptime_pct: 100 },
    ];
    const fresh: DailyUptime[] = [
      { date: "2026-04-14", status: "degraded", uptime_pct: 95 },
    ];
    const result = mergeHistoricalData(existing, fresh);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ date: "2026-04-14", status: "degraded", uptime_pct: 95 });
  });

  it("appends new dates", () => {
    const existing: DailyUptime[] = [
      { date: "2026-04-13", status: "operational", uptime_pct: 100 },
    ];
    const fresh: DailyUptime[] = [
      { date: "2026-04-14", status: "operational", uptime_pct: 100 },
    ];
    const result = mergeHistoricalData(existing, fresh);
    expect(result).toHaveLength(2);
  });

  it("trims to 90 entries", () => {
    const existing: DailyUptime[] = Array.from({ length: 90 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      status: "operational",
      uptime_pct: 100,
    }));
    const fresh: DailyUptime[] = [
      { date: "2026-04-14", status: "operational", uptime_pct: 100 },
    ];
    const result = mergeHistoricalData(existing, fresh);
    expect(result).toHaveLength(90);
    expect(result[result.length - 1].date).toBe("2026-04-14");
  });

  it("sorts by date ascending", () => {
    const existing: DailyUptime[] = [];
    const fresh: DailyUptime[] = [
      { date: "2026-04-14", status: "operational", uptime_pct: 100 },
      { date: "2026-04-12", status: "operational", uptime_pct: 100 },
      { date: "2026-04-13", status: "operational", uptime_pct: 100 },
    ];
    const result = mergeHistoricalData(existing, fresh);
    expect(result.map(r => r.date)).toEqual(["2026-04-12", "2026-04-13", "2026-04-14"]);
  });
});

describe("deriveOverallStatus", () => {
  it("returns operational when all components are operational and no incidents", () => {
    const groups = [{ components: [{ status: "operational" }, { status: "operational" }] }];
    expect(deriveOverallStatus(groups, [])).toBe("operational");
  });

  it("returns outage when an incident is investigating", () => {
    const groups = [{ components: [{ status: "operational" }] }];
    const incidents = [{ status: "investigating" }];
    expect(deriveOverallStatus(groups, incidents)).toBe("outage");
  });

  it("returns degraded when a component is degraded", () => {
    const groups = [{ components: [{ status: "operational" }, { status: "degraded" }] }];
    expect(deriveOverallStatus(groups, [])).toBe("degraded");
  });

  it("returns maintenance when a component is under maintenance", () => {
    const groups = [{ components: [{ status: "maintenance" }] }];
    expect(deriveOverallStatus(groups, [])).toBe("maintenance");
  });

  it("outage takes priority over degraded", () => {
    const groups = [{ components: [{ status: "degraded" }] }];
    const incidents = [{ status: "investigating" }];
    expect(deriveOverallStatus(groups, incidents)).toBe("outage");
  });

  it("returns outage when a component has status outage and there are no active incidents", () => {
    // Regression test: component status 'outage' (mapped from full_outage/partial_outage
    // by the cron's mapComponentStatuses) must bubble up to the overall banner even
    // when the widget returns no ongoing_incidents for that component.
    const groups = [{ components: [{ status: "outage" }, { status: "operational" }] }];
    expect(deriveOverallStatus(groups, [])).toBe("outage");
  });

  it("component outage takes priority over component degraded", () => {
    const groups = [{ components: [{ status: "degraded" }, { status: "outage" }] }];
    expect(deriveOverallStatus(groups, [])).toBe("outage");
  });
});

describe("deriveDayStatus", () => {
  it("returns outage for < 95%", () => {
    expect(deriveDayStatus(94.99)).toBe("outage");
    expect(deriveDayStatus(0)).toBe("outage");
  });

  it("returns degraded for >= 95% and < 99.5%", () => {
    expect(deriveDayStatus(95)).toBe("degraded");
    expect(deriveDayStatus(99.49)).toBe("degraded");
  });

  it("returns operational for >= 99.5%", () => {
    expect(deriveDayStatus(99.5)).toBe("operational");
    expect(deriveDayStatus(100)).toBe("operational");
  });
});
