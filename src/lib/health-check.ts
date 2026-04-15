/**
 * Health check execution logic.
 *
 * Pings configured endpoints and returns per-component results.
 *
 * When the health endpoint returns a JSON body with per-service checks
 * (e.g. `{ "checks": { "falkordb": true, "mongodb": false } }`), each
 * component's health is determined by whether ALL of its required services
 * are healthy — not just the HTTP status code.  This gives per-component
 * granularity: if only FalkorDB is down, only FalkorDB-dependent components
 * (Knowledge Base, Graph Relations, Full Recall, etc.) are marked unhealthy.
 */

import {
  type HealthEndpoint,
  getTimeout,
} from "./health-config";

/** Unique key for deduplicating HTTP calls to the same method + URL. */
const endpointKey = (ep: HealthEndpoint): string =>
  `${ep.method ?? "GET"}|${ep.url}`;

export interface HealthCheckResult {
  componentId: string;
  name: string;
  url: string;
  healthy: boolean;
  statusCode: number | null;
  latencyMs: number;
  error?: string;
}

/** Raw response from a single HTTP call, including parsed service checks. */
interface RawEndpointResult {
  statusCode: number | null;
  latencyMs: number;
  healthy: boolean;
  error?: string;
  /** Per-service checks from the JSON body, e.g. { falkordb: true, mongodb: false }. */
  serviceChecks: Record<string, boolean> | null;
}

/**
 * Fetch a single endpoint and return the raw result including parsed service checks.
 */
export async function fetchEndpoint(
  endpoint: HealthEndpoint,
): Promise<RawEndpointResult> {
  const start = Date.now();
  const timeout = getTimeout(endpoint);
  const method = endpoint.method ?? "GET";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(endpoint.url, {
      method,
      signal: controller.signal,
      headers: { "User-Agent": "HydraDB-HealthCheck/1.0" },
      redirect: "follow",
    });

    clearTimeout(timer);
    const latencyMs = Date.now() - start;

    const expectedStatuses = endpoint.expectedStatus;
    const httpHealthy = expectedStatuses
      ? expectedStatuses.includes(response.status)
      : response.status >= 200 && response.status < 300;

    // Try to parse per-service checks from the JSON body.
    let serviceChecks: Record<string, boolean> | null = null;
    try {
      const body = await response.json();
      if (body && typeof body.checks === "object" && body.checks !== null) {
        serviceChecks = body.checks as Record<string, boolean>;
      }
    } catch {
      // Not JSON or no checks field — fall back to HTTP status only.
    }

    return {
      statusCode: response.status,
      latencyMs,
      healthy: httpHealthy,
      error: httpHealthy ? undefined : `HTTP ${response.status}`,
      serviceChecks,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const message =
      err instanceof Error ? err.message : "Unknown error";
    const isTimeout =
      message.includes("abort") || message.includes("timeout");

    return {
      statusCode: null,
      latencyMs,
      healthy: false,
      error: isTimeout ? `Timeout after ${timeout}ms` : message,
      serviceChecks: null,
    };
  }
}

/**
 * Legacy wrapper — kept for backward compatibility with tests.
 */
export async function checkEndpoint(
  endpoint: HealthEndpoint,
): Promise<HealthCheckResult> {
  const raw = await fetchEndpoint(endpoint);
  return {
    componentId: endpoint.componentId,
    name: endpoint.name,
    url: endpoint.url,
    healthy: raw.healthy,
    statusCode: raw.statusCode,
    latencyMs: raw.latencyMs,
    error: raw.error,
  };
}

/**
 * Determine whether a component is healthy based on its required services.
 *
 * If the endpoint returned per-service checks AND the component declares
 * requiredServices, the component is healthy only when every required
 * service reports true.  Otherwise falls back to the HTTP status code.
 */
function isComponentHealthy(
  endpoint: HealthEndpoint,
  raw: RawEndpointResult,
): { healthy: boolean; error?: string } {
  const { requiredServices } = endpoint;

  if (requiredServices && requiredServices.length > 0 && raw.serviceChecks) {
    const failedServices = requiredServices.filter(
      (svc) => raw.serviceChecks![svc] === false,
    );
    if (failedServices.length > 0) {
      return {
        healthy: false,
        error: `Services down: ${failedServices.join(", ")}`,
      };
    }
    // All required services are healthy — component is healthy even if
    // the overall HTTP status was 503 (other services may be down).
    return { healthy: true };
  }

  // No per-service mapping — fall back to HTTP status.
  return {
    healthy: raw.healthy,
    error: raw.error,
  };
}

/**
 * Run health checks for all provided endpoints concurrently.
 *
 * When multiple endpoints share the same URL (and method), the HTTP request
 * is made only once and the result is reused for every component that maps
 * to that URL.  Per-service checks from the JSON body are used to determine
 * per-component health when requiredServices is configured.
 */
export async function runHealthChecks(
  endpoints: HealthEndpoint[],
): Promise<HealthCheckResult[]> {
  // Group endpoints by their effective request key (method + url).
  const urlMap = new Map<string, HealthEndpoint[]>();
  for (const ep of endpoints) {
    const key = endpointKey(ep);
    const group = urlMap.get(key);
    if (group) {
      group.push(ep);
    } else {
      urlMap.set(key, [ep]);
    }
  }

  // Fire one request per unique URL.
  const uniqueEndpoints = [...urlMap.values()].map((group) => group[0]);
  const uniqueResults = await Promise.all(uniqueEndpoints.map(fetchEndpoint));

  // Build a lookup from the unique results.
  const resultByKey = new Map<string, RawEndpointResult>();
  for (let i = 0; i < uniqueEndpoints.length; i++) {
    const key = endpointKey(uniqueEndpoints[i]);
    resultByKey.set(key, uniqueResults[i]);
  }

  // Fan out: produce one HealthCheckResult per original endpoint,
  // using per-service checks when available.
  return endpoints.map((ep) => {
    const key = endpointKey(ep);
    const raw = resultByKey.get(key)!;
    const { healthy, error } = isComponentHealthy(ep, raw);

    return {
      componentId: ep.componentId,
      name: ep.name,
      url: ep.url,
      healthy,
      statusCode: raw.statusCode,
      latencyMs: raw.latencyMs,
      error,
    };
  });
}
