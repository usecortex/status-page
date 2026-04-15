/**
 * Tests for the Health Check route handler (src/app/api/health-check/route.ts).
 *
 * Mocks the health-check runner, S3 state layer, health-config, and incident.io
 * API client to test the handler logic in isolation.
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
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
import {
  readHealthState,
  writeHealthState,
  getComponentState,
} from "@/lib/health-state";
import {
  createIncident,
  resolveIncident,
  findSeverityId,
} from "@/lib/incident-io-api";

// ---------------------------------------------------------------------------
// Typed mocks
// ---------------------------------------------------------------------------

const mockGetEndpoints = getHealthEndpoints as jest.MockedFunction<typeof getHealthEndpoints>;
const mockGetThreshold = getFailureThreshold as jest.MockedFunction<typeof getFailureThreshold>;
const mockRunChecks = runHealthChecks as jest.MockedFunction<typeof runHealthChecks>;
const mockReadState = readHealthState as jest.MockedFunction<typeof readHealthState>;
const mockWriteState = writeHealthState as jest.MockedFunction<typeof writeHealthState>;
const mockGetComponentState = getComponentState as jest.MockedFunction<typeof getComponentState>;
const mockCreateIncident = createIncident as jest.MockedFunction<typeof createIncident>;
const mockResolveIncident = resolveIncident as jest.MockedFunction<typeof resolveIncident>;
const mockFindSeverity = findSeverityId as jest.MockedFunction<typeof findSeverityId>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(headers: Record<string, string> = {}): Request {
  const h = new Headers(headers);
  return new Request("https://status.hydradb.com/api/health-check", { headers: h });
}

const defaultComponentState = {
  consecutiveFailures: 0,
  activeIncidentId: null,
  incidentCreatedAt: null,
  lastCheckedAt: "",
  lastHealthy: true,
};

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

const originalEnv = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
  process.env.INCIDENT_IO_API_KEY = "test-api-key";
  mockGetThreshold.mockReturnValue(2);
  mockReadState.mockResolvedValue(null);
  mockWriteState.mockResolvedValue(undefined);
  mockGetComponentState.mockReturnValue(defaultComponentState);
});

afterEach(() => {
  process.env = { ...originalEnv };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/health-check", () => {
  // ---- Auth ----

  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("CRON_SECRET not configured");
  });

  it("returns 401 when authorization header is wrong", async () => {
    const res = await GET(makeRequest({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when authorization header is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  // ---- No endpoints configured ----

  it("returns configured: false when no endpoints exist", async () => {
    mockGetEndpoints.mockReturnValue([]);
    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.configured).toBe(false);
  });

  // ---- Healthy checks ----

  it("processes healthy results and persists state", async () => {
    const endpoint = {
      componentId: "dashboard",
      name: "Dashboard",
      url: "https://app.hydradb.com",
    };
    mockGetEndpoints.mockReturnValue([endpoint]);
    mockRunChecks.mockResolvedValue([
      {
        componentId: "dashboard",
        name: "Dashboard",
        url: "https://app.hydradb.com",
        healthy: true,
        statusCode: 200,
        latencyMs: 50,
      },
    ]);

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.configured).toBe(true);
    expect(body.healthy).toBe(1);
    expect(body.unhealthy).toBe(0);
    expect(body.incidents_created).toEqual([]);
    expect(body.incidents_resolved).toEqual([]);

    // State should be persisted
    expect(mockWriteState).toHaveBeenCalledTimes(1);
    const writtenState = mockWriteState.mock.calls[0][0];
    expect(writtenState.components.dashboard.consecutiveFailures).toBe(0);
    expect(writtenState.components.dashboard.lastHealthy).toBe(true);
    expect(writtenState.components.dashboard.activeIncidentId).toBeNull();
  });

  // ---- Failure threshold logic ----

  it("does not create incident when failures < threshold", async () => {
    const endpoint = {
      componentId: "full-recall",
      name: "Full Recall",
      url: "https://api.hydradb.com/recall/full_recall",
    };
    mockGetEndpoints.mockReturnValue([endpoint]);
    mockGetThreshold.mockReturnValue(3);
    // 1 previous failure, this is the 2nd — still below threshold of 3
    mockGetComponentState.mockReturnValue({
      ...defaultComponentState,
      consecutiveFailures: 1,
    });
    mockRunChecks.mockResolvedValue([
      {
        componentId: "full-recall",
        name: "Full Recall",
        url: "https://api.hydradb.com/recall/full_recall",
        healthy: false,
        statusCode: 500,
        latencyMs: 100,
        error: "Internal Server Error",
      },
    ]);

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    const body = await res.json();
    expect(body.unhealthy).toBe(1);
    expect(body.incidents_created).toEqual([]);
    expect(mockCreateIncident).not.toHaveBeenCalled();

    // Consecutive failures should increment
    const writtenState = mockWriteState.mock.calls[0][0];
    expect(writtenState.components["full-recall"].consecutiveFailures).toBe(2);
  });

  it("creates incident when failures reach threshold", async () => {
    const endpoint = {
      componentId: "full-recall",
      name: "Full Recall",
      url: "https://api.hydradb.com/recall/full_recall",
    };
    mockGetEndpoints.mockReturnValue([endpoint]);
    mockGetThreshold.mockReturnValue(2);
    // 1 previous failure, this is the 2nd — meets threshold of 2
    mockGetComponentState.mockReturnValue({
      ...defaultComponentState,
      consecutiveFailures: 1,
    });
    mockRunChecks.mockResolvedValue([
      {
        componentId: "full-recall",
        name: "Full Recall",
        url: "https://api.hydradb.com/recall/full_recall",
        healthy: false,
        statusCode: 500,
        latencyMs: 100,
        error: "Internal Server Error",
      },
    ]);
    mockFindSeverity.mockResolvedValue("sev-minor-id");
    mockCreateIncident.mockResolvedValue({
      id: "inc-123",
      name: "Full Recall is experiencing issues",
      status: "triage",
      reference: "INC-42",
    });

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    const body = await res.json();
    expect(body.incidents_created).toEqual(["full-recall"]);
    expect(mockCreateIncident).toHaveBeenCalledTimes(1);
    expect(mockCreateIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Full Recall is experiencing issues",
        severityId: "sev-minor-id",
      }),
    );

    // State should track the incident
    const writtenState = mockWriteState.mock.calls[0][0];
    expect(writtenState.components["full-recall"].activeIncidentId).toBe("inc-123");
    expect(writtenState.components["full-recall"].consecutiveFailures).toBe(2);
  });

  // ---- Incident resolution ----

  it("resolves incident when component recovers", async () => {
    const endpoint = {
      componentId: "dashboard",
      name: "Dashboard",
      url: "https://app.hydradb.com",
    };
    mockGetEndpoints.mockReturnValue([endpoint]);
    mockGetComponentState.mockReturnValue({
      consecutiveFailures: 3,
      activeIncidentId: "inc-existing",
      incidentCreatedAt: "2025-01-01T00:00:00Z",
      lastCheckedAt: "2025-01-01T00:00:00Z",
      lastHealthy: false,
    });
    mockRunChecks.mockResolvedValue([
      {
        componentId: "dashboard",
        name: "Dashboard",
        url: "https://app.hydradb.com",
        healthy: true,
        statusCode: 200,
        latencyMs: 50,
      },
    ]);
    mockResolveIncident.mockResolvedValue(true);

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    const body = await res.json();
    expect(body.incidents_resolved).toEqual(["dashboard"]);
    expect(mockResolveIncident).toHaveBeenCalledWith("inc-existing");

    // Incident reference should be cleared
    const writtenState = mockWriteState.mock.calls[0][0];
    expect(writtenState.components.dashboard.activeIncidentId).toBeNull();
    expect(writtenState.components.dashboard.consecutiveFailures).toBe(0);
  });

  it("retains incident ID when resolution fails", async () => {
    const endpoint = {
      componentId: "dashboard",
      name: "Dashboard",
      url: "https://app.hydradb.com",
    };
    mockGetEndpoints.mockReturnValue([endpoint]);
    mockGetComponentState.mockReturnValue({
      consecutiveFailures: 3,
      activeIncidentId: "inc-existing",
      incidentCreatedAt: "2025-01-01T00:00:00Z",
      lastCheckedAt: "2025-01-01T00:00:00Z",
      lastHealthy: false,
    });
    mockRunChecks.mockResolvedValue([
      {
        componentId: "dashboard",
        name: "Dashboard",
        url: "https://app.hydradb.com",
        healthy: true,
        statusCode: 200,
        latencyMs: 50,
      },
    ]);
    mockResolveIncident.mockResolvedValue(false);

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    const body = await res.json();
    // Should NOT be in resolved list since resolution failed
    expect(body.incidents_resolved).toEqual([]);

    // Incident reference should be RETAINED for retry
    const writtenState = mockWriteState.mock.calls[0][0];
    expect(writtenState.components.dashboard.activeIncidentId).toBe("inc-existing");
    expect(writtenState.components.dashboard.incidentCreatedAt).toBe("2025-01-01T00:00:00Z");
  });

  // ---- No API key ----

  it("does not create/resolve incidents when INCIDENT_IO_API_KEY is missing", async () => {
    delete process.env.INCIDENT_IO_API_KEY;
    const endpoint = {
      componentId: "full-recall",
      name: "Full Recall",
      url: "https://api.hydradb.com/recall/full_recall",
    };
    mockGetEndpoints.mockReturnValue([endpoint]);
    mockGetThreshold.mockReturnValue(1);
    mockGetComponentState.mockReturnValue({
      ...defaultComponentState,
      consecutiveFailures: 1,
    });
    mockRunChecks.mockResolvedValue([
      {
        componentId: "full-recall",
        name: "Full Recall",
        url: "https://api.hydradb.com/recall/full_recall",
        healthy: false,
        statusCode: 500,
        latencyMs: 100,
      },
    ]);

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    const body = await res.json();
    expect(body.incidents_created).toEqual([]);
    expect(mockCreateIncident).not.toHaveBeenCalled();
    expect(mockFindSeverity).not.toHaveBeenCalled();
  });

  it("does not resolve incidents when INCIDENT_IO_API_KEY is missing", async () => {
    delete process.env.INCIDENT_IO_API_KEY;
    const endpoint = {
      componentId: "dashboard",
      name: "Dashboard",
      url: "https://app.hydradb.com",
    };
    mockGetEndpoints.mockReturnValue([endpoint]);
    mockGetComponentState.mockReturnValue({
      consecutiveFailures: 3,
      activeIncidentId: "inc-existing",
      incidentCreatedAt: "2025-01-01T00:00:00Z",
      lastCheckedAt: "2025-01-01T00:00:00Z",
      lastHealthy: false,
    });
    mockRunChecks.mockResolvedValue([
      {
        componentId: "dashboard",
        name: "Dashboard",
        url: "https://app.hydradb.com",
        healthy: true,
        statusCode: 200,
        latencyMs: 50,
      },
    ]);

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    const body = await res.json();
    expect(body.incidents_resolved).toEqual([]);
    expect(mockResolveIncident).not.toHaveBeenCalled();
  });

  // ---- getSeverity returns null ----

  it("does not create incident when severity lookup fails", async () => {
    const endpoint = {
      componentId: "full-recall",
      name: "Full Recall",
      url: "https://api.hydradb.com/recall/full_recall",
    };
    mockGetEndpoints.mockReturnValue([endpoint]);
    mockGetThreshold.mockReturnValue(2);
    mockGetComponentState.mockReturnValue({
      ...defaultComponentState,
      consecutiveFailures: 1,
    });
    mockRunChecks.mockResolvedValue([
      {
        componentId: "full-recall",
        name: "Full Recall",
        url: "https://api.hydradb.com/recall/full_recall",
        healthy: false,
        statusCode: 500,
        latencyMs: 100,
      },
    ]);
    mockFindSeverity.mockResolvedValue(null);

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    const body = await res.json();
    expect(body.incidents_created).toEqual([]);
    expect(mockCreateIncident).not.toHaveBeenCalled();

    // Failures should still be tracked
    const writtenState = mockWriteState.mock.calls[0][0];
    expect(writtenState.components["full-recall"].consecutiveFailures).toBe(2);
  });

  // ---- Does not create duplicate incident when one is already active ----

  it("does not create duplicate incident when one is already active", async () => {
    const endpoint = {
      componentId: "full-recall",
      name: "Full Recall",
      url: "https://api.hydradb.com/recall/full_recall",
    };
    mockGetEndpoints.mockReturnValue([endpoint]);
    mockGetThreshold.mockReturnValue(2);
    mockGetComponentState.mockReturnValue({
      consecutiveFailures: 5,
      activeIncidentId: "inc-already-open",
      incidentCreatedAt: "2025-01-01T00:00:00Z",
      lastCheckedAt: "2025-01-01T00:00:00Z",
      lastHealthy: false,
    });
    mockRunChecks.mockResolvedValue([
      {
        componentId: "full-recall",
        name: "Full Recall",
        url: "https://api.hydradb.com/recall/full_recall",
        healthy: false,
        statusCode: 500,
        latencyMs: 100,
      },
    ]);

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    const body = await res.json();
    expect(body.incidents_created).toEqual([]);
    expect(mockCreateIncident).not.toHaveBeenCalled();

    // Should preserve existing incident reference
    const writtenState = mockWriteState.mock.calls[0][0];
    expect(writtenState.components["full-recall"].activeIncidentId).toBe("inc-already-open");
  });

  // ---- Multi-component URL grouping ----

  it("creates only one incident when multiple components share a URL", async () => {
    const sharedUrl = "https://api.hydradb.com/health";
    const endpoints = [
      { componentId: "create-tenant", name: "Create Tenant", url: sharedUrl },
      { componentId: "user-memory", name: "User Memory", url: sharedUrl },
      { componentId: "full-recall", name: "Full Recall", url: sharedUrl },
    ];
    mockGetEndpoints.mockReturnValue(endpoints);
    mockGetThreshold.mockReturnValue(2);

    // All 3 components have 1 previous failure — this check is the 2nd (meets threshold)
    mockGetComponentState.mockReturnValue({
      ...defaultComponentState,
      consecutiveFailures: 1,
    });

    mockRunChecks.mockResolvedValue(
      endpoints.map((ep) => ({
        componentId: ep.componentId,
        name: ep.name,
        url: ep.url,
        healthy: false,
        statusCode: 503,
        latencyMs: 100,
        error: "HTTP 503",
      })),
    );
    mockFindSeverity.mockResolvedValue("sev-minor-id");
    mockCreateIncident.mockResolvedValue({
      id: "inc-shared",
      name: "api.hydradb.com/health is experiencing issues",
      status: "triage",
      reference: "INC-99",
    });

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    const body = await res.json();

    // Only ONE createIncident call for the shared URL
    expect(mockCreateIncident).toHaveBeenCalledTimes(1);
    // All 3 components should be in incidents_created
    expect(body.incidents_created).toEqual(["create-tenant", "user-memory", "full-recall"]);

    // All 3 components should share the same incident ID
    const writtenState = mockWriteState.mock.calls[0][0];
    expect(writtenState.components["create-tenant"].activeIncidentId).toBe("inc-shared");
    expect(writtenState.components["user-memory"].activeIncidentId).toBe("inc-shared");
    expect(writtenState.components["full-recall"].activeIncidentId).toBe("inc-shared");
  });

  it("resolves shared incident only once when multiple components recover", async () => {
    const sharedUrl = "https://api.hydradb.com/health";
    const endpoints = [
      { componentId: "create-tenant", name: "Create Tenant", url: sharedUrl },
      { componentId: "user-memory", name: "User Memory", url: sharedUrl },
    ];
    mockGetEndpoints.mockReturnValue(endpoints);

    // Both components share the same incident ID
    mockGetComponentState.mockReturnValue({
      consecutiveFailures: 3,
      activeIncidentId: "inc-shared",
      incidentCreatedAt: "2025-01-01T00:00:00Z",
      lastCheckedAt: "2025-01-01T00:00:00Z",
      lastHealthy: false,
    });

    mockRunChecks.mockResolvedValue(
      endpoints.map((ep) => ({
        componentId: ep.componentId,
        name: ep.name,
        url: ep.url,
        healthy: true,
        statusCode: 200,
        latencyMs: 50,
      })),
    );
    mockResolveIncident.mockResolvedValue(true);

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    const body = await res.json();

    // resolveIncident should be called only ONCE (same incident ID)
    expect(mockResolveIncident).toHaveBeenCalledTimes(1);
    expect(mockResolveIncident).toHaveBeenCalledWith("inc-shared");
    // Both components should be in resolved list
    expect(body.incidents_resolved).toEqual(["create-tenant", "user-memory"]);
  });

  it("handles mixed URLs: shared URL down, independent URL up", async () => {
    const endpoints = [
      { componentId: "create-tenant", name: "Create Tenant", url: "https://api.hydradb.com/health" },
      { componentId: "user-memory", name: "User Memory", url: "https://api.hydradb.com/health" },
      { componentId: "dashboard", name: "Dashboard", url: "https://app.hydradb.com" },
    ];
    mockGetEndpoints.mockReturnValue(endpoints);
    mockGetThreshold.mockReturnValue(2);
    mockGetComponentState.mockReturnValue({
      ...defaultComponentState,
      consecutiveFailures: 1,
    });

    mockRunChecks.mockResolvedValue([
      { componentId: "create-tenant", name: "Create Tenant", url: "https://api.hydradb.com/health", healthy: false, statusCode: 503, latencyMs: 100, error: "HTTP 503" },
      { componentId: "user-memory", name: "User Memory", url: "https://api.hydradb.com/health", healthy: false, statusCode: 503, latencyMs: 100, error: "HTTP 503" },
      { componentId: "dashboard", name: "Dashboard", url: "https://app.hydradb.com", healthy: true, statusCode: 200, latencyMs: 50 },
    ]);
    mockFindSeverity.mockResolvedValue("sev-minor-id");
    mockCreateIncident.mockResolvedValue({
      id: "inc-api",
      name: "api.hydradb.com/health is experiencing issues",
      status: "triage",
      reference: "INC-100",
    });

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    const body = await res.json();

    // Only 1 incident for the shared API URL
    expect(mockCreateIncident).toHaveBeenCalledTimes(1);
    expect(body.incidents_created).toEqual(["create-tenant", "user-memory"]);
    expect(body.healthy).toBe(1);
    expect(body.unhealthy).toBe(2);

    const writtenState = mockWriteState.mock.calls[0][0];
    expect(writtenState.components.dashboard.lastHealthy).toBe(true);
    expect(writtenState.components.dashboard.activeIncidentId).toBeNull();
  });

  // ---- Error handling ----

  it("returns 500 on unhandled error", async () => {
    mockGetEndpoints.mockImplementation(() => {
      throw new Error("Unexpected failure");
    });

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Unexpected failure");
  });
});
