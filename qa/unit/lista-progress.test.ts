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
  const items = project.flattenItems(project.projectData.stages);
  const counts = project.countStatuses(items);

  /**
   * The original defect this test was written for: `revision` was misspelled in the board's status
   * vocabulary, so eight tasks fell out of the breakdown and the percentage lied. On 2026-09-05 the
   * operator approved the last eleven rows, so `revision` is now legitimately empty - and asserting
   * a count of zero would no longer catch the defect. What still catches it is the vocabulary
   * itself: every status a task declares must be a status the board knows how to count.
   */
  it("knows every status its own tasks declare", () => {
    const unknown = [...new Set(items.map((item) => item.status))]
      .filter((status) => !Object.hasOwn(counts, status))
      .sort();

    expect(
      unknown,
      `Lista/Lista.js declares tasks with status ${unknown.join(", ")}, which VALID_STATUSES does ` +
        "not list, so they vanish from the breakdown and the percentage.",
    ).toEqual([]);
    expect(Object.hasOwn(counts, "revision")).toBe(true);
  });

  it("counts every task exactly once", () => {
    const countedItems = Object.values(counts).reduce((total, count) => total + count, 0);
    expect(countedItems).toBe(items.length);
  });

  it("reflects the board as of 2026-09-05", () => {
    expect(counts).toEqual({
      aprobada: 101,
      revision: 2,
      "en-progreso": 1,
      pendiente: 11,
      bloqueada: 2,
      cancelada: 1,
    });
    expect(items.filter((item) => item.status === "en-progreso")).toEqual([
      expect.objectContaining({ id: "T106" }),
    ]);
  });
});
