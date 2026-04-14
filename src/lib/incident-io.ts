import type { Incident, IncidentUpdate, MaintenanceWindow } from "@/types/status";

// ---------------------------------------------------------------------------
// Internal types for the incident.io Widget API response
// ---------------------------------------------------------------------------

interface WidgetResponse {
  ongoing_incidents?: any[];
  incidents?: any[];
  in_progress_maintenances?: any[];
  scheduled_maintenances?: any[];
  maintenance_windows?: any[];
  components?: any[];
  component_groups?: any[];
}

export interface NormalizedWidgetData {
  incidents: Incident[];
  maintenance_windows: MaintenanceWindow[];
}

// ---------------------------------------------------------------------------
// Status normalization map
// Maps incident.io component status strings to our status vocabulary.
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, string> = {
  operational: "operational",
  degraded_performance: "degraded",
  partial_outage: "outage",
  full_outage: "outage",
  under_maintenance: "maintenance",
};

/**
 * Normalize an incident.io component status string to our vocabulary.
 * Falls back to "operational" for unrecognised values.
 */
function normalizeStatus(raw: string | undefined | null): string {
  if (!raw) return "operational";
  const key = raw.toLowerCase().trim();
  return STATUS_MAP[key] ?? "operational";
}

// ---------------------------------------------------------------------------
// fetchWidgetData
// ---------------------------------------------------------------------------

/**
 * Fetches the incident.io Widget API JSON from the given URL.
 * Returns `null` on any error (network failure, non-200 status, JSON parse error).
 */
