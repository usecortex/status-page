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

// Define incident patterns for each component
// Map<daysAgo, uptime_pct>
const incidentPatterns: Record<string, Map<number, number>> = {
  "hybrid-search": new Map([
    [72, 99.2],   // minor degradation 72 days ago
    [45, 94.5],   // outage 45 days ago
    [44, 98.1],   // recovery day
    [12, 99.8],   // brief blip 12 days ago
  ]),
  "full-text-search": new Map([
    [45, 95.2],   // affected by same incident as hybrid-search
    [44, 99.1],
  ]),
  "qna": new Map([
    [60, 98.5],   // degraded 60 days ago
    [30, 99.1],   // minor issue 30 days ago
  ]),
  "document-upload": new Map([
    [80, 93.2],   // outage 80 days ago
    [79, 97.5],
    [20, 99.3],
  ]),
  "content-processing": new Map([
    [80, 91.8],   // same outage as document-upload
    [79, 96.2],
  ]),
  "memory-api": new Map([
    [55, 98.7],
    [3, 99.4],    // recent minor degradation
  ]),
  "dashboard": new Map([
    [40, 97.2],
    [15, 99.6],
  ]),
  "docs-site": new Map(),  // perfect uptime
  "website": new Map([
    [25, 99.1],
  ]),
};

const components: StatusComponent[] = [
  { id: "hybrid-search", name: "Hybrid Search", status: "operational" },
  { id: "full-text-search", name: "Full-Text Search", status: "operational" },
  { id: "qna", name: "QnA", status: "operational" },
  { id: "document-upload", name: "Document Upload", status: "operational" },
  { id: "content-processing", name: "Content Processing", status: "operational" },
  { id: "memory-api", name: "Memory API", status: "degraded" },  // currently degraded
  { id: "dashboard", name: "Dashboard", status: "operational" },
  { id: "docs-site", name: "Docs Site", status: "operational" },
  { id: "website", name: "Website", status: "operational" },
].map(c => {
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
  { id: "query-retrieval", name: "Query & Retrieval", components: components.filter(c => ["hybrid-search", "full-text-search", "qna"].includes(c.id)) },
  { id: "knowledge-ingestion", name: "Knowledge Ingestion", components: components.filter(c => ["document-upload", "content-processing"].includes(c.id)) },
  { id: "memories", name: "Memories", components: components.filter(c => c.id === "memory-api") },
  { id: "dashboard", name: "Dashboard", components: components.filter(c => c.id === "dashboard") },
  { id: "documentation", name: "Documentation", components: components.filter(c => c.id === "docs-site") },
  { id: "website", name: "Website", components: components.filter(c => c.id === "website") },
];

// Create a recent active incident on Memory API
const now = new Date();
const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

const snapshot = {
  generated_at: now.toISOString(),
  configured: true,
  overall_status: "degraded",  // because Memory API is degraded
  component_groups: groups,
  incidents: [
    {
      id: "inc_memory_api_degraded",
      name: "Elevated latency on Memory API",
      status: "identified",
      started_at: threeHoursAgo.toISOString(),
      components: ["memory-api"],
      updates: [
        {
          body: "We have identified the root cause as a connection pool exhaustion issue. The team is working on a fix.",
          created_at: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
        },
        {
          body: "We are investigating reports of elevated latency on the Memory API. Some requests may be slower than usual.",
          created_at: threeHoursAgo.toISOString(),
        },
      ],
    },
  ],
  maintenance_windows: [
    {
      id: "maint_db_migration",
      name: "Database schema migration - Knowledge Ingestion",
      status: "scheduled",
      starts_at: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      ends_at: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
      updates: [
        {
          body: "Scheduled maintenance for database schema migration. Document Upload and Content Processing may experience brief interruptions.",
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
console.log(`Overall status: ${snapshot.overall_status}`);
console.log(`Memory API status: ${components.find(c => c.id === "memory-api")?.status}`);
console.log(`Hybrid Search 90d uptime: ${components.find(c => c.id === "hybrid-search")?.uptime["90d"]}%`);
