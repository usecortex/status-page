import { checkEndpoint, runHealthChecks, fetchEndpoint } from "@/lib/health-check";
import type { HealthEndpoint } from "@/lib/health-config";

// Mock fetch globally
const originalFetch = global.fetch;

beforeEach(() => {
  // Use fake timers so that the AbortController setTimeout in checkEndpoint
  // is always cleared and doesn't leak open handles between tests.
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
});

/** Helper to create a mock Response with optional JSON body. */
const mockResponse = (
  status: number,
  body?: Record<string, unknown>,
) => ({
  status,
  ok: status >= 200 && status < 300,
  json: body ? () => Promise.resolve(body) : () => Promise.reject(new Error("no body")),
});

describe("checkEndpoint", () => {
  it("returns healthy for 200 response", async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(200));

    const endpoint: HealthEndpoint = {
      componentId: "dashboard",
      name: "Dashboard",
      url: "https://app.hydradb.com",
    };

    const result = await checkEndpoint(endpoint);
    expect(result.healthy).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.componentId).toBe("dashboard");
    expect(result.error).toBeUndefined();
  });

  it("returns unhealthy for 500 response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 500,
      ok: false,
    });

    const endpoint: HealthEndpoint = {
      componentId: "user-memory",
      name: "User Memory",
      url: "https://api.hydradb.com/memories/add_memory",
    };

    const result = await checkEndpoint(endpoint);
    expect(result.healthy).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.error).toBe("HTTP 500");
  });

  it("returns unhealthy for 404 response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 404,
      ok: false,
    });

    const endpoint: HealthEndpoint = {
      componentId: "fetch-content",
      name: "Fetch Content",
      url: "https://api.hydradb.com/fetch/content",
    };

    const result = await checkEndpoint(endpoint);
    expect(result.healthy).toBe(false);
    expect(result.statusCode).toBe(404);
  });

  it("returns unhealthy on network error", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const endpoint: HealthEndpoint = {
      componentId: "full-recall",
      name: "Full Recall",
      url: "https://api.hydradb.com/recall/full_recall",
    };

    const result = await checkEndpoint(endpoint);
    expect(result.healthy).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("returns unhealthy on timeout (abort)", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("The operation was aborted"));

    const endpoint: HealthEndpoint = {
      componentId: "search-embeddings",
      name: "Search Embeddings",
      url: "https://api.hydradb.com/embeddings/search_raw_embeddings",
      timeoutMs: 5000,
    };

    const result = await checkEndpoint(endpoint);
    expect(result.healthy).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.error).toContain("Timeout");
  });

  it("respects custom expectedStatus", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 204,
      ok: true,
    });

    const endpoint: HealthEndpoint = {
      componentId: "dashboard",
      name: "Dashboard",
      url: "https://app.hydradb.com",
      expectedStatus: [200],
    };

    const result = await checkEndpoint(endpoint);
    // 204 is not in expectedStatus [200], so unhealthy
    expect(result.healthy).toBe(false);
  });

  it("accepts 204 when in expectedStatus", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 204,
      ok: true,
    });

    const endpoint: HealthEndpoint = {
      componentId: "dashboard",
      name: "Dashboard",
      url: "https://app.hydradb.com",
      expectedStatus: [200, 204],
    };

    const result = await checkEndpoint(endpoint);
    expect(result.healthy).toBe(true);
  });

  it("treats any 2xx as healthy by default", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 201,
      ok: true,
    });

    const endpoint: HealthEndpoint = {
      componentId: "knowledge-base",
      name: "Knowledge Base",
      url: "https://api.hydradb.com/ingestion/upload_knowledge",
    };

    const result = await checkEndpoint(endpoint);
    expect(result.healthy).toBe(true);
  });

  it("accepts 401/403 when in expectedStatus (auth-gated endpoints)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 401,
      ok: false,
    });

    const endpoint: HealthEndpoint = {
      componentId: "monitor-infra-status",
      name: "Monitor & Infra Status",
      url: "https://api.hydradb.com/tenants/monitor",
      expectedStatus: [200, 401, 403, 422],
    };

    const result = await checkEndpoint(endpoint);
    // 401 means server is up, just needs auth — healthy
    expect(result.healthy).toBe(true);
  });
});

