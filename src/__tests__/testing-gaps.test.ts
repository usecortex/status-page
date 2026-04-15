/**
 * Targeted gap-filling tests for the health check wiring changes.
 *
 * Covers scenarios NOT exercised by the existing unit tests:
 *   1. normalizeName in isolation
 *   2. Partial-incident duplicate scenario (mixed activeIncidentId state for shared URL)
 *   3. reverseComponentMap short display name gap (e.g. "List" -> "list-data")
 *   4. vercel.json health-check cron is wired
 *
 * NOTE: URL mapping tests (21 components, 3 URLs) live in health-config.test.ts
 * to avoid conflicts with the jest.mock() declarations needed for route handler tests.
 */

// ---------------------------------------------------------------------------
// 1. normalizeName
// ---------------------------------------------------------------------------
import { normalizeName } from "@/lib/incident-io";

describe("normalizeName", () => {
  it("lowercases and trims plain names", () => {
    expect(normalizeName("Dashboard")).toBe("dashboard");
    expect(normalizeName("  Dashboard  ")).toBe("dashboard");
  });

  it("replaces & with space and collapses whitespace", () => {
    expect(normalizeName("Monitor & Infra Status")).toBe("monitor infra status");
  });

  it("replaces / with space and collapses whitespace", () => {
    expect(normalizeName("Shared / Hive Memory")).toBe("shared hive memory");
  });

  it("handles consecutive special chars without double spaces", () => {
    expect(normalizeName("A & / B")).toBe("a b");
  });

  it("preserves hyphens (they are not stripped)", () => {
    expect(normalizeName("List Sub-Tenant IDs")).toBe("list sub-tenant ids");
  });

  it("handles empty string", () => {
    expect(normalizeName("")).toBe("");
  });

  it("handles name with only punctuation", () => {
    expect(normalizeName("& /")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 2. Partial-incident duplicate scenario — health-check route
//    comp1 already has activeIncidentId for URL-X
//    comp2 has no activeIncidentId but hits threshold for same URL-X
//
//    NOTE: The current implementation DOES create a new incident in this case.
//    This test documents the current behavior and serves as a regression anchor.
// ---------------------------------------------------------------------------

jest.mock("@/lib/health-config", () => ({
  getHealthEndpoints: jest.fn(),
  getFailureThreshold: jest.fn(),
}));

jest.mock("@/lib/health-check", () => ({
  runHealthChecks: jest.fn(),
}));

jest.mock("@/lib/health-state", () => ({
  readHealthState: jest.fn(),
  writeHealthState: jest.fn(),
  getComponentState: jest.fn(),
}));

jest.mock("@/lib/incident-io-api", () => ({
  createIncident: jest.fn(),
  resolveIncident: jest.fn(),
  findSeverityId: jest.fn(),
}));

import { GET } from "@/app/api/health-check/route";
import { getHealthEndpoints, getFailureThreshold } from "@/lib/health-config";
import { runHealthChecks } from "@/lib/health-check";
import { readHealthState, writeHealthState, getComponentState } from "@/lib/health-state";
import { createIncident, resolveIncident, findSeverityId } from "@/lib/incident-io-api";

const mockGetEndpoints = getHealthEndpoints as jest.MockedFunction<typeof getHealthEndpoints>;
const mockGetThreshold = getFailureThreshold as jest.MockedFunction<typeof getFailureThreshold>;
const mockRunChecks = runHealthChecks as jest.MockedFunction<typeof runHealthChecks>;
const mockReadState = readHealthState as jest.MockedFunction<typeof readHealthState>;
const mockWriteState = writeHealthState as jest.MockedFunction<typeof writeHealthState>;
const mockGetComponentState = getComponentState as jest.MockedFunction<typeof getComponentState>;
const mockCreateIncident = createIncident as jest.MockedFunction<typeof createIncident>;
const mockFindSeverity = findSeverityId as jest.MockedFunction<typeof findSeverityId>;

function makeRequest(headers: Record<string, string> = {}): Request {
  const h = new Headers(headers);
  return new Request("https://status.hydradb.com/api/health-check", { headers: h });
}

const originalEnv = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
  process.env.INCIDENT_IO_API_KEY = "test-api-key";
  mockGetThreshold.mockReturnValue(2);
  mockReadState.mockResolvedValue(null);
  mockWriteState.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("partial-incident duplicate scenario (mixed activeIncidentId state)", () => {
  it("documents current behavior: creates new incident when comp1 has existing incident but comp2 hits threshold for same URL", async () => {
    const sharedUrl = "https://api.hydradb.com/health";
    const endpoints = [
      { componentId: "create-tenant", name: "Create Tenant", url: sharedUrl },
      { componentId: "user-memory", name: "User Memory", url: sharedUrl },
    ];
    mockGetEndpoints.mockReturnValue(endpoints);
    mockGetThreshold.mockReturnValue(2);

    // comp1 (create-tenant) already has an active incident
    // comp2 (user-memory) has 1 previous failure (will hit threshold=2 this cycle)
    mockGetComponentState.mockImplementation((_state, componentId) => {
      if (componentId === "create-tenant") {
        return {
          consecutiveFailures: 3,
          activeIncidentId: "inc-existing",
          incidentCreatedAt: "2025-01-01T00:00:00Z",
          lastCheckedAt: "2025-01-01T00:00:00Z",
          lastHealthy: false,
        };
      }
      return {
        consecutiveFailures: 1,
        activeIncidentId: null,
        incidentCreatedAt: null,
        lastCheckedAt: "2025-01-01T00:00:00Z",
        lastHealthy: false,
      };
    });

    mockRunChecks.mockResolvedValue([
      { componentId: "create-tenant", name: "Create Tenant", url: sharedUrl, healthy: false, statusCode: 503, latencyMs: 100, error: "HTTP 503" },
      { componentId: "user-memory", name: "User Memory", url: sharedUrl, healthy: false, statusCode: 503, latencyMs: 100, error: "HTTP 503" },
    ]);
    mockFindSeverity.mockResolvedValue("sev-minor-id");
    mockCreateIncident.mockResolvedValue({
      id: "inc-new",
      name: "User Memory is experiencing issues",
      status: "triage",
      reference: "INC-200",
    });

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    const body = await res.json();

    // CURRENT BEHAVIOR (documented, not necessarily desired):
    // comp1's existing incident is preserved (!prevState.activeIncidentId = false)
    // comp2 hits threshold with no prior incident -> creates NEW incident
    // The idempotencyKey uses urlKey so incident.io deduplicates within the same hour.
    expect(mockCreateIncident).toHaveBeenCalledTimes(1);
    expect(body.incidents_created).toEqual(["user-memory"]);

    const writtenState = mockWriteState.mock.calls[0][0];
    expect(writtenState.components["create-tenant"].activeIncidentId).toBe("inc-existing");
    expect(writtenState.components["user-memory"].activeIncidentId).toBe("inc-new");
  });

  it("does NOT create duplicate incident when both components already have the SAME incident ID", async () => {
    const sharedUrl = "https://api.hydradb.com/health";
    const endpoints = [
      { componentId: "create-tenant", name: "Create Tenant", url: sharedUrl },
      { componentId: "user-memory", name: "User Memory", url: sharedUrl },
    ];
    mockGetEndpoints.mockReturnValue(endpoints);
    mockGetThreshold.mockReturnValue(2);

    mockGetComponentState.mockReturnValue({
      consecutiveFailures: 5,
      activeIncidentId: "inc-existing",
      incidentCreatedAt: "2025-01-01T00:00:00Z",
      lastCheckedAt: "2025-01-01T00:00:00Z",
      lastHealthy: false,
    });

    mockRunChecks.mockResolvedValue([
      { componentId: "create-tenant", name: "Create Tenant", url: sharedUrl, healthy: false, statusCode: 503, latencyMs: 100 },
      { componentId: "user-memory", name: "User Memory", url: sharedUrl, healthy: false, statusCode: 503, latencyMs: 100 },
    ]);

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    const body = await res.json();

    expect(mockCreateIncident).not.toHaveBeenCalled();
    expect(body.incidents_created).toEqual([]);

    const writtenState = mockWriteState.mock.calls[0][0];
    expect(writtenState.components["create-tenant"].activeIncidentId).toBe("inc-existing");
    expect(writtenState.components["user-memory"].activeIncidentId).toBe("inc-existing");
  });
});

// ---------------------------------------------------------------------------
// 3. reverseComponentMap short display name gap
// ---------------------------------------------------------------------------

describe("reverseComponentMap short display name gap (cron route)", () => {
  it("normalizeName('List') does NOT equal the hyphen-to-space form of 'list-data'", () => {
    expect(normalizeName("List")).toBe("list");
    expect("list-data".replace(/-/g, " ").toLowerCase()).toBe("list data");
    expect(normalizeName("List")).not.toBe("list data");
  });

  it("normalizeName('Monitor & Infra Status') DOES match hyphen-to-space form of 'monitor-infra-status'", () => {
    expect(normalizeName("Monitor & Infra Status")).toBe("monitor infra status");
    expect("monitor-infra-status".replace(/-/g, " ").toLowerCase()).toBe("monitor infra status");
    expect(normalizeName("Monitor & Infra Status")).toBe(
      "monitor-infra-status".replace(/-/g, " ").toLowerCase(),
    );
  });

  it("normalizeName('Shared / Hive Memory') DOES match hyphen-to-space form of 'shared-hive-memory'", () => {
    expect(normalizeName("Shared / Hive Memory")).toBe("shared hive memory");
    expect("shared-hive-memory".replace(/-/g, " ").toLowerCase()).toBe("shared hive memory");
    expect(normalizeName("Shared / Hive Memory")).toBe(
      "shared-hive-memory".replace(/-/g, " ").toLowerCase(),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. vercel.json health-check cron is wired
// ---------------------------------------------------------------------------
import * as fs from "fs";
import * as path from "path";

describe("vercel.json cron configuration", () => {
  const vercelConfig = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../..", "vercel.json"), "utf8"),
  );

  it("has a cron for /api/health-check", () => {
    const cron = vercelConfig.crons?.find(
      (c: { path: string }) => c.path === "/api/health-check",
    );
    expect(cron).toBeDefined();
  });

  it("health-check cron runs every 5 minutes", () => {
    const cron = vercelConfig.crons?.find(
      (c: { path: string }) => c.path === "/api/health-check",
    );
    expect(cron?.schedule).toBe("*/5 * * * *");
  });

  it("both /api/cron and /api/health-check are scheduled", () => {
    const paths = vercelConfig.crons?.map((c: { path: string }) => c.path) ?? [];
    expect(paths).toContain("/api/cron");
    expect(paths).toContain("/api/health-check");
  });
});
