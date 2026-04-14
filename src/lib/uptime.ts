/**
 * Uptime Calculation Engine
 *
 * Pure functions for computing uptime percentages, merging historical data,
 * and deriving overall system status from component and incident information.
 */

import type {
  DailyUptime,
  UptimeMetrics,
  Incident,
} from "@/types/status";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Total minutes in a single day (24 * 60). */
const MINUTES_PER_DAY = 1440;

/** Statuses that count as "down" time for uptime calculations. */
const DOWN_STATUSES: ReadonlySet<string> = new Set([
  "full_outage",
  "partial_outage",
  "investigating",
  "identified",
  "outage",
]);

// ---------------------------------------------------------------------------
// 1. isDownStatus
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the given status string represents a "down" condition.
 *
 * Down statuses: "full_outage", "partial_outage", "investigating",
 *                "identified", "outage".
 *
 * Non-down statuses: "operational", "degraded_performance",
 *                    "under_maintenance", "degraded", "maintenance",
 *                    "watching".
 */
export function isDownStatus(status: string): boolean {
  return DOWN_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// 7. deriveDayStatus (helper – defined early so other functions can use it)
// ---------------------------------------------------------------------------

/**
 * Derives a human-readable status string from an uptime percentage.
 *
 * - < 95    → "outage"
 * - < 99.5  → "degraded"
 * - ≥ 99.5  → "operational"
 */
export function deriveDayStatus(uptime_pct: number): string {
  if (uptime_pct < 95) return "outage";
  if (uptime_pct < 99.5) return "degraded";
  return "operational";
}

// ---------------------------------------------------------------------------
// 2. computeDailyUptime
// ---------------------------------------------------------------------------

/**
 * Calculates uptime for a single component on a single calendar day.
 *
 * @param incidents  - The full list of incidents to consider.
 * @param componentId - The ID of the component being evaluated.
 * @param date       - The calendar day in "YYYY-MM-DD" format (UTC).
 * @returns A {@link DailyUptime} record for the given day.
 *
 * Algorithm:
 *  1. Filter incidents that affect this component (explicitly listed in
 *     `incident.components`, or the array is empty/undefined – meaning
 *     it affects all components).
 *  2. Only incidents with a "down" status count as downtime.
 *  3. For each matching incident compute the overlap (in minutes) between
 *     the incident's active window and the 24-hour window of `date` in UTC.
 *  4. Sum total down-minutes (capped at 1440).
 *  5. Derive uptime_pct and status.
 */
export function computeDailyUptime(
  incidents: Incident[],
  componentId: string,
  date: string,
): DailyUptime {
  // Build the UTC boundaries for the given day.
  const dayStart = new Date(`${date}T00:00:00Z`).getTime();
  const nextDay = new Date(`${date}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const dayEnd = nextDay.getTime();

  // Filter incidents relevant to this component that have a "down" status.
  // Unscoped incidents (no components array) only affect the overall status
  // banner, not individual component uptime calculations.
  const relevant = incidents.filter((inc) => {
    if (!inc.components || inc.components.length === 0) return false;
    if (!inc.components.includes(componentId)) return false;
    return isDownStatus(inc.status);
  });

  // Short-circuit: no relevant incidents → perfect day.
  if (relevant.length === 0) {
    return { date, status: "operational", uptime_pct: 100 };
  }

  // Accumulate total down-minutes.
  let totalDownMs = 0;

  for (const incident of relevant) {
    const incStart = new Date(incident.started_at).getTime();
    // If the incident is still unresolved, treat end-of-day as the boundary.
    const incEnd = incident.resolved_at
      ? new Date(incident.resolved_at).getTime()
      : dayEnd;

    // Calculate the overlap between [incStart, incEnd] and [dayStart, dayEnd].
    const overlapStart = Math.max(incStart, dayStart);
    const overlapEnd = Math.min(incEnd, dayEnd);

    if (overlapStart < overlapEnd) {
      totalDownMs += overlapEnd - overlapStart;
    }
  }

  // Convert milliseconds → minutes and cap at one full day.
  const downMinutes = Math.min(totalDownMs / 60_000, MINUTES_PER_DAY);

  // Compute percentage, rounded to two decimal places.
  const uptime_pct =
    Math.round(((MINUTES_PER_DAY - downMinutes) / MINUTES_PER_DAY) * 100 * 100) / 100;

  const status = deriveDayStatus(uptime_pct);

  return { date, status, uptime_pct };
}

// ---------------------------------------------------------------------------
// 3. computeRollingUptime
// ---------------------------------------------------------------------------

/**
 * Computes the aggregate uptime percentage over the last N days of history.
 *
 * @param dailyHistory - Ordered array of daily uptime records.
 * @param days         - Number of trailing days to include.
 * @returns The average uptime_pct, rounded to 2 decimal places.
 *          Returns 100 when no entries are available.
 */
export function computeRollingUptime(
  dailyHistory: DailyUptime[],
  days: number,
): number {
  if (dailyHistory.length === 0) return 100;

  // Take the last `days` entries (or all if fewer exist).
  const slice = dailyHistory.slice(-days);

  const sum = slice.reduce((acc, entry) => acc + entry.uptime_pct, 0);
  return Math.round((sum / slice.length) * 100) / 100;
}

// ---------------------------------------------------------------------------
// 4. computeUptimeMetrics
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper that computes the 30-day, 60-day, and 90-day rolling
 * uptime metrics from a daily history array.
 */
export function computeUptimeMetrics(
  dailyHistory: DailyUptime[],
): UptimeMetrics {
  return {
    "30d": computeRollingUptime(dailyHistory, 30),
    "60d": computeRollingUptime(dailyHistory, 60),
    "90d": computeRollingUptime(dailyHistory, 90),
  };
}

// ---------------------------------------------------------------------------
// 5. mergeHistoricalData
// ---------------------------------------------------------------------------

/**
 * Merges new daily uptime entries into an existing history array.
 *
 * - Entries with a matching date are replaced by the fresh value.
 * - New dates are appended.
 * - The result is sorted by date ascending.
 * - The array is trimmed to the most recent 90 entries.
 *
 * @param existing     - The current historical records.
 * @param freshEntries - Newly computed records to merge in.
 * @returns A new sorted and trimmed array.
 */
export function mergeHistoricalData(
  existing: DailyUptime[],
  freshEntries: DailyUptime[],
): DailyUptime[] {
  // Build a map keyed by date for O(1) lookups.
  const map = new Map<string, DailyUptime>();

  // Seed with existing entries.
  for (const entry of existing) {
    map.set(entry.date, entry);
  }

  // Overlay (or insert) fresh entries.
  for (const entry of freshEntries) {
    map.set(entry.date, entry);
  }

  // Sort ascending by date string (ISO date strings are lexicographically sortable).
  const merged = Array.from(map.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  // Keep only the most recent 90 entries.
  return merged.slice(-90);
}

// ---------------------------------------------------------------------------
// 6. deriveOverallStatus
// ---------------------------------------------------------------------------

/**
 * Derives the overall system status from component groups and active incidents.
 *
 * Priority (highest → lowest):
 *  1. Any incident with status "investigating" or "identified" → "outage"
 *  2. Any component with status "degraded" or "degraded_performance" → "degraded"
 *  3. Any component with status "maintenance" or "under_maintenance" → "maintenance"
 *  4. Otherwise → "operational"
 *
 * @param groups    - Component groups, each containing an array of components
 *                    with a `status` field.
 * @param incidents - Active or recent incidents with a `status` field.
 */
export function deriveOverallStatus(
  groups: { components: { status: string }[] }[],
  incidents: { status: string }[],
): string {
  // 1. Check incidents for active outage signals.
  for (const incident of incidents) {
    if (incident.status === "investigating" || incident.status === "identified") {
      return "outage";
    }
  }

  // Flatten all component statuses for subsequent checks.
  const componentStatuses: string[] = [];
  for (const group of groups) {
    for (const component of group.components) {
      componentStatuses.push(component.status);
    }
  }

  // 2. Check for degraded components.
  if (
    componentStatuses.some(
      (s) => s === "degraded" || s === "degraded_performance",
    )
  ) {
    return "degraded";
  }

  // 3. Check for maintenance components.
  if (
    componentStatuses.some(
      (s) => s === "maintenance" || s === "under_maintenance",
    )
  ) {
    return "maintenance";
  }

  // 4. All clear.
  return "operational";
}