export async function fetchWidgetData(url: string): Promise<WidgetResponse | null> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.error(
        `[incident-io] Widget API returned non-200 status: ${response.status} ${response.statusText}`,
      );
      return null;
    }

    const data: WidgetResponse = await response.json();
    return data;
  } catch (err: unknown) {
    console.error("[incident-io] Failed to fetch widget data:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// normalizeWidgetResponse
// ---------------------------------------------------------------------------

/**
 * Extracts an array of {@link IncidentUpdate} entries from a raw incident or
 * maintenance object. The Widget API may provide updates as:
 *   - `updates` (array)
 *   - `last_update` (single object or string)
 */
function extractUpdates(raw: any): IncidentUpdate[] {
  if (!raw) return [];

  // If an `updates` array is present, map it.
  if (Array.isArray(raw.updates) && raw.updates.length > 0) {
    return raw.updates.map((u: any) => ({
      body: u.body ?? u.message ?? "",
      created_at: u.created_at ?? u.updated_at ?? "",
    }));
  }

  // Fall back to `last_update` (may be an object with body/created_at).
  if (raw.last_update) {
    const lu = raw.last_update;
    if (typeof lu === "string") {
      return [{ body: lu, created_at: raw.updated_at ?? raw.created_at ?? "" }];
    }
    if (typeof lu === "object") {
      return [
        {
          body: lu.body ?? lu.message ?? "",
          created_at: lu.created_at ?? lu.updated_at ?? "",
        },
      ];
    }
  }

  return [];
}

/**
 * Extracts component IDs/names from a raw incident's `affected_components` array.
 * Falls back to an empty array when the field is missing.
 *
 * Handles multiple incident.io payload shapes:
 *   - `component_id` (primary key in incident.io REST payloads)
 *   - `id` (Widget API payloads)
 *   - `name` (fallback)
 */
function extractComponents(raw: any): string[] {
  const affected = raw?.affected_components;
  if (!Array.isArray(affected)) return [];

  return affected.map((c: any) => {
    if (typeof c === "string") return c;
    return c?.component_id ?? c?.id ?? c?.name ?? String(c);
  });
}

/**
 * Normalises a single raw incident object into our {@link Incident} type.
 */
function normalizeIncident(raw: any): Incident {
  return {
    id: raw.id ?? "",
    name: raw.name ?? raw.title ?? "",
    status: raw.status ?? "investigating",
    started_at: raw.started_at ?? raw.created_at ?? "",
    resolved_at: raw.resolved_at ?? undefined,
    components: extractComponents(raw),
    updates: extractUpdates(raw),
  };
}

/**
 * Normalises a single raw maintenance object into our {@link MaintenanceWindow} type.
 */
function normalizeMaintenance(raw: any): MaintenanceWindow {
  return {
    id: raw.id ?? "",
    name: raw.name ?? raw.title ?? "",
    status: raw.status ?? "scheduled",
    starts_at: raw.starts_at ?? raw.scheduled_start ?? "",
    ends_at: raw.ends_at ?? raw.scheduled_end ?? "",
    updates: extractUpdates(raw),
  };
}

/**
 * Normalises the raw Widget API response into our internal format.
 *
 * - Incidents are sourced from `ongoing_incidents` (primary) or `incidents` (fallback).
 * - Maintenance windows merge `in_progress_maintenances` and `scheduled_maintenances`,
 *   falling back to `maintenance_windows`. Duplicates (by `id`) are removed.
 *
 * Note: Component statuses are handled separately by `mapComponentStatuses()` in the
 * cron route, which provides better fuzzy name matching against our internal IDs.
 */
export function normalizeWidgetResponse(raw: any): NormalizedWidgetData {
  if (!raw || typeof raw !== "object") {
    return { incidents: [], maintenance_windows: [] };
  }

  // --- Incidents -----------------------------------------------------------
  const rawIncidents: any[] =
    Array.isArray(raw.ongoing_incidents) && raw.ongoing_incidents.length > 0
      ? raw.ongoing_incidents
      : Array.isArray(raw.incidents)
        ? raw.incidents
        : [];

  const incidents: Incident[] = rawIncidents.map(normalizeIncident);

  // --- Maintenance windows -------------------------------------------------
  let rawMaintenances: any[] = [];

  const hasSpecific =
    Array.isArray(raw.in_progress_maintenances) || Array.isArray(raw.scheduled_maintenances);

  if (hasSpecific) {
    rawMaintenances = [
      ...(Array.isArray(raw.in_progress_maintenances) ? raw.in_progress_maintenances : []),
      ...(Array.isArray(raw.scheduled_maintenances) ? raw.scheduled_maintenances : []),
    ];
  } else if (Array.isArray(raw.maintenance_windows)) {
    rawMaintenances = raw.maintenance_windows;
  }

  // Deduplicate by id
  const seenIds = new Set<string>();
  const uniqueMaintenances: any[] = [];
  for (const m of rawMaintenances) {
    const id = m?.id ?? "";
    if (id && seenIds.has(id)) continue;
    if (id) seenIds.add(id);
    uniqueMaintenances.push(m);
  }

  const maintenance_windows: MaintenanceWindow[] = uniqueMaintenances.map(normalizeMaintenance);

  return { incidents, maintenance_windows };
}

// ---------------------------------------------------------------------------
// mapComponentStatuses
// ---------------------------------------------------------------------------

/**
 * Maps incident.io widget component data to our component IDs with normalised
 * statuses.
 *
 * Matching is performed case-insensitively: if a widget component's `name`
 * matches one of the names derived from `defaultGroupIds` (treating the ID as
 * a kebab-case name), we include it. Only exact matches are used (no loose
 * substring matching) to avoid incorrect mappings.
 *
 * @param widgetComponents - The `components` array from the Widget API response.
 * @param defaultGroupIds  - Our internal component IDs (e.g. from defaults.ts).
 * @returns A `Map<componentId, status>` with statuses in our vocabulary.
 */
export function mapComponentStatuses(
  widgetComponents: any[],
  defaultGroupIds: string[],
): Map<string, string> {
  const result = new Map<string, string>();

  if (!Array.isArray(widgetComponents) || !Array.isArray(defaultGroupIds)) {
    return result;
  }

  // Build a lookup: lowercase name -> our component ID
  // We derive a display-style name from each ID by replacing hyphens with
  // spaces so "hybrid-search" becomes "hybrid search".
  const idLookup = new Map<string, string>();
  for (const id of defaultGroupIds) {
    const friendlyName = id.replace(/-/g, " ").toLowerCase();
    idLookup.set(friendlyName, id);
    // Also store the raw id (lowercased) so exact matches work.
    idLookup.set(id.toLowerCase(), id);
  }

  for (const comp of widgetComponents) {
    if (!comp) continue;

    const widgetName = (comp.name ?? comp.id ?? "").toLowerCase().trim();
    if (!widgetName) continue;

    // Direct match only — no loose substring matching.
    const matchedId = idLookup.get(widgetName);

    if (matchedId) {
      result.set(matchedId, normalizeStatus(comp.status));
    }
  }

  return result;
}
