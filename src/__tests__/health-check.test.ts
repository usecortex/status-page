import { checkEndpoint, runHealthChecks } from "@/lib/health-check";
import type { HealthEndpoint } from "@/lib/health-config";
import { getFailureThreshold, getTimeout } from "@/lib/health-config";

// Mock fetch globally
const originalFetch = global.fetch;

beforeEach(() => {
  jest.useFakeTimers({ legacyFakeTimers: true });
});

afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
  delete process.env.HEALTH_CHECK_ENDPOINTS;
});

describe("checkEndpoint", () => {
  it("returns healthy for 200 response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
    });

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
      componentId: "memory-api",
      name: "Memory API",
      url: "https://api.hydradb.com/v1/memory/health",
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
      componentId: "docs-site",
      name: "Docs Site",
      url: "https://docs.hydradb.com",
    };

    const result = await checkEndpoint(endpoint);
    expect(result.healthy).toBe(false);
    expect(result.statusCode).toBe(404);
  });

  it("returns unhealthy on network error", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const endpoint: HealthEndpoint = {
      componentId: "website",
      name: "Website",
      url: "https://hydradb.com",
    };

    const result = await checkEndpoint(endpoint);
    expect(result.healthy).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("returns unhealthy on timeout (abort)", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("The operation was aborted"));

    const endpoint: HealthEndpoint = {
      componentId: "hybrid-search",
      name: "Hybrid Search",
      url: "https://api.hydradb.com/v1/search/health",
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
      url: "https://app.hydradb.com/health",
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
      url: "https://app.hydradb.com/health",
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
      componentId: "document-upload",
      name: "Document Upload",
      url: "https://api.hydradb.com/v1/upload/health",
    };

    const result = await checkEndpoint(endpoint);
    expect(result.healthy).toBe(true);
  });
});

describe("runHealthChecks", () => {
  it("runs all checks concurrently", async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({ status: 200, ok: true });
    });

    const endpoints: HealthEndpoint[] = [
      { componentId: "dashboard", name: "Dashboard", url: "https://app.hydradb.com" },
      { componentId: "website", name: "Website", url: "https://hydradb.com" },
      { componentId: "docs-site", name: "Docs Site", url: "https://docs.hydradb.com" },
    ];

    const results = await runHealthChecks(endpoints);
    expect(results).toHaveLength(3);
    expect(callCount).toBe(3);
    expect(results.every((r) => r.healthy)).toBe(true);
  });

  it("handles mixed healthy/unhealthy results", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("docs")) {
        return Promise.resolve({ status: 503, ok: false });
      }
      return Promise.resolve({ status: 200, ok: true });
    });

    const endpoints: HealthEndpoint[] = [
      { componentId: "dashboard", name: "Dashboard", url: "https://app.hydradb.com" },
      { componentId: "docs-site", name: "Docs Site", url: "https://docs.hydradb.com" },
    ];

    const results = await runHealthChecks(endpoints);
    expect(results[0].healthy).toBe(true);
    expect(results[1].healthy).toBe(false);
    expect(results[1].statusCode).toBe(503);
  });
});

describe("health-config helpers", () => {
  it("getTimeout returns default when not specified", () => {
    const endpoint: HealthEndpoint = {
      componentId: "test",
      name: "Test",
      url: "https://example.com",
    };
    expect(getTimeout(endpoint)).toBe(10_000);
  });

  it("getTimeout returns custom value", () => {
    const endpoint: HealthEndpoint = {
      componentId: "test",
      name: "Test",
      url: "https://example.com",
      timeoutMs: 5000,
    };
    expect(getTimeout(endpoint)).toBe(5000);
  });

  it("getFailureThreshold returns default when not specified", () => {
    const endpoint: HealthEndpoint = {
      componentId: "test",
      name: "Test",
      url: "https://example.com",
    };
    expect(getFailureThreshold(endpoint)).toBe(2);
  });

  it("getFailureThreshold returns custom value", () => {
    const endpoint: HealthEndpoint = {
      componentId: "test",
      name: "Test",
      url: "https://example.com",
      failureThreshold: 5,
    };
    expect(getFailureThreshold(endpoint)).toBe(5);
  });
});

describe("HEALTH_CHECK_ENDPOINTS env var parsing", () => {
  it("parses array format", () => {
    process.env.HEALTH_CHECK_ENDPOINTS = JSON.stringify([
      { componentId: "dashboard", name: "Dashboard", url: "https://app.hydradb.com" },
    ]);

    // Re-import to pick up env var
    jest.resetModules();
    const { getHealthEndpoints } = require("@/lib/health-config");
    const endpoints = getHealthEndpoints();
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].componentId).toBe("dashboard");
  });

  it("parses simple object format", () => {
    process.env.HEALTH_CHECK_ENDPOINTS = JSON.stringify({
      dashboard: "https://app.hydradb.com",
      website: "https://hydradb.com",
    });

    jest.resetModules();
    const { getHealthEndpoints } = require("@/lib/health-config");
    const endpoints = getHealthEndpoints();
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0].componentId).toBe("dashboard");
    expect(endpoints[0].url).toBe("https://app.hydradb.com");
  });

  it("returns empty array on invalid JSON", () => {
    process.env.HEALTH_CHECK_ENDPOINTS = "not-json";

    jest.resetModules();
    const { getHealthEndpoints } = require("@/lib/health-config");
    const endpoints = getHealthEndpoints();
    expect(endpoints).toHaveLength(0);
  });
});
