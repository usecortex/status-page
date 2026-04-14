import { NextResponse } from "next/server";
import { getHealthEndpoints, getFailureThreshold } from "@/lib/health-config";
import { runHealthChecks } from "@/lib/health-check";
import type { HealthCheckResult } from "@/lib/health-check";
import {
  readHealthState,
  writeHealthState,
  getComponentState,
} from "@/lib/health-state";
import type { HealthState } from "@/lib/health-state";
import {
  createIncident,
  resolveIncident,
  findSeverityId,
} from "@/lib/incident-io-api";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // 1. Auth
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json(
        { error: "CRON_SECRET not configured" },
        { status: 500 },
      );
    }
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Get endpoints
    const endpoints = getHealthEndpoints();
    if (endpoints.length === 0) {
      return NextResponse.json({
        ok: true,
        configured: false,
        message: "No health check endpoints configured",
      });
    }

    // 3. Run health checks
    const results = await runHealthChecks(endpoints);

    // 4. Load persisted state
    const existingState = await readHealthState();
    const now = new Date().toISOString();

    const hasApiKey = !!process.env.INCIDENT_IO_API_KEY;
    let severityId: string | null = null;

    // Lazy-load severity ID only if we need to create an incident
    const getSeverity = async (): Promise<string | null> => {
      if (severityId) return severityId;
      severityId = await findSeverityId("Minor");
      return severityId;
    };

    // 5. Process each result
    const newState: HealthState = {
      components: { ...existingState?.components },
      updatedAt: now,
    };

    const incidentsCreated: string[] = [];
    const incidentsResolved: string[] = [];

    for (const result of results) {
      const endpoint = endpoints.find(
        (e) => e.componentId === result.componentId,
      )!;
      const prevState = getComponentState(existingState, result.componentId);
      const threshold = getFailureThreshold(endpoint);

      if (result.healthy) {
        // Component is healthy
        if (prevState.activeIncidentId && hasApiKey) {
          // Resolve the open incident
          const resolved = await resolveIncident(prevState.activeIncidentId);
          if (resolved) {
            incidentsResolved.push(result.componentId);
            console.log(
              `[health-check] Resolved incident ${prevState.activeIncidentId} for ${result.name}`,
            );
          }
        }

        newState.components[result.componentId] = {
          consecutiveFailures: 0,
          activeIncidentId: null,
          incidentCreatedAt: null,
          lastCheckedAt: now,
          lastHealthy: true,
        };
      } else {
        // Component is unhealthy
        const failures = prevState.consecutiveFailures + 1;

        if (
          failures >= threshold &&
          !prevState.activeIncidentId &&
          hasApiKey
        ) {
          // Threshold reached, create incident
          const sevId = await getSeverity();
          if (sevId) {
            const incident = await createIncident({
              name: `${result.name} is experiencing issues`,
              summary: buildIncidentSummary(result),
              severityId: sevId,
              idempotencyKey: `health-check-${result.componentId}-${today()}`,
            });

            if (incident) {
              incidentsCreated.push(result.componentId);
              console.log(
                `[health-check] Created incident ${incident.id} for ${result.name}`,
              );
              newState.components[result.componentId] = {
                consecutiveFailures: failures,
                activeIncidentId: incident.id,
                incidentCreatedAt: now,
                lastCheckedAt: now,
                lastHealthy: false,
              };
              continue;
            }
          }
        }

        newState.components[result.componentId] = {
          consecutiveFailures: failures,
          activeIncidentId: prevState.activeIncidentId,
          incidentCreatedAt: prevState.incidentCreatedAt,
          lastCheckedAt: now,
          lastHealthy: false,
        };
      }
    }

    // 6. Persist state
    await writeHealthState(newState);

    return NextResponse.json({
      ok: true,
      configured: true,
      checked: results.length,
      healthy: results.filter((r) => r.healthy).length,
      unhealthy: results.filter((r) => !r.healthy).length,
      incidents_created: incidentsCreated,
      incidents_resolved: incidentsResolved,
      results: results.map((r) => ({
        component: r.componentId,
        healthy: r.healthy,
        statusCode: r.statusCode,
        latencyMs: r.latencyMs,
        error: r.error,
      })),
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown error occurred";
    console.error("[health-check] Unhandled error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function buildIncidentSummary(result: HealthCheckResult): string {
  if (result.statusCode) {
    return `Automated health check detected ${result.name} returning HTTP ${result.statusCode} (expected 2xx). Endpoint: ${result.url}`;
  }
  return `Automated health check detected ${result.name} is unreachable: ${result.error}. Endpoint: ${result.url}`;
}
