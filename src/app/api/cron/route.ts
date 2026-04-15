import { NextResponse } from "next/server";
import { readStatusData, writeStatusData } from "@/lib/s3";
import {
  fetchWidgetData,
  normalizeWidgetResponse,
  mapComponentStatuses,
  normalizeName,
} from "@/lib/incident-io";
import {
  computeDailyUptime,
  computeUptimeMetrics,
  mergeHistoricalData,
  deriveOverallStatus,
} from "@/lib/uptime";
import { DEFAULT_COMPONENT_GROUPS, DEFAULT_COMPONENTS } from "@/lib/defaults";
import type { StatusSnapshot } from "@/types/status";
import type { DailyUptime, UptimeMetrics } from "@/types/status";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // 1. Verify authorization (Vercel sets this header for cron jobs)
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
    }
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Check if incident.io is configured
    const widgetUrl = process.env.INCIDENT_IO_WIDGET_URL;

    // 3. Read existing status data from S3 (null on first run)
    const existing = await readStatusData();

    // 4. If incident.io is configured, fetch fresh data
    if (widgetUrl) {
      const raw = await fetchWidgetData(widgetUrl);
      if (raw) {
        const normalized = normalizeWidgetResponse(raw);
        const componentNameMap = new Map(
          DEFAULT_COMPONENTS.map((c) => [c.id, c.name] as [string, string]),
        );
        const componentStatuses = mapComponentStatuses(
          raw.components || [],
          DEFAULT_COMPONENTS.map((c) => c.id),
          componentNameMap,
        );

        // Build reverse lookup: incident.io widget component ID -> our internal ID.
        // This allows us to remap incident component IDs to our internal IDs so
        // that computeDailyUptime can correctly match incidents to components.
        const reverseComponentMap = new Map<string, string>();
        if (Array.isArray(raw.components)) {
          // Build lookup from internal IDs: both raw and normalized forms
          const internalLookup = new Map<string, string>();
          for (const [internalId] of componentStatuses.entries()) {
            internalLookup.set(internalId.toLowerCase(), internalId);
            // Also index the space-separated form for normalizeName matching
            internalLookup.set(internalId.replace(/-/g, " ").toLowerCase(), internalId);
          }

          for (const comp of raw.components) {
            const widgetId = comp?.id ?? "";
            // Normalize: strip & / punctuation, collapse whitespace, then
            // try both space-separated and hyphenated forms
            const normalizedCompName = normalizeName(comp?.name ?? "");
            const hyphenated = normalizedCompName.replace(/\s+/g, "-");

            const match =
              internalLookup.get(normalizedCompName) ??
              internalLookup.get(hyphenated) ??
              internalLookup.get(widgetId.toLowerCase());

            if (match) {
              reverseComponentMap.set(widgetId, match);
            }
          }
        }

        // Remap incident component IDs to our internal IDs
        const remappedIncidents = normalized.incidents.map(inc => ({
          ...inc,
          components: inc.components.map(c => reverseComponentMap.get(c) ?? c),
        }));

        // Override component statuses based on active incidents.
        // If an incident is "investigating" or "identified" and affects a
        // component, that component should show as "outage". If "degraded",
        // it should show as "degraded".
        for (const inc of remappedIncidents) {
          if (!inc.components || inc.components.length === 0) continue;
          const incStatus = inc.status === "investigating" || inc.status === "identified"
            ? "outage"
            : inc.status === "degraded" ? "degraded" : null;
          if (incStatus) {
            for (const compId of inc.components) {
              const current = componentStatuses.get(compId);
              // Only override if the incident status is worse
              if (!current || current === "operational" || (current === "degraded" && incStatus === "outage")) {
                componentStatuses.set(compId, incStatus);
              }
            }
          }
        }

        // 5. Build updated component groups
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

        // Migration: always use DEFAULT_COMPONENT_GROUPS as the structural
        // source of truth (which components exist and how they're grouped).
        // Preserve historical uptime data for components that carry over from
        // a previous snapshot by building a lookup from the existing data.
        const existingComponentMap = new Map<
          string,
          { daily_history: DailyUptime[]; uptime: UptimeMetrics; status: string }
        >();
        if (existing?.component_groups) {
          for (const group of existing.component_groups) {
            for (const comp of group.components) {
              existingComponentMap.set(comp.id, comp);
            }
          }
        }
        const baseGroups = DEFAULT_COMPONENT_GROUPS.map((group) => ({
          ...group,
          components: group.components.map((comp) => {
            const prev = existingComponentMap.get(comp.id);
            return prev ? { ...comp, daily_history: prev.daily_history, uptime: prev.uptime, status: prev.status } : comp;
          }),
        }));

        const updatedGroups = baseGroups.map((group) => ({
          ...group,
          components: group.components.map((comp) => {
            // Update current status from incident.io
            const liveStatus = componentStatuses.get(comp.id) || comp.status;

            // Compute today's uptime from active incidents
            const todayUptime = computeDailyUptime(
              remappedIncidents,
              comp.id,
              today,
            );

            // Merge into historical data
            const updatedHistory = mergeHistoricalData(
              existing ? comp.daily_history : [],
              [todayUptime],
            );

            // Compute rolling metrics
            const uptime = computeUptimeMetrics(updatedHistory);

            return {
              ...comp,
              status: liveStatus,
              uptime,
              daily_history: updatedHistory,
            };
          }),
        }));

        // 6. Build the snapshot
        const snapshot: StatusSnapshot = {
          generated_at: new Date().toISOString(),
          configured: true,
          overall_status: deriveOverallStatus(
            updatedGroups,
            remappedIncidents,
          ),
          component_groups: updatedGroups,
          incidents: remappedIncidents,
          maintenance_windows: normalized.maintenance_windows,
        };

        // 7. Write to S3
        await writeStatusData(snapshot);

        return NextResponse.json({
          ok: true,
          configured: true,
          components_updated: updatedGroups.flatMap((g) => g.components).length,
          incidents: remappedIncidents.length,
          maintenance: normalized.maintenance_windows.length,
        });
      }

      // incident.io fetch failed -- keep existing data unchanged
      console.error(
        "Failed to fetch incident.io Widget API, keeping existing data",
      );
      return NextResponse.json({
        ok: true,
        configured: true,
        skipped: true,
        reason: "widget_api_unreachable",
      });
    }

    // 8. Not configured -- write default data if no existing data
    if (!existing) {
      const snapshot: StatusSnapshot = {
        generated_at: new Date().toISOString(),
        configured: false,
        overall_status: "operational",
        component_groups: DEFAULT_COMPONENT_GROUPS,
        incidents: [],
        maintenance_windows: [],
      };
      await writeStatusData(snapshot);
    }

    return NextResponse.json({ ok: true, configured: false });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown error occurred";
    console.error("[cron] Unhandled error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
