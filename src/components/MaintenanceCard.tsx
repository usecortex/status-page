"use client";

import { MaintenanceWindow } from "@/types/status";

interface MaintenanceCardProps {
  maintenance: MaintenanceWindow;
}

function getStatusBadgeColor(status: string): { bg: string; text: string } {
  switch (status) {
    case "scheduled":
      return { bg: "rgba(166, 218, 255, 0.15)", text: "var(--blue)" };
    case "in_progress":
      return { bg: "rgba(243, 146, 55, 0.15)", text: "var(--warning-1)" };
    default:
      return { bg: "rgba(213, 219, 230, 0.1)", text: "var(--text-40)" };
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function MaintenanceCard({ maintenance }: MaintenanceCardProps) {
  const badgeColors = getStatusBadgeColor(maintenance.status);

  return (
    <div
      style={{
        backgroundColor: "var(--ui-1)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "16px 20px",
        marginBottom: "8px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "8px",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--text)" }}>
          {maintenance.name}
        </span>
        <span
          style={{
            fontSize: "12px",
            fontWeight: 600,
            padding: "3px 10px",
            borderRadius: "12px",
            backgroundColor: badgeColors.bg,
            color: badgeColors.text,
          }}
        >
          {formatStatusLabel(maintenance.status)}
        </span>
      </div>

      {/* Time range */}
      <div style={{ fontSize: "12px", color: "var(--text-40)", marginBottom: maintenance.updates?.length ? "12px" : 0 }}>
        {formatDate(maintenance.starts_at)} — {formatDate(maintenance.ends_at)}
      </div>

      {/* Updates */}
      {maintenance.updates && maintenance.updates.length > 0 && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: "12px",
          }}
        >
          {maintenance.updates.map((update, i) => (
            <div
              key={i}
              style={{
                paddingBottom: i < (maintenance.updates?.length ?? 0) - 1 ? "10px" : 0,
                marginBottom: i < (maintenance.updates?.length ?? 0) - 1 ? "10px" : 0,
                borderBottom:
                  i < (maintenance.updates?.length ?? 0) - 1 ? "1px solid var(--border)" : "none",
              }}
            >
              <div style={{ fontSize: "13px", color: "var(--text-70)", lineHeight: "1.5" }}>
                {update.body}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-40)", marginTop: "4px" }}>
                {formatDate(update.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
