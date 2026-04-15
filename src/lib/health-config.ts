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
  /**
   * Infrastructure services this component depends on.
   * When the health endpoint returns per-service checks (e.g. `{ checks: { falkordb: true, mongodb: false } }`),
   * a component is healthy only if ALL of its required services are healthy.
   * If not set, falls back to HTTP status code check.
   */
  requiredServices?: string[];
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
  // The API health endpoint returns per-service checks in its JSON body:
  //   { "status": "ok"|"degraded"|"down", "checks": { "milvus": true, "falkordb": false, ... } }
  //
  // Each component declares which infrastructure services it depends on via
  // requiredServices. A component is healthy only when ALL of its required
  // services are healthy. This gives per-component granularity instead of
  // marking all 20 API components unhealthy when a single service is down.
  const API_HEALTH = "https://api.hydradb.com/health";
  const INGESTION_HEALTH = "https://ingestion.usecortex.ai/health";
  const DASHBOARD_URL = "https://app.hydradb.com";

  /**
   * Maps component ID → { url, requiredServices }.
   * Components not listed default to API_HEALTH with all core services required.
   *
   * Service names match the keys in the /health JSON response:
   *   milvus, falkordb, mongodb, dynamodb, s3
   */
  const CORE_SERVICES = ["mongodb", "dynamodb", "s3"];

  const componentConfig: Record<string, { url: string; requiredServices?: string[] }> = {
    // Tenants — need DB + API keys (MongoDB, DynamoDB)
    "create-tenant":       { url: API_HEALTH, requiredServices: [...CORE_SERVICES] },
    "monitor-infra-status": { url: API_HEALTH, requiredServices: [...CORE_SERVICES] },
    "list-sub-tenant-ids": { url: API_HEALTH, requiredServices: [...CORE_SERVICES] },
    "delete-tenant":       { url: API_HEALTH, requiredServices: [...CORE_SERVICES] },
    // Memories — need vector store + graph + DB
    "user-memory":         { url: API_HEALTH, requiredServices: [...CORE_SERVICES, "milvus"] },
    "knowledge-base":      { url: API_HEALTH, requiredServices: [...CORE_SERVICES, "milvus", "falkordb"] },
    "shared-hive-memory":  { url: API_HEALTH, requiredServices: [...CORE_SERVICES, "milvus"] },
    // Recall — need vector store + graph
    "full-recall":         { url: API_HEALTH, requiredServices: [...CORE_SERVICES, "milvus", "falkordb"] },
    "memory-recall":       { url: API_HEALTH, requiredServices: [...CORE_SERVICES, "milvus"] },
    "lexical-recall":      { url: API_HEALTH, requiredServices: [...CORE_SERVICES, "milvus"] },
    // Ingestion — separate service
    "verify-processing":   { url: INGESTION_HEALTH },
    // Manage Memories
    "list-data":           { url: API_HEALTH, requiredServices: [...CORE_SERVICES] },
    "fetch-content":       { url: API_HEALTH, requiredServices: [...CORE_SERVICES] },
    "graph-relations":     { url: API_HEALTH, requiredServices: [...CORE_SERVICES, "falkordb"] },
    "delete-user-memory":  { url: API_HEALTH, requiredServices: [...CORE_SERVICES, "milvus"] },
    "delete-knowledge":    { url: API_HEALTH, requiredServices: [...CORE_SERVICES, "milvus", "falkordb"] },
    // Custom Embeddings — need vector store
    "add-embeddings":      { url: API_HEALTH, requiredServices: [...CORE_SERVICES, "milvus"] },
    "search-embeddings":   { url: API_HEALTH, requiredServices: [...CORE_SERVICES, "milvus"] },
    "filter-raw-embeddings": { url: API_HEALTH, requiredServices: [...CORE_SERVICES, "milvus"] },
    "delete-embeddings":   { url: API_HEALTH, requiredServices: [...CORE_SERVICES, "milvus"] },
    // Dashboard — separate app
    dashboard:             { url: DASHBOARD_URL },
  };

  return DEFAULT_COMPONENTS.map((c) => {
    const config = componentConfig[c.id];
    return {
      componentId: c.id,
      name: c.name,
      url: config?.url ?? API_HEALTH,
      requiredServices: config?.requiredServices,
    };
  });
}

export function getTimeout(endpoint: HealthEndpoint): number {
  return endpoint.timeoutMs ?? DEFAULT_TIMEOUT_MS;
}

export function getFailureThreshold(endpoint: HealthEndpoint): number {
  return endpoint.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
}
