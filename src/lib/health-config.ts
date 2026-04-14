/**
 * Health check endpoint configuration.
 *
 * Each entry maps a component ID (matching DEFAULT_COMPONENTS in defaults.ts)
 * to the URL that should be pinged. A component is considered healthy when the
 * endpoint returns a 2xx status within the timeout.
 *
 * Set the HEALTH_CHECK_ENDPOINTS env var as a JSON string to override at
 * runtime without redeploying:
 *
 *   HEALTH_CHECK_ENDPOINTS='[{"componentId":"dashboard","name":"Dashboard","url":"https://app.hydradb.com"}]'
 */

export interface HealthEndpoint {
  /** Component ID from defaults.ts */
  componentId: string;
  /** Display name (used in incident titles) */
  name: string;
  /** URL to ping */
  url: string;
  /** Request timeout in ms (default: 10000) */
  timeoutMs?: number;
  /** Number of consecutive failures before creating an incident (default: 2) */
  failureThreshold?: number;
  /** HTTP method (default: GET) */
  method?: string;
  /** Expected status codes (default: any 2xx) */
  expectedStatus?: number[];
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_FAILURE_THRESHOLD = 2;

/**
 * Returns the configured health check endpoints.
 *
 * Priority:
 * 1. HEALTH_CHECK_ENDPOINTS env var (JSON string)
 * 2. Hardcoded defaults below
 *
 * Health check strategy:
 * - Most API endpoints (POST) require auth + request bodies, so we can't
 *   ping them directly. Instead we check the base API URL and the GET
 *   endpoints that don't require a body.
 * - Dashboard (app.hydradb.com) is checked with a simple GET.
 * - For granular per-endpoint monitoring, integrate with an external
 *   monitoring tool (Datadog, UptimeRobot) and feed results into incident.io.
 */
export function getHealthEndpoints(): HealthEndpoint[] {
  const envEndpoints = process.env.HEALTH_CHECK_ENDPOINTS;
  if (envEndpoints) {
    try {
      const parsed = JSON.parse(envEndpoints);
      if (Array.isArray(parsed)) return parsed;
      // Support simple { componentId: url } format
      if (typeof parsed === "object") {
        return Object.entries(parsed).map(([componentId, url]) => ({
          componentId,
          name: componentId
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" "),
          url: url as string,
        }));
      }
    } catch {
      console.error("[health-check] Failed to parse HEALTH_CHECK_ENDPOINTS env var");
    }
  }

  // Default health check endpoints
  // The API base URL check covers all API components.
  // GET endpoints can be pinged directly (they return 401/403 without auth, but prove the server is up).
  return [
    { componentId: "monitor-infra-status", name: "Monitor & Infra Status", url: "https://api.hydradb.com/tenants/monitor", expectedStatus: [200, 401, 403, 422] },
    { componentId: "list-sub-tenant-ids", name: "List Sub-Tenant IDs", url: "https://api.hydradb.com/tenants/sub_tenant_ids", expectedStatus: [200, 401, 403, 422] },
    { componentId: "dashboard", name: "Dashboard", url: "https://app.hydradb.com" },
  ];
}

export function getTimeout(endpoint: HealthEndpoint): number {
  return endpoint.timeoutMs ?? DEFAULT_TIMEOUT_MS;
}

export function getFailureThreshold(endpoint: HealthEndpoint): number {
  return endpoint.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
}
