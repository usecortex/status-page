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

// Import component definitions from the single source of truth in defaults.ts.
// We use require() because this script runs with ts-node in CommonJS mode.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DEFAULT_COMPONENTS, DEFAULT_COMPONENT_GROUPS } = require("../src/lib/defaults");

const componentDefs: Array<{ id: string; name: string; status: string }> = (DEFAULT_COMPONENTS as Array<{ id: string; name: string }>).map(
  (c: { id: string; name: string }) => ({
    id: c.id,
    name: c.name,
    // Override status for test scenario: user-memory shows as degraded
    status: c.id === "user-memory" ? "degraded" : "operational",
  }),
);

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

// Derive groups from DEFAULT_COMPONENT_GROUPS, replacing component definitions
// with the enriched versions that include daily_history and uptime metrics.
const componentById = new Map(components.map(c => [c.id, c]));
const groups: ComponentGroup[] = (DEFAULT_COMPONENT_GROUPS as ComponentGroup[]).map(
  (group: ComponentGroup) => ({
    id: group.id,
    name: group.name,
    components: group.components
      .map((c: { id: string }) => componentById.get(c.id))
      .filter((c: StatusComponent | undefined): c is StatusComponent => !!c),
  }),
);

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
