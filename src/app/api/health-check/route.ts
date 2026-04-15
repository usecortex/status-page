import { NextResponse } from "next/server";
import { getHealthEndpoints, getFailureThreshold } from "@/lib/health-config";
import type { HealthEndpoint } from "@/lib/health-config";
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

    // Lazy-load severity ID only if we need to create an incident.
    // Not cached on failure — will retry on next unhealthy component.
    const getSeverity = async (): Promise<string | null> => {
      if (severityId) return severityId;
      severityId = await findSeverityId("Minor");
      return severityId;
    };

    // 5. Process each result.
    //
    // Multiple components can share the same URL (e.g. 20 API components all
    // point to api.hydradb.com/health).  When a shared URL goes down we create
    // ONE incident for the URL and assign that incident ID to every component
    // that maps to it.  This prevents an incident flood in incident.io.
    const newState: HealthState = {
      components: { ...existingState?.components },
      updatedAt: now,
    };

    const incidentsCreated: string[] = [];
    const incidentsResolved: string[] = [];

    // Track incidents already created/resolved per URL in this cycle so we
    // don't duplicate API calls for components sharing the same endpoint.
    const urlIncidentCache = new Map<
      string,
      { id: string; createdAt: string } | null
    >();
    const urlResolveCache = new Map<string, boolean>();

    for (const result of results) {
      const endpoint = endpoints.find(
        (e) => e.componentId === result.componentId,
      );
      if (!endpoint) continue;
      const prevState = getComponentState(existingState, result.componentId);
      const threshold = getFailureThreshold(endpoint);

      if (result.healthy) {
        // Component is healthy
        let incidentCleared = true;
        if (prevState.activeIncidentId && hasApiKey) {
          // Check if we already tried to resolve this incident (shared URL)
          const cacheKey = prevState.activeIncidentId;
          let resolved: boolean;
          if (urlResolveCache.has(cacheKey)) {
            resolved = urlResolveCache.get(cacheKey)!;
          } else {
            resolved = await resolveIncident(prevState.activeIncidentId);
            urlResolveCache.set(cacheKey, resolved);
          }

          if (resolved) {
            incidentsResolved.push(result.componentId);
            console.log(
              `[health-check] Resolved incident ${prevState.activeIncidentId} for ${result.name}`,
            );
          } else {
            // Resolution failed — keep incident reference so we retry next cycle
            incidentCleared = false;
            console.warn(
              `[health-check] Failed to resolve incident ${prevState.activeIncidentId} for ${result.name}, will retry`,
            );
          }
        }

        newState.components[result.componentId] = {
          consecutiveFailures: 0,
          activeIncidentId: incidentCleared ? null : prevState.activeIncidentId,
          incidentCreatedAt: incidentCleared ? null : prevState.incidentCreatedAt,
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
          // Threshold reached — create one incident per URL, shared across
          // all components that map to the same endpoint.
          const urlKey = `${endpoint.method ?? "GET"}|${endpoint.url}`;

          if (!urlIncidentCache.has(urlKey)) {
            // First component hitting threshold for this URL — create incident
            const sevId = await getSeverity();
            if (sevId) {
              const affectedNames = results
                .filter((r) => r.url === endpoint.url && !r.healthy)
                .map((r) => r.name);
              const incidentName =
                affectedNames.length > 1
                  ? `${endpoint.url} is experiencing issues (${affectedNames.length} components affected)`
                  : `${result.name} is experiencing issues`;

              const incident = await createIncident({
                name: incidentName,
                summary: buildIncidentSummary(result, endpoint, affectedNames),
                severityId: sevId,
                idempotencyKey: `health-check-${urlKey}-${nowHour()}`,
              });

              urlIncidentCache.set(
                urlKey,
                incident ? { id: incident.id, createdAt: now } : null,
              );

              if (incident) {
                console.log(
                  `[health-check] Created incident ${incident.id} for ${endpoint.url} (${affectedNames.length} components)`,
                );
              }
            } else {
              urlIncidentCache.set(urlKey, null);
            }
          }

          const cached = urlIncidentCache.get(urlKey);
          if (cached) {
            incidentsCreated.push(result.componentId);
            newState.components[result.componentId] = {
              consecutiveFailures: failures,
              activeIncidentId: cached.id,
              incidentCreatedAt: cached.createdAt,
              lastCheckedAt: now,
              lastHealthy: false,
            };
            continue;
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

/** Hour-granularity timestamp for idempotency keys (e.g. "2025-01-15T14").
 *  Prevents dedup if the same component fails, recovers, and fails again
 *  in a different hour on the same day. */
function nowHour(): string {
  const iso = new Date().toISOString();
  return iso.slice(0, 13); // "2025-01-15T14"
}

function buildIncidentSummary(
  result: HealthCheckResult,
  endpoint: HealthEndpoint,
  affectedNames?: string[],
): string {
  const affected =
    affectedNames && affectedNames.length > 1
      ? `Affected components: ${affectedNames.join(", ")}. `
      : "";

  if (result.statusCode !== null) {
    const expected = endpoint.expectedStatus
      ? `expected ${endpoint.expectedStatus.join("/")}`
      : "expected 2xx";
    return `Automated health check detected ${result.name} returning HTTP ${result.statusCode} (${expected}). ${affected}Endpoint: ${result.url}`;
  }
  return `Automated health check detected ${result.name} is unreachable: ${result.error}. ${affected}Endpoint: ${result.url}`;
}
