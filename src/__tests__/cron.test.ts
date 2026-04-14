/**
 * Tests for the Vercel Cron job handler (src/app/api/cron/route.ts).
 *
 * We mock the S3 layer and incident.io client to test the handler logic
 * in isolation.
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

jest.mock("@/lib/s3", () => ({
  readStatusData: jest.fn(),
  writeStatusData: jest.fn(),
}));

jest.mock("@/lib/incident-io", () => ({
  fetchWidgetData: jest.fn(),
  normalizeWidgetResponse: jest.fn(),
  mapComponentStatuses: jest.fn(),
}));

import { GET } from "@/app/api/cron/route";
import { readStatusData, writeStatusData } from "@/lib/s3";
import {
  fetchWidgetData,
  normalizeWidgetResponse,
  mapComponentStatuses,
} from "@/lib/incident-io";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockReadStatusData = readStatusData as jest.MockedFunction<typeof readStatusData>;
const mockWriteStatusData = writeStatusData as jest.MockedFunction<typeof writeStatusData>;
const mockFetchWidgetData = fetchWidgetData as jest.MockedFunction<typeof fetchWidgetData>;
const mockNormalizeWidgetResponse = normalizeWidgetResponse as jest.MockedFunction<typeof normalizeWidgetResponse>;
const mockMapComponentStatuses = mapComponentStatuses as jest.MockedFunction<typeof mapComponentStatuses>;

function makeRequest(headers: Record<string, string> = {}): Request {
  const h = new Headers(headers);
  return new Request("https://status.hydradb.com/api/cron", { headers: h });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/cron", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...ORIGINAL_ENV, CRON_SECRET: "test-secret" };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest({ authorization: "Bearer anything" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("CRON_SECRET not configured");
  });

  it("returns 401 when authorization header is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when authorization header is wrong", async () => {
    const res = await GET(makeRequest({ authorization: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
  });

  // -----------------------------------------------------------------------
  // Not configured (no INCIDENT_IO_WIDGET_URL)
  // -----------------------------------------------------------------------

  it("writes default data on first run when not configured", async () => {
    mockReadStatusData.mockResolvedValue(null);
    mockWriteStatusData.mockResolvedValue(undefined);

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.configured).toBe(false);

    // Should write default snapshot
    expect(mockWriteStatusData).toHaveBeenCalledTimes(1);
    const snapshot = mockWriteStatusData.mock.calls[0][0];
    expect(snapshot.configured).toBe(false);
    expect(snapshot.overall_status).toBe("operational");
    expect(snapshot.component_groups.length).toBeGreaterThan(0);
    expect(snapshot.incidents).toEqual([]);
    expect(snapshot.maintenance_windows).toEqual([]);
  });

  it("does not overwrite existing data when not configured", async () => {
    mockReadStatusData.mockResolvedValue({
      generated_at: "2026-04-14T00:00:00Z",
      configured: false,
      overall_status: "operational",
      component_groups: [],
      incidents: [],
      maintenance_windows: [],
    });

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(mockWriteStatusData).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Configured — successful fetch
  // -----------------------------------------------------------------------

  it("fetches widget data, computes uptime, and writes snapshot when configured", async () => {
    process.env.INCIDENT_IO_WIDGET_URL = "https://example.com/widget";

    mockReadStatusData.mockResolvedValue(null);
    mockFetchWidgetData.mockResolvedValue({ components: [] });
    mockNormalizeWidgetResponse.mockReturnValue({
      incidents: [],
      maintenance_windows: [],
    });
    mockMapComponentStatuses.mockReturnValue(new Map());
    mockWriteStatusData.mockResolvedValue(undefined);

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.configured).toBe(true);
    expect(body.components_updated).toBeGreaterThan(0);

    // Should have called the full pipeline
    expect(mockFetchWidgetData).toHaveBeenCalledWith("https://example.com/widget");
    expect(mockNormalizeWidgetResponse).toHaveBeenCalled();
    expect(mockMapComponentStatuses).toHaveBeenCalled();
    expect(mockWriteStatusData).toHaveBeenCalledTimes(1);

    const snapshot = mockWriteStatusData.mock.calls[0][0];
    expect(snapshot.configured).toBe(true);
    expect(snapshot.overall_status).toBe("operational");
  });

  // -----------------------------------------------------------------------
  // Configured — fetch failure (last-known-good)
  // -----------------------------------------------------------------------

  it("keeps existing data when widget API fetch fails", async () => {
    process.env.INCIDENT_IO_WIDGET_URL = "https://example.com/widget";

    mockReadStatusData.mockResolvedValue({
      generated_at: "2026-04-14T00:00:00Z",
      configured: true,
      overall_status: "operational",
      component_groups: [],
      incidents: [],
      maintenance_windows: [],
    });
    mockFetchWidgetData.mockResolvedValue(null); // fetch failed

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.skipped).toBe(true);
    expect(body.reason).toBe("widget_api_unreachable");

    // Should NOT have written anything
    expect(mockWriteStatusData).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it("returns 500 on unexpected errors", async () => {
    process.env.INCIDENT_IO_WIDGET_URL = "https://example.com/widget";
    mockReadStatusData.mockRejectedValue(new Error("S3 connection failed"));

    const res = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe("S3 connection failed");
  });
});
