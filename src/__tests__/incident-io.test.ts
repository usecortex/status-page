import { normalizeWidgetResponse, mapComponentStatuses } from "@/lib/incident-io";

describe("normalizeWidgetResponse", () => {
  it("returns empty data for null/undefined input", () => {
    const result = normalizeWidgetResponse(null);
    expect(result.incidents).toEqual([]);
    expect(result.maintenance_windows).toEqual([]);
  });

  it("returns empty data for empty object", () => {
    const result = normalizeWidgetResponse({});
    expect(result.incidents).toEqual([]);
    expect(result.maintenance_windows).toEqual([]);
  });

  it("normalizes ongoing_incidents into incidents", () => {
    const raw = {
      ongoing_incidents: [
        {
          id: "inc_1",
          name: "API Outage",
          status: "investigating",
          started_at: "2026-04-14T10:00:00Z",
          affected_components: [{ id: "hybrid-search" }],
          updates: [{ body: "Looking into it", created_at: "2026-04-14T10:05:00Z" }],
        },
      ],
    };
    const result = normalizeWidgetResponse(raw);
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0].id).toBe("inc_1");
    expect(result.incidents[0].name).toBe("API Outage");
    expect(result.incidents[0].status).toBe("investigating");
    expect(result.incidents[0].components).toEqual(["hybrid-search"]);
    expect(result.incidents[0].updates).toHaveLength(1);
    expect(result.incidents[0].updates[0].body).toBe("Looking into it");
  });

  it("falls back to incidents array when ongoing_incidents is empty", () => {
    const raw = {
      ongoing_incidents: [],
      incidents: [
        { id: "inc_2", name: "Past Issue", status: "resolved", started_at: "2026-04-13T00:00:00Z" },
      ],
    };
    const result = normalizeWidgetResponse(raw);
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0].id).toBe("inc_2");
  });

  it("deduplicates maintenance windows by id", () => {
    const raw = {
      in_progress_maintenances: [
        { id: "maint_1", name: "DB Migration", status: "in_progress", starts_at: "2026-04-14T02:00:00Z", ends_at: "2026-04-14T04:00:00Z" },
      ],
      scheduled_maintenances: [
        { id: "maint_1", name: "DB Migration", status: "in_progress", starts_at: "2026-04-14T02:00:00Z", ends_at: "2026-04-14T04:00:00Z" },
        { id: "maint_2", name: "Cert Rotation", status: "scheduled", starts_at: "2026-04-15T02:00:00Z", ends_at: "2026-04-15T03:00:00Z" },
      ],
    };
    const result = normalizeWidgetResponse(raw);
    expect(result.maintenance_windows).toHaveLength(2);
    expect(result.maintenance_windows.map(m => m.id)).toEqual(["maint_1", "maint_2"]);
  });

  it("extracts updates from last_update string fallback", () => {
    const raw = {
      ongoing_incidents: [
        {
          id: "inc_3",
          name: "Test",
          status: "investigating",
          started_at: "2026-04-14T10:00:00Z",
          last_update: "We are looking into this",
          updated_at: "2026-04-14T10:30:00Z",
        },
      ],
    };
    const result = normalizeWidgetResponse(raw);
    expect(result.incidents[0].updates).toHaveLength(1);
    expect(result.incidents[0].updates[0].body).toBe("We are looking into this");
  });

  it("extracts updates from last_update object fallback", () => {
    const raw = {
      ongoing_incidents: [
        {
          id: "inc_4",
          name: "Test",
          status: "investigating",
          started_at: "2026-04-14T10:00:00Z",
          last_update: { body: "Investigating root cause", created_at: "2026-04-14T10:30:00Z" },
        },
      ],
    };
    const result = normalizeWidgetResponse(raw);
    expect(result.incidents[0].updates[0].body).toBe("Investigating root cause");
  });

  it("extracts component_id from affected_components", () => {
    const raw = {
      ongoing_incidents: [
        {
          id: "inc_5",
          name: "Test",
          status: "investigating",
          started_at: "2026-04-14T10:00:00Z",
          affected_components: [
            { component_id: "comp_abc123", name: "Hybrid Search", status: "partial_outage" },
          ],
        },
      ],
    };
    const result = normalizeWidgetResponse(raw);
    expect(result.incidents[0].components).toEqual(["comp_abc123"]);
  });
});

