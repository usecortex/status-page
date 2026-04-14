/**
 * Generates a realistic status.json snapshot for end-to-end testing.
 * Simulates 90 days of uptime history with a few incidents sprinkled in.
 *
 * Usage: npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node"}' scripts/generate-test-data.ts
 */

interface DailyUptime {
  date: string;
  status: string;
  uptime_pct: number;
}

interface StatusComponent {
  id: string;
  name: string;
  status: string;
  uptime: { "30d": number; "60d": number; "90d": number };
  daily_history: DailyUptime[];
}

interface ComponentGroup {
  id: string;
  name: string;
  components: StatusComponent[];
}

function generateDailyHistory(daysBack: number, incidentDays: Map<number, number>): DailyUptime[] {
  const history: DailyUptime[] = [];
  const now = new Date();

  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().split("T")[0];

    let uptime_pct = 100;
    if (incidentDays.has(i)) {
      uptime_pct = incidentDays.get(i)!;
    }

    let status = "operational";
    if (uptime_pct < 95) status = "outage";
    else if (uptime_pct < 99.5) status = "degraded";

    history.push({ date, status, uptime_pct: Math.round(uptime_pct * 100) / 100 });
  }

  return history;
}

function computeRolling(history: DailyUptime[], days: number): number {
  const slice = history.slice(-days);
  if (slice.length === 0) return 100;
  const avg = slice.reduce((sum, d) => sum + d.uptime_pct, 0) / slice.length;
  return Math.round(avg * 100) / 100;
}

// Define incident patterns for select components
const incidentPatterns: Record<string, Map<number, number>> = {
  "full-recall": new Map([
    [72, 99.2],
    [45, 94.5],
    [44, 98.1],
    [12, 99.8],
  ]),
  "memory-recall": new Map([
    [45, 95.2],
    [44, 99.1],
  ]),
  "lexical-recall": new Map([
    [45, 96.8],
  ]),
  "knowledge-base": new Map([
    [80, 93.2],
    [79, 97.5],
    [20, 99.3],
  ]),
  "verify-processing": new Map([
    [80, 91.8],
    [79, 96.2],
  ]),
  "user-memory": new Map([
    [55, 98.7],
    [3, 99.4],
  ]),
  "dashboard": new Map([
    [40, 97.2],
    [15, 99.6],
  ]),
  "search-embeddings": new Map([
    [25, 99.1],
  ]),
};

const componentDefs = [
  // Tenants
  { id: "create-tenant", name: "Create Tenant", status: "operational" },
  { id: "monitor-infra-status", name: "Monitor & Infra Status", status: "operational" },
  { id: "list-sub-tenant-ids", name: "List Sub-Tenant IDs", status: "operational" },
  { id: "delete-tenant", name: "Delete Tenant", status: "operational" },
  // Memories
  { id: "user-memory", name: "User Memory", status: "degraded" },
  { id: "knowledge-base", name: "Knowledge Base", status: "operational" },
  { id: "shared-hive-memory", name: "Shared / Hive Memory", status: "operational" },
  // Recall
  { id: "full-recall", name: "Full Recall", status: "operational" },
  { id: "memory-recall", name: "Memory Recall", status: "operational" },
  { id: "lexical-recall", name: "Lexical Recall", status: "operational" },
  // Ingestion
  { id: "verify-processing", name: "Verify Processing", status: "operational" },
  // Manage Memories
  { id: "list-data", name: "List", status: "operational" },
  { id: "fetch-content", name: "Fetch Content", status: "operational" },
  { id: "graph-relations", name: "Graph Relations", status: "operational" },
  { id: "delete-user-memory", name: "Delete User Memory", status: "operational" },
  { id: "delete-knowledge", name: "Delete Knowledge", status: "operational" },
  // Custom Embeddings
  { id: "add-embeddings", name: "Add Embeddings", status: "operational" },
  { id: "search-embeddings", name: "Search Embeddings", status: "operational" },
  { id: "filter-raw-embeddings", name: "Filter Raw Embeddings", status: "operational" },
  { id: "delete-embeddings", name: "Delete Embeddings", status: "operational" },
  // Dashboard
  { id: "dashboard", name: "Dashboard", status: "operational" },
];

const components: StatusComponent[] = componentDefs.map(c => {
  const history = generateDailyHistory(90, incidentPatterns[c.id] || new Map());
  return {
    ...c,
    uptime: {
      "30d": computeRolling(history, 30),
      "60d": computeRolling(history, 60),
      "90d": computeRolling(history, 90),
    },
    daily_history: history,
  };
});

const groups: ComponentGroup[] = [
  { id: "tenants", name: "Tenants", components: components.filter(c => ["create-tenant", "monitor-infra-status", "list-sub-tenant-ids", "delete-tenant"].includes(c.id)) },
  { id: "memories", name: "Memories", components: components.filter(c => ["user-memory", "knowledge-base", "shared-hive-memory"].includes(c.id)) },
  { id: "recall", name: "Recall", components: components.filter(c => ["full-recall", "memory-recall", "lexical-recall"].includes(c.id)) },
  { id: "ingestion", name: "Ingestion", components: components.filter(c => ["verify-processing"].includes(c.id)) },
  { id: "manage-memories", name: "Manage Memories", components: components.filter(c => ["list-data", "fetch-content", "graph-relations", "delete-user-memory", "delete-knowledge"].includes(c.id)) },
  { id: "custom-embeddings", name: "Custom Embeddings", components: components.filter(c => ["add-embeddings", "search-embeddings", "filter-raw-embeddings", "delete-embeddings"].includes(c.id)) },
  { id: "dashboard", name: "Dashboard", components: components.filter(c => c.id === "dashboard") },
];

// Create a recent active incident on User Memory
const now = new Date();
const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

const snapshot = {
  generated_at: now.toISOString(),
  configured: true,
  overall_status: "degraded",
  component_groups: groups,
  incidents: [
    {
      id: "inc_user_memory_degraded",
      name: "Elevated latency on User Memory API",
      status: "identified",
      started_at: threeHoursAgo.toISOString(),
      components: ["user-memory"],
      updates: [
        {
          body: "We have identified the root cause as a connection pool exhaustion issue. The team is working on a fix.",
          created_at: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
        },
        {
          body: "We are investigating reports of elevated latency on the User Memory API. Some requests may be slower than usual.",
          created_at: threeHoursAgo.toISOString(),
        },
      ],
    },
  ],
  maintenance_windows: [
    {
      id: "maint_embeddings_upgrade",
      name: "Embeddings index upgrade",
      status: "scheduled",
      starts_at: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      ends_at: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
      updates: [
        {
          body: "Scheduled maintenance for embeddings index upgrade. Custom Embeddings endpoints may experience brief interruptions.",
          created_at: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    },
  ],
};

const fs = require("fs");
const path = require("path");
const outPath = path.join(__dirname, "..", "public", "status.json");
fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
console.log(`Written ${outPath} (${(JSON.stringify(snapshot).length / 1024).toFixed(1)} KB)`);
console.log(`Components: ${components.length}`);
console.log(`Groups: ${groups.length}`);
console.log(`Incidents: ${snapshot.incidents.length}`);
console.log(`Maintenance: ${snapshot.maintenance_windows.length}`);
