/**
 * Shared inline style constants for status page components.
 */

import type { CSSProperties } from "react";

/** Standard card container style used by ComponentGroup, IncidentCard, and MaintenanceCard. */
export const cardStyle: CSSProperties = {
  backgroundColor: "var(--ui-1)",
  border: "1px solid var(--border)",
  borderRadius: "10px",
  padding: "16px 20px",
  marginBottom: "8px",
};

/** Section heading style used for "System Status", "Active Incidents", etc. */
export const sectionHeadingStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 600,
  color: "var(--text-70)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: "12px",
};
