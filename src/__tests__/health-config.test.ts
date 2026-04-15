import type { HealthEndpoint } from "@/lib/health-config";
import { getFailureThreshold, getTimeout } from "@/lib/health-config";
import { DEFAULT_COMPONENTS } from "@/lib/defaults";

afterEach(() => {
  delete process.env.HEALTH_CHECK_ENDPOINTS;
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

    jest.resetModules();
    const { getHealthEndpoints } = require("@/lib/health-config");
    const endpoints = getHealthEndpoints();
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].componentId).toBe("dashboard");
  });

  it("parses simple object format", () => {
    process.env.HEALTH_CHECK_ENDPOINTS = JSON.stringify({
      dashboard: "https://app.hydradb.com",
      "full-recall": "https://api.hydradb.com/recall/full_recall",
    });

    jest.resetModules();
    const { getHealthEndpoints } = require("@/lib/health-config");
    const endpoints = getHealthEndpoints();
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0].componentId).toBe("dashboard");
    expect(endpoints[0].url).toBe("https://app.hydradb.com");
  });

  it("falls back to defaults on invalid JSON", () => {
    process.env.HEALTH_CHECK_ENDPOINTS = "not-json";

    jest.resetModules();
    const { getHealthEndpoints } = require("@/lib/health-config");
    const endpoints = getHealthEndpoints();
    // Falls back to defaults derived from DEFAULT_COMPONENTS
    expect(endpoints).toHaveLength(DEFAULT_COMPONENTS.length);
    expect(endpoints[0].componentId).toBe("create-tenant");
  });
});

describe("getHealthEndpoints default endpoints", () => {
  it("returns endpoints whose componentIds exactly match DEFAULT_COMPONENTS ids", () => {
    jest.resetModules();
    const { getHealthEndpoints } = require("@/lib/health-config");
    const endpoints = getHealthEndpoints() as HealthEndpoint[];

    const endpointIds = endpoints.map((ep: HealthEndpoint) => ep.componentId);
    const defaultIds = DEFAULT_COMPONENTS.map((c) => c.id);

    expect(endpointIds).toEqual(defaultIds);
  });

  it("returns endpoints with matching names from DEFAULT_COMPONENTS", () => {
    jest.resetModules();
    const { getHealthEndpoints } = require("@/lib/health-config");
    const endpoints = getHealthEndpoints() as HealthEndpoint[];

    const endpointNames = endpoints.map((ep: HealthEndpoint) => ep.name);
    const defaultNames = DEFAULT_COMPONENTS.map((c) => c.name);

    expect(endpointNames).toEqual(defaultNames);
  });

  it("every endpoint has a valid URL", () => {
    jest.resetModules();
    const { getHealthEndpoints } = require("@/lib/health-config");
    const endpoints = getHealthEndpoints() as HealthEndpoint[];

    for (const ep of endpoints) {
      expect(ep.url).toMatch(/^https:\/\//);
    }
  });

  it("uses only 3 distinct URLs", () => {
    jest.resetModules();
    const { getHealthEndpoints } = require("@/lib/health-config");
    const endpoints = getHealthEndpoints() as HealthEndpoint[];

    const uniqueUrls = new Set(endpoints.map((ep: HealthEndpoint) => ep.url));
    expect(uniqueUrls.size).toBe(3);
    expect(uniqueUrls).toContain("https://api.hydradb.com/health");
    expect(uniqueUrls).toContain("https://ingestion.usecortex.ai/health");
    expect(uniqueUrls).toContain("https://app.hydradb.com");
  });
});
