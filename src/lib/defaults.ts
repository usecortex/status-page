import { ComponentGroup, StatusComponent } from "@/types/status";

/** Default component definitions for HydraDB */
export const DEFAULT_COMPONENTS: StatusComponent[] = [
  { id: "hybrid-search", name: "Hybrid Search", status: "operational", uptime: { "30d": 100, "60d": 100, "90d": 100 }, daily_history: [] },
  { id: "full-text-search", name: "Full-Text Search", status: "operational", uptime: { "30d": 100, "60d": 100, "90d": 100 }, daily_history: [] },
  { id: "qna", name: "QnA", status: "operational", uptime: { "30d": 100, "60d": 100, "90d": 100 }, daily_history: [] },
  { id: "document-upload", name: "Document Upload", status: "operational", uptime: { "30d": 100, "60d": 100, "90d": 100 }, daily_history: [] },
  { id: "content-processing", name: "Content Processing", status: "operational", uptime: { "30d": 100, "60d": 100, "90d": 100 }, daily_history: [] },
  { id: "memory-api", name: "Memory API", status: "operational", uptime: { "30d": 100, "60d": 100, "90d": 100 }, daily_history: [] },
  { id: "dashboard", name: "Dashboard", status: "operational", uptime: { "30d": 100, "60d": 100, "90d": 100 }, daily_history: [] },
  { id: "docs-site", name: "Docs Site", status: "operational", uptime: { "30d": 100, "60d": 100, "90d": 100 }, daily_history: [] },
  { id: "website", name: "Website", status: "operational", uptime: { "30d": 100, "60d": 100, "90d": 100 }, daily_history: [] },
];

export const DEFAULT_COMPONENT_GROUPS: ComponentGroup[] = [
  { id: "query-retrieval", name: "Query & Retrieval", components: DEFAULT_COMPONENTS.filter(c => ["hybrid-search", "full-text-search", "qna"].includes(c.id)) },
  { id: "knowledge-ingestion", name: "Knowledge Ingestion", components: DEFAULT_COMPONENTS.filter(c => ["document-upload", "content-processing"].includes(c.id)) },
  { id: "memories", name: "Memories", components: DEFAULT_COMPONENTS.filter(c => c.id === "memory-api") },
  { id: "dashboard", name: "Dashboard", components: DEFAULT_COMPONENTS.filter(c => c.id === "dashboard") },
  { id: "documentation", name: "Documentation", components: DEFAULT_COMPONENTS.filter(c => c.id === "docs-site") },
  { id: "website", name: "Website", components: DEFAULT_COMPONENTS.filter(c => c.id === "website") },
];
