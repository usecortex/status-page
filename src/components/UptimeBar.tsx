"use client";

import { DailyUptime, DurationDays } from "@/types/status";

interface UptimeBarProps {
  dailyHistory: DailyUptime[];
  days: DurationDays;
}

function getBarColor(entry: DailyUptime | null): string {
  if (!entry) return "rgba(213, 219, 230, 0.1)";
  if (entry.uptime_pct >= 99) return "#53b957";
  if (entry.uptime_pct >= 95) return "#f39237";
  return "#ea6868";
}

export default function UptimeBar({ dailyHistory, days }: UptimeBarProps) {
  // Take the last `days` entries
  const recentHistory = dailyHistory.slice(-days);

  // Pad the beginning with null entries if fewer than `days`
  const padCount = days - recentHistory.length;
  const entries: (DailyUptime | null)[] = [
    ...Array.from({ length: padCount }, () => null),
    ...recentHistory,
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: "2px",
        height: "28px",
        width: "100%",
        alignItems: "stretch",
      }}
    >
      {entries.map((entry, i) => (
        <div
          key={i}
          title={
            entry
              ? `${entry.date}: ${entry.uptime_pct.toFixed(2)}% uptime`
              : "No data"
          }
          style={{
            flex: 1,
            borderRadius: "2px",
            backgroundColor: getBarColor(entry),
            cursor: "default",
            transition: "opacity 0.15s ease",
            minWidth: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.opacity = "0.7";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.opacity = "1";
          }}
        />
      ))}
    </div>
  );
}
