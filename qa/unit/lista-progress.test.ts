import { describe, expect, it } from "vitest";

import "../../Lista/Lista.js";

type ListaItem = { id: string; status: string };
type ListaProgress = { approved: number; total: number; percentage: number };
type ListaProject = {
  projectData: { stages: unknown };
  flattenItems: (stages: unknown) => ListaItem[];
  countStatuses: (items: ListaItem[]) => Record<string, number>;
  getGlobalProgress: (items: ListaItem[]) => ListaProgress;
};

const project = (globalThis as typeof globalThis & { ListaProject: ListaProject }).ListaProject;

describe("Lista project progress", () => {
  const items = project.flattenItems(project.projectData.stages);
  const counts = project.countStatuses(items);

  /**
   * The original defect this test was written for: `revision` was misspelled in the board's status
   * vocabulary, so eight tasks fell out of the breakdown and the percentage lied. `revision` is
   * legitimately empty again after the operator approved the last three rows on 2026-09-06 - and
   * asserting a count of zero would no longer catch the defect. What still catches it is the
   * vocabulary itself: every status a task declares must be a status the board knows how to count.
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

  it("reflects the board as of 2026-09-07", () => {
    expect(counts).toEqual({
      aprobada: 114,
      revision: 0,
      "en-progreso": 2,
      pendiente: 3,
      bloqueada: 0,
      cancelada: 7,
    });
    // T099 stopped being blocked on 2026-09-07: its four dependencies were already approved and
    // the human gate it waited on - a designated decision owner and reviewer for T011 - was
    // settled on 2026-09-06, leaving only spend. The operator then cut its scope to a release
    // rehearsal, so it is work in progress rather than a row waiting on somebody. No row is
    // blocked any more, which is worth noticing rather than celebrating: the five that remain
    // are open because the work is real, not because permission is missing.
    expect(items.filter((item) => item.status === "en-progreso")).toEqual([
      expect.objectContaining({ id: "T099" }),
      expect.objectContaining({ id: "T106" }),
    ]);
  });

  /**
   * The operator cancelled six vision rows on 2026-09-06 and asked for the counter to exclude them.
   * A cancelled row is a decision already taken, not pending work, so it leaves both sides of the
   * ratio - while `countStatuses` keeps reporting it, so the cancellations are never hidden.
   */
  it("keeps cancelled rows out of the ratio but visible in the breakdown", () => {
    const cancelled = items.filter((item) => item.status === "cancelada");
    const progress = project.getGlobalProgress(items);

    expect(cancelled.map((item) => item.id).sort()).toEqual([
      "T017",
      "T036",
      "T061",
      "T068",
      "T069",
      "T070",
      "T071",
    ]);
    expect(counts.cancelada).toBe(cancelled.length);
    expect(progress.total).toBe(items.length - cancelled.length);
    // T125 closed on 2026-09-07 by operator decision, not by code: the cleartext Regyfit passwords
    // stay as they are and the risk is accepted in writing, because the data is real, the office
    // works from it and the administrator already has permission to use it. Counting that as
    // approved is honest only because what was accepted is written down rather than quietly
    // dropped - the field is still readable by any administrator claim with no audit trail, the
    // DPIA's residual risk is still high, and the signature that formalises the acceptance belongs
    // to T011's act, which is still unsigned.
    expect(progress).toEqual({ approved: 114, total: 119, percentage: 96 });
  });
});
