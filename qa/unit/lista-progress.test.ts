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
      aprobada: 116,
      revision: 0,
      "en-progreso": 0,
      pendiente: 5,
      bloqueada: 0,
      cancelada: 7,
    });
    // T099 was the release rehearsal. It stopped being blocked on 2026-09-07 (its dependencies were
    // already approved and the human gate had been settled the day before), the rehearsal was
    // finished the same day - runbook, baseline rebuilt from the T107 hash map and the live
    // inventory, delta re-measured - and the operator approved it. Nothing sits in `revision` any
    // more, and nothing is blocked. `en-progreso` is empty too since 2026-09-07, when T106 was
    // split the same way T011 had been: its step 1 was finished and measured on 2026-09-04, so it
    // was approved on that evidence, and step 2 - never built - became T127. A row that is half
    // done is now two rows that each say something true, rather than one that says neither.
    //
    // The five open rows are open because the work is real: T108 has no executor written,
    // T058/T059 are the release and the close-out, T126 carries the registered address T011 never
    // had, and T127 waits on three answers, two of them shared with T058.
    expect(items.filter((item) => item.status === "revision")).toEqual([]);
    expect(items.filter((item) => item.status === "en-progreso")).toEqual([]);
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
    // dropped - the field is still readable by any administrator claim with no audit trail, and the
    // DPIA's residual risk is still high. T011's act was signed later that day, per procurationem
    // (Andres Santiago, p.p. Vladimiro Afonso), which formalises the acceptance without changing
    // any of that.
    //
    // The ratio moved twice on 2026-09-07, both times by splitting a row rather than by finishing
    // work: 115/119 -> 115/120 when T011 closed and T126 took the registered address it never had,
    // then -> 116/121 when T106's finished step 1 was approved and its unbuilt step 2 became T127.
    // Splitting adds to both sides, so the percentage barely moves - which is the point. The
    // alternative in both cases was closing a row while quietly dropping what it still owed, and
    // that is the thing this board exists to make impossible.
    expect(progress).toEqual({ approved: 116, total: 121, percentage: 96 });
  });
});
