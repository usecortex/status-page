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
 *   HEALTH_CHECK_ENDPOINTS='{"hybrid-search":"https://api.hydradb.com/v1/search/health",...}'
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
 * 2. Hardcoded defaults below (placeholder URLs -- update these)
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

  // Placeholder endpoints -- replace with real URLs or set HEALTH_CHECK_ENDPOINTS env var
  return [
    // { componentId: "hybrid-search", name: "Hybrid Search", url: "https://api.hydradb.com/v1/search/health" },
    // { componentId: "full-text-search", name: "Full-Text Search", url: "https://api.hydradb.com/v1/fts/health" },
    // { componentId: "document-upload", name: "Document Upload", url: "https://api.hydradb.com/v1/upload/health" },
    // { componentId: "content-processing", name: "Content Processing", url: "https://api.hydradb.com/v1/processing/health" },
    // { componentId: "memory-api", name: "Memory API", url: "https://api.hydradb.com/v1/memory/health" },
    // { componentId: "dashboard", name: "Dashboard", url: "https://app.hydradb.com" },
    // { componentId: "docs-site", name: "Docs Site", url: "https://docs.hydradb.com" },
    // { componentId: "website", name: "Website", url: "https://hydradb.com" },
  ];
}

export function getTimeout(endpoint: HealthEndpoint): number {
  return endpoint.timeoutMs ?? DEFAULT_TIMEOUT_MS;
}

export function getFailureThreshold(endpoint: HealthEndpoint): number {
  return endpoint.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
}
