import { DEFAULT_COMPONENTS, DEFAULT_COMPONENT_GROUPS } from "@/lib/defaults";

describe("defaults integrity", () => {
  it("every DEFAULT_COMPONENT is in exactly one group", () => {
    const allGroupedIds = DEFAULT_COMPONENT_GROUPS.flatMap(g => g.components.map(c => c.id));
    
    // No duplicates
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const id of allGroupedIds) {
      if (seen.has(id)) dupes.push(id);
      seen.add(id);
    }
    expect(dupes).toEqual([]);
    
    // No orphaned components
    const allComponentIds = new Set(DEFAULT_COMPONENTS.map(c => c.id));
    const groupedIds = new Set(allGroupedIds);
    const ungrouped = [...allComponentIds].filter(id => !groupedIds.has(id));
    expect(ungrouped).toEqual([]);
    
    // No extra IDs in groups
    const extraInGroups = [...groupedIds].filter(id => !allComponentIds.has(id));
    expect(extraInGroups).toEqual([]);
  });
  
  it("all DEFAULT_COMPONENTS have valid initial state", () => {
    for (const c of DEFAULT_COMPONENTS) {
      expect(c.status).toBe("operational");
      expect(c.uptime["30d"]).toBe(100);
      expect(c.uptime["60d"]).toBe(100);
      expect(c.uptime["90d"]).toBe(100);
      expect(Array.isArray(c.daily_history)).toBe(true);
    }
  });
});
