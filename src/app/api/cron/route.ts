import { NextResponse } from "next/server";
import { readStatusData, writeStatusData } from "@/lib/s3";
import {
  fetchWidgetData,
  normalizeWidgetResponse,
  mapComponentStatuses,
} from "@/lib/incident-io";
import {
  computeDailyUptime,
  computeUptimeMetrics,
  mergeHistoricalData,
  deriveOverallStatus,
} from "@/lib/uptime";
import { DEFAULT_COMPONENT_GROUPS, DEFAULT_COMPONENTS } from "@/lib/defaults";
import type { StatusSnapshot } from "@/types/status";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // 1. Verify authorization (Vercel sets this header for cron jobs)
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
        const componentStatuses = mapComponentStatuses(
          raw.components || [],
          DEFAULT_COMPONENTS.map((c) => c.id),
        );

        // 5. Build updated component groups
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
        const baseGroups =
          existing?.component_groups || DEFAULT_COMPONENT_GROUPS;

        const updatedGroups = baseGroups.map((group) => ({
          ...group,
          components: group.components.map((comp) => {
            // Update current status from incident.io
            const liveStatus = componentStatuses.get(comp.id) || comp.status;

            // Compute today's uptime from active incidents
            const todayUptime = computeDailyUptime(
              normalized.incidents,
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
            normalized.incidents,
          ),
          component_groups: updatedGroups,
          incidents: normalized.incidents,
          maintenance_windows: normalized.maintenance_windows,
        };

        // 7. Write to S3
        await writeStatusData(snapshot);

        return NextResponse.json({
          ok: true,
          configured: true,
          components_updated: updatedGroups.flatMap((g) => g.components).length,
          incidents: normalized.incidents.length,
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
