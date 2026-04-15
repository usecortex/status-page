import type { ComponentGroup, StatusComponent } from "@/types/status";

const op = (id: string, name: string): StatusComponent => ({
  id,
  name,
  status: "operational",
  uptime: { "30d": 100, "60d": 100, "90d": 100 },
  daily_history: [],
});

/** Default component definitions for HydraDB — matches docs.hydradb.com API Reference */
export const DEFAULT_COMPONENTS: StatusComponent[] = [
  // Tenants
  op("create-tenant", "Create Tenant"),
  op("monitor-infra-status", "Monitor & Infra Status"),
  op("list-sub-tenant-ids", "List Sub-Tenant IDs"),
  op("delete-tenant", "Delete Tenant"),
  // Memories
  op("user-memory", "User Memory"),
  op("knowledge-base", "Knowledge Base"),
  op("shared-hive-memory", "Shared / Hive Memory"),
  // Recall
  op("full-recall", "Full Recall"),
  op("memory-recall", "Memory Recall"),
  op("lexical-recall", "Lexical Recall"),
  // Ingestion
  op("verify-processing", "Verify Processing"),
  // Manage Memories
  op("list-data", "List"),
  op("fetch-content", "Fetch Content"),
  op("graph-relations", "Graph Relations"),
  op("delete-user-memory", "Delete User Memory"),
  op("delete-knowledge", "Delete Knowledge"),
  // Custom Embeddings
  op("add-embeddings", "Add Embeddings"),
  op("search-embeddings", "Search Embeddings"),
  op("filter-raw-embeddings", "Filter Raw Embeddings"),
  op("delete-embeddings", "Delete Embeddings"),
  // Dashboard
  op("dashboard", "Dashboard"),
];

export const DEFAULT_COMPONENT_GROUPS: ComponentGroup[] = [
  {
    id: "tenants",
    name: "Tenants",
    components: DEFAULT_COMPONENTS.filter((c) =>
      ["create-tenant", "monitor-infra-status", "list-sub-tenant-ids", "delete-tenant"].includes(c.id),
    ),
  },
  {
    id: "memories",
    name: "Memories",
    components: DEFAULT_COMPONENTS.filter((c) =>
      ["user-memory", "knowledge-base", "shared-hive-memory"].includes(c.id),
    ),
  },
  {
    id: "recall",
    name: "Recall",
    components: DEFAULT_COMPONENTS.filter((c) =>
      ["full-recall", "memory-recall", "lexical-recall"].includes(c.id),
    ),
  },
  {
    id: "ingestion",
    name: "Ingestion",
    components: DEFAULT_COMPONENTS.filter((c) => c.id === "verify-processing"),
  },
  {
    id: "manage-memories",
    name: "Manage Memories",
    components: DEFAULT_COMPONENTS.filter((c) =>
      ["list-data", "fetch-content", "graph-relations", "delete-user-memory", "delete-knowledge"].includes(c.id),
    ),
  },
  {
    id: "custom-embeddings",
    name: "Custom Embeddings",
    components: DEFAULT_COMPONENTS.filter((c) =>
      ["add-embeddings", "search-embeddings", "filter-raw-embeddings", "delete-embeddings"].includes(c.id),
    ),
  },
  {
    id: "dashboard",
    name: "Dashboard",
    components: DEFAULT_COMPONENTS.filter((c) => c.id === "dashboard"),
  },
];
