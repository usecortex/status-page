"use client";

import { Incident } from "@/types/status";
import { formatDate } from "@/lib/format";
import { cardStyle } from "@/lib/styles";

interface IncidentCardProps {
  incident: Incident;
}

function getStatusBadgeColor(status: string): { bg: string; text: string } {
  switch (status) {
    case "investigating":
    case "identified":
      return { bg: "rgba(234, 104, 104, 0.15)", text: "var(--error-1)" };
    case "watching":
      return { bg: "rgba(243, 146, 55, 0.15)", text: "var(--warning-1)" };
    case "resolved":
      return { bg: "rgba(83, 185, 87, 0.15)", text: "var(--success-1)" };
    default:
      return { bg: "rgba(213, 219, 230, 0.1)", text: "var(--text-40)" };
  }
}

export default function IncidentCard({ incident }: IncidentCardProps) {
  const badgeColors = getStatusBadgeColor(incident.status);

  return (
    <div style={cardStyle}>
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
          {incident.name}
        </span>
        <span
          style={{
            fontSize: "12px",
            fontWeight: 600,
            padding: "3px 10px",
            borderRadius: "12px",
            backgroundColor: badgeColors.bg,
            color: badgeColors.text,
            textTransform: "capitalize",
          }}
        >
          {incident.status}
        </span>
      </div>

      {/* Started at */}
      <div style={{ fontSize: "12px", color: "var(--text-40)", marginBottom: "12px" }}>
        Started {formatDate(incident.started_at)}
        {incident.resolved_at && ` · Resolved ${formatDate(incident.resolved_at)}`}
      </div>

      {/* Updates */}
      {incident.updates.length > 0 && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: "12px",
          }}
        >
          {incident.updates.map((update, i) => (
            <div
              key={i}
              style={{
                paddingBottom: i < incident.updates.length - 1 ? "10px" : 0,
                marginBottom: i < incident.updates.length - 1 ? "10px" : 0,
                borderBottom:
                  i < incident.updates.length - 1 ? "1px solid var(--border)" : "none",
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
