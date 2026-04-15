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

  // Default health check endpoints.
  //
  // Three distinct URLs are pinged:
  //   1. https://api.hydradb.com/health   — cortex-application (covers 20 API components)
  //   2. https://ingestion.usecortex.ai/health — cortex-ingestion (covers Ingestion group)
  //   3. https://app.hydradb.com           — Dashboard
  //
  // Multiple components share the same URL. runHealthChecks() deduplicates
  // the actual HTTP calls so each URL is only fetched once.
  const API_HEALTH = "https://api.hydradb.com/health";
  const INGESTION_HEALTH = "https://ingestion.usecortex.ai/health";

  return [
    // Tenants (4) — cortex-application
    { componentId: "create-tenant", name: "Create Tenant", url: API_HEALTH },
    { componentId: "monitor-infra-status", name: "Monitor & Infra Status", url: API_HEALTH },
    { componentId: "list-sub-tenant-ids", name: "List Sub-Tenant IDs", url: API_HEALTH },
    { componentId: "delete-tenant", name: "Delete Tenant", url: API_HEALTH },
    // Memories (3) — cortex-application
    { componentId: "user-memory", name: "User Memory", url: API_HEALTH },
    { componentId: "knowledge-base", name: "Knowledge Base", url: API_HEALTH },
    { componentId: "shared-hive-memory", name: "Shared / Hive Memory", url: API_HEALTH },
    // Recall (3) — cortex-application
    { componentId: "full-recall", name: "Full Recall", url: API_HEALTH },
    { componentId: "memory-recall", name: "Memory Recall", url: API_HEALTH },
    { componentId: "lexical-recall", name: "Lexical Recall", url: API_HEALTH },
    // Ingestion (1) — cortex-ingestion
    { componentId: "verify-processing", name: "Verify Processing", url: INGESTION_HEALTH },
    // Manage Memories (5) — cortex-application
    { componentId: "list-data", name: "List", url: API_HEALTH },
    { componentId: "fetch-content", name: "Fetch Content", url: API_HEALTH },
    { componentId: "graph-relations", name: "Graph Relations", url: API_HEALTH },
    { componentId: "delete-user-memory", name: "Delete User Memory", url: API_HEALTH },
    { componentId: "delete-knowledge", name: "Delete Knowledge", url: API_HEALTH },
    // Custom Embeddings (4) — cortex-application
    { componentId: "add-embeddings", name: "Add Embeddings", url: API_HEALTH },
    { componentId: "search-embeddings", name: "Search Embeddings", url: API_HEALTH },
    { componentId: "filter-raw-embeddings", name: "Filter Raw Embeddings", url: API_HEALTH },
    { componentId: "delete-embeddings", name: "Delete Embeddings", url: API_HEALTH },
    // Dashboard (1) — app.hydradb.com
    { componentId: "dashboard", name: "Dashboard", url: "https://app.hydradb.com" },
  ];
}

export function getTimeout(endpoint: HealthEndpoint): number {
  return endpoint.timeoutMs ?? DEFAULT_TIMEOUT_MS;
}

export function getFailureThreshold(endpoint: HealthEndpoint): number {
  return endpoint.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
}
