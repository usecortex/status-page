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

import { DEFAULT_COMPONENTS } from "./defaults";

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
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
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

  // Default health check endpoints — derived from DEFAULT_COMPONENTS.
  //
  // Three distinct URLs are pinged:
  //   1. https://api.hydradb.com/health   — cortex-application (covers most API components)
  //   2. https://ingestion.usecortex.ai/health — cortex-ingestion (covers Ingestion group)
  //   3. https://app.hydradb.com           — Dashboard
  //
  // Multiple components share the same URL. runHealthChecks() deduplicates
  // the actual HTTP calls so each URL is only fetched once.
  const API_HEALTH = "https://api.hydradb.com/health";
  const INGESTION_HEALTH = "https://ingestion.usecortex.ai/health";
  const DASHBOARD_URL = "https://app.hydradb.com";

  /** Maps component ID → health check URL. Components not listed default to API_HEALTH. */
  const urlByComponentId: Record<string, string> = {
    "verify-processing": INGESTION_HEALTH,
    dashboard: DASHBOARD_URL,
  };

  return DEFAULT_COMPONENTS.map((c) => ({
    componentId: c.id,
    name: c.name,
    url: urlByComponentId[c.id] ?? API_HEALTH,
  }));
}

export function getTimeout(endpoint: HealthEndpoint): number {
  return endpoint.timeoutMs ?? DEFAULT_TIMEOUT_MS;
}

export function getFailureThreshold(endpoint: HealthEndpoint): number {
  return endpoint.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
}
