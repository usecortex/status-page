/** A single day's uptime record */
export interface DailyUptime {
  date: string; // ISO date string YYYY-MM-DD
  status: string; // worst status that day: "operational" | "degraded" | "outage" | "maintenance"
  uptime_pct: number; // 0-100 percentage
}

/** Rolling uptime percentages for different time windows */
export interface UptimeMetrics {
  "30d": number;
  "60d": number;
  "90d": number;
}

/** A single component within a group */
export interface StatusComponent {
  id: string;
  name: string;
  status: string; // current status
  uptime: UptimeMetrics;
  daily_history: DailyUptime[];
}

/** A group of related components */
export interface ComponentGroup {
  id: string;
  name: string;
  components: StatusComponent[];
}

/** An incident update message */
export interface IncidentUpdate {
  body: string;
  created_at: string; // ISO datetime
}

/** An active or recent incident */
export interface Incident {
  id: string;
  name: string;
  status: string; // "investigating" | "identified" | "watching" | "resolved"
  started_at: string; // ISO datetime
  resolved_at?: string; // ISO datetime, undefined if ongoing
  components: string[]; // component IDs affected
  updates: IncidentUpdate[];
}

/** A scheduled or in-progress maintenance window */
export interface MaintenanceWindow {
  id: string;
  name: string;
  status: string; // "scheduled" | "in_progress" | "completed"
  starts_at: string; // ISO datetime
  ends_at: string; // ISO datetime
  updates?: IncidentUpdate[];
}

/** The complete status snapshot stored in S3 */
export interface StatusSnapshot {
  generated_at: string; // ISO datetime
  configured: boolean;
  overall_status: string; // "operational" | "degraded" | "outage" | "maintenance" | "unknown"
  component_groups: ComponentGroup[];
  incidents: Incident[];
  maintenance_windows: MaintenanceWindow[];
}

/** Duration options for the time selector */
export type DurationDays = 30 | 60 | 90;
