/**
 * Health check execution logic.
 *
 * Pings configured endpoints and returns per-component results.
 */

import {
  type HealthEndpoint,
  getTimeout,
} from "./health-config";

export interface HealthCheckResult {
  componentId: string;
  name: string;
  url: string;
  healthy: boolean;
  statusCode: number | null;
  latencyMs: number;
  error?: string;
}

/**
 * Ping a single endpoint and return the result.
 */
export async function checkEndpoint(
  endpoint: HealthEndpoint,
): Promise<HealthCheckResult> {
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
    const healthy = expectedStatuses
      ? expectedStatuses.includes(response.status)
      : response.status >= 200 && response.status < 300;

    return {
      componentId: endpoint.componentId,
      name: endpoint.name,
      url: endpoint.url,
      healthy,
      statusCode: response.status,
      latencyMs,
      error: healthy ? undefined : `HTTP ${response.status}`,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const message =
      err instanceof Error ? err.message : "Unknown error";
    const isTimeout =
      message.includes("abort") || message.includes("timeout");

    return {
      componentId: endpoint.componentId,
      name: endpoint.name,
      url: endpoint.url,
      healthy: false,
      statusCode: null,
      latencyMs,
      error: isTimeout ? `Timeout after ${timeout}ms` : message,
    };
  }
}

/**
 * Run health checks for all provided endpoints concurrently.
 *
 * When multiple endpoints share the same URL (and method), the HTTP request
 * is made only once and the result is reused for every component that maps
 * to that URL.  This avoids hammering the same service with duplicate pings.
 */
export async function runHealthChecks(
  endpoints: HealthEndpoint[],
): Promise<HealthCheckResult[]> {
  // Group endpoints by their effective request key (method + url).
  const urlMap = new Map<string, HealthEndpoint[]>();
  for (const ep of endpoints) {
    const key = `${ep.method ?? "GET"}|${ep.url}`;
    const group = urlMap.get(key);
    if (group) {
      group.push(ep);
    } else {
      urlMap.set(key, [ep]);
    }
  }

  // Fire one request per unique URL.
  const uniqueEndpoints = [...urlMap.values()].map((group) => group[0]);
  const uniqueResults = await Promise.all(uniqueEndpoints.map(checkEndpoint));

  // Build a lookup from the unique results (index-aligned with uniqueEndpoints).
  const resultByKey = new Map<string, HealthCheckResult>();
  for (let i = 0; i < uniqueEndpoints.length; i++) {
    const key = `${uniqueEndpoints[i].method ?? "GET"}|${uniqueEndpoints[i].url}`;
    resultByKey.set(key, uniqueResults[i]);
  }

  // Fan out: produce one HealthCheckResult per original endpoint.
  return endpoints.map((ep) => {
    const key = `${ep.method ?? "GET"}|${ep.url}`;
    const shared = resultByKey.get(key)!;
    return {
      componentId: ep.componentId,
      name: ep.name,
      url: ep.url,
      healthy: shared.healthy,
      statusCode: shared.statusCode,
      latencyMs: shared.latencyMs,
      error: shared.error,
    };
  });
}
