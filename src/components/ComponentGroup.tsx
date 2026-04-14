"use client";

import { useState } from "react";
import { ComponentGroup as ComponentGroupType, DurationDays } from "@/types/status";
import UptimeBar from "@/components/UptimeBar";
import { cardStyle } from "@/lib/styles";

interface ComponentGroupProps {
  group: ComponentGroupType;
  duration: DurationDays;
}

function getStatusColor(status: string): string {
  switch (status) {
    case "operational":
      return "var(--success-1)";
    case "degraded":
      return "var(--warning-1)";
    case "outage":
    case "investigating":
    case "identified":
      return "var(--error-1)";
    case "maintenance":
      return "var(--blue)";
    default:
      return "var(--text-40)";
  }
}

/** Status priority order — worst first. Shared by getWorstStatus and getMergedDailyHistory. */
const STATUS_PRIORITY = ["outage", "investigating", "identified", "degraded", "maintenance", "operational"];

function getWorstStatus(statuses: string[]): string {
  for (const p of STATUS_PRIORITY) {
    if (statuses.includes(p)) return p;
  }
  return "operational";
}

function getUptimeKey(duration: DurationDays): "30d" | "60d" | "90d" {
  return `${duration}d` as "30d" | "60d" | "90d";
}

function getGroupUptime(group: ComponentGroupType, duration: DurationDays): number {
  const key = getUptimeKey(duration);
  if (group.components.length === 0) return 100;
  if (group.components.length === 1) return group.components[0].uptime[key];
  const sum = group.components.reduce((acc, c) => acc + c.uptime[key], 0);
  return sum / group.components.length;
}

function getMergedDailyHistory(group: ComponentGroupType) {
  // For single component, return its history directly
  if (group.components.length <= 1) {
    return group.components[0]?.daily_history ?? [];
  }
  // For multi-component groups, merge by averaging uptime_pct per date
  const dateMap = new Map<string, { total: number; count: number; worstStatus: string }>();
  for (const comp of group.components) {
    for (const day of comp.daily_history) {
      const existing = dateMap.get(day.date);
      if (existing) {
        existing.total += day.uptime_pct;
        existing.count += 1;
        if (STATUS_PRIORITY.indexOf(day.status) < STATUS_PRIORITY.indexOf(existing.worstStatus)) {
          existing.worstStatus = day.status;
        }
      } else {
        dateMap.set(day.date, { total: day.uptime_pct, count: 1, worstStatus: day.status });
      }
    }
  }
  return Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { total, count, worstStatus }]) => ({
      date,
      status: worstStatus,
      uptime_pct: total / count,
    }));
}

export default function ComponentGroup({ group, duration }: ComponentGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const isExpandable = group.components.length > 1;
  const worstStatus = getWorstStatus(group.components.map((c) => c.status));
  const uptime = getGroupUptime(group, duration);
  const dailyHistory = getMergedDailyHistory(group);

  return (
    <div style={cardStyle}>
      {/* Header row */}
      <div
        onClick={isExpandable ? () => setExpanded(!expanded) : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: isExpandable ? "pointer" : "default",
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
          {/* Status dot */}
          <div
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              backgroundColor: getStatusColor(worstStatus),
              flexShrink: 0,
            }}
          />
          {/* Group name */}
          <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--text)" }}>
            {group.name}
          </span>
          {/* Component count badge + chevron */}
          {isExpandable && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "12px",
                color: "var(--text-40)",
                backgroundColor: "var(--bg)",
                padding: "2px 8px",
                borderRadius: "10px",
                border: "1px solid var(--border)",
              }}
            >
              {group.components.length} components
              <span
                style={{
                  display: "inline-block",
                  transition: "transform 0.2s ease",
                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                  fontSize: "10px",
                }}
              >
                ▼
              </span>
            </span>
          )}
        </div>
        {/* Uptime percentage */}
        <span
          style={{
            fontWeight: 600,
            fontSize: "14px",
            color: uptime >= 99 ? "var(--success-1)" : uptime >= 95 ? "var(--warning-1)" : "var(--error-1)",
            flexShrink: 0,
            marginLeft: "12px",
          }}
        >
          {uptime.toFixed(2)}%
        </span>
      </div>

      {/* Uptime bar */}
      <div style={{ marginTop: "12px" }}>
        <UptimeBar dailyHistory={dailyHistory} days={duration} />
      </div>

      {/* Expanded sub-components */}
      {expanded && isExpandable && (
        <div
          style={{
            marginTop: "12px",
            borderTop: "1px solid var(--border)",
            paddingTop: "12px",
          }}
        >
          {group.components.map((comp) => {
            const key = getUptimeKey(duration);
            return (
              <div
                key={comp.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 0",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      backgroundColor: getStatusColor(comp.status),
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: "13px", color: "var(--text-70)" }}>{comp.name}</span>
                </div>
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color:
                      comp.uptime[key] >= 99
                        ? "var(--success-1)"
                        : comp.uptime[key] >= 95
                          ? "var(--warning-1)"
                          : "var(--error-1)",
                  }}
                >
                  {comp.uptime[key].toFixed(2)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