describe("runHealthChecks", () => {
  it("runs all checks concurrently", async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(200));

    const endpoints: HealthEndpoint[] = [
      { componentId: "dashboard", name: "Dashboard", url: "https://app.hydradb.com" },
      { componentId: "monitor-infra-status", name: "Monitor & Infra Status", url: "https://api.hydradb.com/health" },
      { componentId: "list-sub-tenant-ids", name: "List Sub-Tenant IDs", url: "https://api.hydradb.com/health" },
    ];

    const results = await runHealthChecks(endpoints);
    expect(results).toHaveLength(3);
    // Only 2 unique URLs: app.hydradb.com and api.hydradb.com/health
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(results.every((r) => r.healthy)).toBe(true);
  });

  it("deduplicates HTTP calls for the same URL", async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(200));

    const endpoints: HealthEndpoint[] = [
      { componentId: "create-tenant", name: "Create Tenant", url: "https://api.hydradb.com/health" },
      { componentId: "user-memory", name: "User Memory", url: "https://api.hydradb.com/health" },
      { componentId: "full-recall", name: "Full Recall", url: "https://api.hydradb.com/health" },
      { componentId: "dashboard", name: "Dashboard", url: "https://app.hydradb.com" },
      { componentId: "verify-processing", name: "Verify Processing", url: "https://ingestion.usecortex.ai/health" },
    ];

    const results = await runHealthChecks(endpoints);
    expect(results).toHaveLength(5);
    // Only 3 unique URLs
    expect(global.fetch).toHaveBeenCalledTimes(3);
    // Each result has the correct componentId
    expect(results[0].componentId).toBe("create-tenant");
    expect(results[1].componentId).toBe("user-memory");
    expect(results[2].componentId).toBe("full-recall");
    expect(results[3].componentId).toBe("dashboard");
    expect(results[4].componentId).toBe("verify-processing");
    expect(results.every((r) => r.healthy)).toBe(true);
  });

  it("propagates failure to all components sharing a URL (no requiredServices)", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("api.hydradb.com")) {
        return Promise.resolve(mockResponse(503));
      }
      return Promise.resolve(mockResponse(200));
    });

    // No requiredServices — falls back to HTTP status code
    const endpoints: HealthEndpoint[] = [
      { componentId: "create-tenant", name: "Create Tenant", url: "https://api.hydradb.com/health" },
      { componentId: "user-memory", name: "User Memory", url: "https://api.hydradb.com/health" },
      { componentId: "dashboard", name: "Dashboard", url: "https://app.hydradb.com" },
    ];

    const results = await runHealthChecks(endpoints);
    expect(results[0].healthy).toBe(false);
    expect(results[0].statusCode).toBe(503);
    expect(results[1].healthy).toBe(false);
    expect(results[1].statusCode).toBe(503);
    expect(results[2].healthy).toBe(true);
    expect(results[2].statusCode).toBe(200);
  });

  it("handles mixed healthy/unhealthy results across different URLs", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("ingestion")) {
        return Promise.resolve(mockResponse(503));
      }
      return Promise.resolve(mockResponse(200));
    });

    const endpoints: HealthEndpoint[] = [
      { componentId: "dashboard", name: "Dashboard", url: "https://app.hydradb.com" },
      { componentId: "verify-processing", name: "Verify Processing", url: "https://ingestion.usecortex.ai/health" },
      { componentId: "create-tenant", name: "Create Tenant", url: "https://api.hydradb.com/health" },
    ];

    const results = await runHealthChecks(endpoints);
    expect(results[0].healthy).toBe(true);
    expect(results[1].healthy).toBe(false);
    expect(results[1].statusCode).toBe(503);
    expect(results[2].healthy).toBe(true);
  });
});

