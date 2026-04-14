"use client";

import { useState } from "react";
import { StatusSnapshot, DurationDays } from "@/types/status";
import { DEFAULT_COMPONENT_GROUPS } from "@/lib/defaults";
import DurationSelector from "@/components/DurationSelector";
import ComponentGroup from "@/components/ComponentGroup";
import IncidentCard from "@/components/IncidentCard";
import MaintenanceCard from "@/components/MaintenanceCard";

interface StatusPageProps {
  data: StatusSnapshot | null;
}

function getOverallStatusDisplay(status: string): { label: string; color: string; bg: string } {
  switch (status) {
    case "operational":
      return {
        label: "All Systems Operational",
        color: "#fff",
        bg: "var(--success-1)",
      };
    case "degraded":
      return {
        label: "Degraded Performance",
        color: "#fff",
        bg: "var(--warning-1)",
      };
    case "outage":
      return {
        label: "Major Outage",
        color: "#fff",
        bg: "var(--error-1)",
      };
    case "maintenance":
      return {
        label: "Scheduled Maintenance In Progress",
        color: "#fff",
        bg: "var(--blue)",
      };
    default:
      return {
        label: "Status Monitoring Is Being Set Up",
        color: "var(--text-70)",
        bg: "var(--ui-1)",
      };
  }
}

function formatLastUpdated(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function StatusPage({ data }: StatusPageProps) {
  const [duration, setDuration] = useState<DurationDays>(90);

  const isConfigured = data !== null && data.configured === true;
  const overallStatus = isConfigured ? data.overall_status : "unknown";
  const statusDisplay = getOverallStatusDisplay(overallStatus);

  const componentGroups = isConfigured ? data.component_groups : DEFAULT_COMPONENT_GROUPS;
  const incidents = isConfigured ? data.incidents : [];
  const maintenanceWindows = isConfigured
    ? data.maintenance_windows.filter((m) => m.status !== "completed")
    : [];

  return (
    <div
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "40px 20px 60px",
        minHeight: "100vh",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "24px",
        }}
      >
        <span
          style={{
            fontWeight: 800,
            fontSize: "20px",
            color: "var(--text)",
            letterSpacing: "-0.02em",
          }}
        >
          HydraDB
        </span>
        <span
          style={{
            fontSize: "20px",
            color: "var(--text-40)",
            fontWeight: 400,
          }}
        >
          Status
        </span>
      </div>

      {/* Overall status banner */}
      <div
        style={{
          backgroundColor: statusDisplay.bg,
          borderRadius: "10px",
          padding: "20px 24px",
          marginBottom: "32px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          border: overallStatus === "unknown" ? "1px solid var(--border)" : "none",
        }}
      >
        <div
          style={{
            width: "12px",
            height: "12px",
            borderRadius: "50%",
            backgroundColor: overallStatus === "unknown" ? "var(--text-40)" : "rgba(255, 255, 255, 0.9)",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontWeight: 600,
            fontSize: "15px",
            color: statusDisplay.color,
          }}
        >
          {statusDisplay.label}
        </span>
      </div>

      {/* Duration selector */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "16px",
        }}
      >
        <DurationSelector selected={duration} onChange={setDuration} />
      </div>

      {/* System status section header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        <span
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--text-70)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          System Status
        </span>
        <span
          style={{
            fontSize: "12px",
            color: "var(--text-40)",
          }}
        >
          {duration} days
        </span>
      </div>

      {/* Component group cards */}
      <div style={{ marginBottom: "32px" }}>
        {componentGroups.map((group) => (
          <ComponentGroup
            key={group.id}
            group={group}
            duration={duration}
            incidents={incidents}
          />
        ))}
      </div>

      {/* Active Incidents */}
      {incidents.length > 0 && (
        <div style={{ marginBottom: "32px" }}>
          <div
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--text-70)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "12px",
            }}
          >
            Active Incidents
          </div>
          {incidents.map((incident) => (
            <IncidentCard key={incident.id} incident={incident} />
          ))}
        </div>
      )}

      {/* Scheduled Maintenance */}
      {maintenanceWindows.length > 0 && (
        <div style={{ marginBottom: "32px" }}>
          <div
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--text-70)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "12px",
            }}
          >
            Scheduled Maintenance
          </div>
          {maintenanceWindows.map((mw) => (
            <MaintenanceCard key={mw.id} maintenance={mw} />
          ))}
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          paddingTop: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "12px",
          color: "var(--text-40)",
        }}
      >
        <span>
          {isConfigured
            ? `Last updated: ${formatLastUpdated(data.generated_at)}`
            : "Waiting for first status check…"}
        </span>
        <a
          href="https://incident.io"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "var(--text-40)",
            textDecoration: "none",
            transition: "color 0.15s ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-70)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-40)";
          }}
        >
          Powered by incident.io
        </a>
      </div>
    </div>
  );
}
