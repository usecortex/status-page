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
 */
export async function runHealthChecks(
  endpoints: HealthEndpoint[],
): Promise<HealthCheckResult[]> {
  return Promise.all(endpoints.map(checkEndpoint));
}