describe("per-service granularity", () => {
  it("marks component healthy when all required services are up", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse(200, {
        status: "ok",
        checks: { milvus: true, falkordb: true, mongodb: true, dynamodb: true, s3: true },
      }),
    );

    const endpoints: HealthEndpoint[] = [
      {
        componentId: "knowledge-base",
        name: "Knowledge Base",
        url: "https://api.hydradb.com/health",
        requiredServices: ["mongodb", "dynamodb", "s3", "milvus", "falkordb"],
      },
    ];

    const results = await runHealthChecks(endpoints);
    expect(results[0].healthy).toBe(true);
  });

  it("marks component unhealthy when a required service is down", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse(503, {
        status: "degraded",
        checks: { milvus: true, falkordb: false, mongodb: true, dynamodb: true, s3: true },
      }),
    );

    const endpoints: HealthEndpoint[] = [
      {
        componentId: "knowledge-base",
        name: "Knowledge Base",
        url: "https://api.hydradb.com/health",
        requiredServices: ["mongodb", "dynamodb", "s3", "milvus", "falkordb"],
      },
    ];

    const results = await runHealthChecks(endpoints);
    expect(results[0].healthy).toBe(false);
    expect(results[0].error).toContain("falkordb");
  });

  it("marks component healthy when only non-required services are down", async () => {
    // FalkorDB is down, but create-tenant only needs mongodb, dynamodb, s3
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse(503, {
        status: "degraded",
        checks: { milvus: true, falkordb: false, mongodb: true, dynamodb: true, s3: true },
      }),
    );

    const endpoints: HealthEndpoint[] = [
      {
        componentId: "create-tenant",
        name: "Create Tenant",
        url: "https://api.hydradb.com/health",
        requiredServices: ["mongodb", "dynamodb", "s3"],
      },
      {
        componentId: "graph-relations",
        name: "Graph Relations",
        url: "https://api.hydradb.com/health",
        requiredServices: ["mongodb", "dynamodb", "s3", "falkordb"],
      },
    ];

    const results = await runHealthChecks(endpoints);
    // create-tenant should be healthy — it doesn't need falkordb
    expect(results[0].healthy).toBe(true);
    // graph-relations should be unhealthy — it needs falkordb
    expect(results[1].healthy).toBe(false);
    expect(results[1].error).toContain("falkordb");
  });

  it("falls back to HTTP status when no service checks in response", async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(503));

    const endpoints: HealthEndpoint[] = [
      {
        componentId: "create-tenant",
        name: "Create Tenant",
        url: "https://api.hydradb.com/health",
        requiredServices: ["mongodb", "dynamodb", "s3"],
      },
    ];

    const results = await runHealthChecks(endpoints);
    expect(results[0].healthy).toBe(false);
    expect(results[0].error).toBe("HTTP 503");
  });

  it("falls back to HTTP status when no requiredServices configured", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse(503, {
        status: "degraded",
        checks: { falkordb: false, mongodb: true },
      }),
    );

    const endpoints: HealthEndpoint[] = [
      {
        componentId: "dashboard",
        name: "Dashboard",
        url: "https://api.hydradb.com/health",
        // no requiredServices
      },
    ];

    const results = await runHealthChecks(endpoints);
    expect(results[0].healthy).toBe(false);
  });

  it("lists all failed services in error message", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse(503, {
        status: "down",
        checks: { milvus: false, falkordb: false, mongodb: true, dynamodb: true, s3: false },
      }),
    );

    const endpoints: HealthEndpoint[] = [
      {
        componentId: "knowledge-base",
        name: "Knowledge Base",
        url: "https://api.hydradb.com/health",
        requiredServices: ["mongodb", "dynamodb", "s3", "milvus", "falkordb"],
      },
    ];

    const results = await runHealthChecks(endpoints);
    expect(results[0].healthy).toBe(false);
    expect(results[0].error).toContain("milvus");
    expect(results[0].error).toContain("falkordb");
    expect(results[0].error).toContain("s3");
  });
});
