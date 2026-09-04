import { describe, expect, it } from "vitest";

import "../../Lista/Lista.js";

type ListaItem = { id: string; status: string };
type ListaProject = {
  projectData: { stages: unknown };
  flattenItems: (stages: unknown) => ListaItem[];
  countStatuses: (items: ListaItem[]) => Record<string, number>;
};

const project = (globalThis as typeof globalThis & { ListaProject: ListaProject }).ListaProject;

describe("Lista project progress", () => {
  it("counts revision tasks instead of dropping the canonical revision status", () => {
    const items = project.flattenItems(project.projectData.stages);
    const counts = project.countStatuses(items);
    const countedItems = Object.values(counts).reduce((total, count) => total + count, 0);

    expect(counts.revision).toBe(11);
    expect(items.filter((item) => item.status === "en-progreso")).toEqual([
      expect.objectContaining({ id: "T093" }),
    ]);
    expect(countedItems).toBe(items.length);
  });
});