describe("mapComponentStatuses", () => {
  it("returns empty map for empty inputs", () => {
    expect(mapComponentStatuses([], []).size).toBe(0);
  });

  it("maps widget components to our IDs by name match", () => {
    const widgetComponents = [
      { name: "Hybrid Search", status: "operational" },
      { name: "Ingestion API", status: "degraded_performance" },
    ];
    const defaultIds = ["hybrid-search", "ingestion-api", "vector-store"];
    const result = mapComponentStatuses(widgetComponents, defaultIds);
    expect(result.get("hybrid-search")).toBe("operational");
    expect(result.get("ingestion-api")).toBe("degraded");
    expect(result.has("vector-store")).toBe(false);
  });

  it("handles case-insensitive matching", () => {
    const widgetComponents = [
      { name: "HYBRID SEARCH", status: "operational" },
    ];
    const defaultIds = ["hybrid-search"];
    const result = mapComponentStatuses(widgetComponents, defaultIds);
    expect(result.get("hybrid-search")).toBe("operational");
  });

  it("handles null/undefined in widget components array", () => {
    const widgetComponents = [null, undefined, { name: "Hybrid Search", status: "operational" }];
    const defaultIds = ["hybrid-search"];
    const result = mapComponentStatuses(widgetComponents, defaultIds);
    expect(result.get("hybrid-search")).toBe("operational");
  });

  it("normalizes all status variants correctly", () => {
    const widgetComponents = [
      { name: "Hybrid Search", status: "partial_outage" },
      { name: "Ingestion API", status: "full_outage" },
      { name: "Vector Store", status: "under_maintenance" },
    ];
    const defaultIds = ["hybrid-search", "ingestion-api", "vector-store"];
    const result = mapComponentStatuses(widgetComponents, defaultIds);
    expect(result.get("hybrid-search")).toBe("outage");
    expect(result.get("ingestion-api")).toBe("outage");
    expect(result.get("vector-store")).toBe("maintenance");
  });

  it("does not match via loose substring matching", () => {
    const widgetComponents = [
      { name: "Hybrid Search Extended", status: "degraded_performance" },
    ];
    const defaultIds = ["hybrid-search"];
    const result = mapComponentStatuses(widgetComponents, defaultIds);
    // Should NOT match because "hybrid search extended" !== "hybrid search"
    expect(result.has("hybrid-search")).toBe(false);
  });

  // -----------------------------------------------------------------------
  // componentNames parameter — new in health-checks diff
  // Tests that display names containing & and / are matched correctly.
  // -----------------------------------------------------------------------

  it("matches component with & in display name via componentNames map", () => {
    // Widget API sends "Monitor & Infra Status"; our ID is "monitor-infra-status"
    const widgetComponents = [
      { name: "Monitor & Infra Status", status: "operational" },
    ];
    const defaultIds = ["monitor-infra-status"];
    const componentNames = new Map([["monitor-infra-status", "Monitor & Infra Status"]]);

    const result = mapComponentStatuses(widgetComponents, defaultIds, componentNames);
    expect(result.get("monitor-infra-status")).toBe("operational");
  });

  it("matches component with / in display name via componentNames map", () => {
    // Widget API sends "Shared / Hive Memory"; our ID is "shared-hive-memory"
    const widgetComponents = [
      { name: "Shared / Hive Memory", status: "degraded_performance" },
    ];
    const defaultIds = ["shared-hive-memory"];
    const componentNames = new Map([["shared-hive-memory", "Shared / Hive Memory"]]);

    const result = mapComponentStatuses(widgetComponents, defaultIds, componentNames);
    expect(result.get("shared-hive-memory")).toBe("degraded");
  });

  it("matches component with & even without componentNames (via hyphen-to-space fallback)", () => {
    // "monitor-infra-status" → hyphen-to-space → "monitor infra status"
    // "Monitor & Infra Status" → normalizeName → "monitor infra status"
    // These collide so the match works even without componentNames.
    const widgetComponents = [
      { name: "Monitor & Infra Status", status: "partial_outage" },
    ];
    const defaultIds = ["monitor-infra-status"];

    const result = mapComponentStatuses(widgetComponents, defaultIds);
    expect(result.get("monitor-infra-status")).toBe("outage");
  });

  it("matches short display name that differs from hyphen-to-space form via componentNames", () => {
    // id="list-data", hyphen-to-space="list data", display name="List"
    // Widget sends "List" — only matches via componentNames entry (not hyphen-to-space).
    const widgetComponents = [
      { name: "List", status: "operational" },
    ];
    const defaultIds = ["list-data"];
    const componentNames = new Map([["list-data", "List"]]);

    const result = mapComponentStatuses(widgetComponents, defaultIds, componentNames);
    expect(result.get("list-data")).toBe("operational");
  });

  it("componentNames does NOT cause false positive for similar but different names", () => {
    // "List Sub-Tenant IDs" should not match "list-data" (whose display name is "List")
    const widgetComponents = [
      { name: "List Sub-Tenant IDs", status: "operational" },
    ];
    const defaultIds = ["list-data"];
    const componentNames = new Map([["list-data", "List"]]);

    const result = mapComponentStatuses(widgetComponents, defaultIds, componentNames);
    // "list sub-tenant ids" !== "list" — no match
    expect(result.has("list-data")).toBe(false);
  });

  it("matches multiple components with mixed punctuation via componentNames", () => {
    // Real-world scenario: multiple new component names from defaults.ts
    const widgetComponents = [
      { name: "Monitor & Infra Status", status: "operational" },
      { name: "Shared / Hive Memory", status: "degraded_performance" },
      { name: "List", status: "partial_outage" },
      { name: "Dashboard", status: "operational" },
    ];
    const defaultIds = ["monitor-infra-status", "shared-hive-memory", "list-data", "dashboard"];
    const componentNames = new Map([
      ["monitor-infra-status", "Monitor & Infra Status"],
      ["shared-hive-memory", "Shared / Hive Memory"],
      ["list-data", "List"],
      ["dashboard", "Dashboard"],
    ]);

    const result = mapComponentStatuses(widgetComponents, defaultIds, componentNames);
    expect(result.get("monitor-infra-status")).toBe("operational");
    expect(result.get("shared-hive-memory")).toBe("degraded");
    expect(result.get("list-data")).toBe("outage");
    expect(result.get("dashboard")).toBe("operational");
  });
});
