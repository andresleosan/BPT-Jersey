import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import "../../Lista/Lista.js";

type ListaProject = {
  projectData: {
    evidenceSyncDates: Readonly<Record<string, string>>;
    stages: unknown;
  };
  flattenItems: (stages: unknown) => { id: string }[];
};

const project = (globalThis as typeof globalThis & { ListaProject: ListaProject }).ListaProject;

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

function readProjectFile(relativePath: string): string {
  return readFileSync(
    new URL(relativePath, `file:///${projectRoot.replaceAll("\\", "/")}/`),
    "utf8",
  );
}

/**
 * The board and the ledger drifted apart on 2026-09-04: `tasks.md` recorded new evidence for T093,
 * T098 and T106 while `Lista/Lista.js` still described the previous cut. Nothing caught it, because
 * the other two Lista tests only compare statuses and counts, and no status had changed.
 *
 * This test closes that gap. It reads the dated evidence headings out of `tasks.md`, takes the most
 * recent date per task, and requires the board to declare that it reflects at least that date.
 */
const taskIdPattern = /\bT\d{3}\b/gu;
const datePattern = /\b(\d{4}-\d{2}-\d{2})\b/gu;

function latestEvidenceDates(ledger: string): Map<string, string> {
  const latest = new Map<string, string>();
  for (const line of ledger.split("\n")) {
    if (!line.startsWith("### ")) continue;
    const ids = line.match(taskIdPattern);
    const dates = line.match(datePattern);
    // A heading without a date cannot be compared, and one without a task ID is not task evidence.
    if (ids === null || dates === null) continue;
    const newest = [...dates].sort().at(-1)!;
    for (const id of ids) {
      if ((latest.get(id) ?? "") < newest) latest.set(id, newest);
    }
  }
  return latest;
}

describe("Lista evidence stays in step with the ledger", () => {
  const ledger = readProjectFile("tasks.md");
  const latest = latestEvidenceDates(ledger);
  const declared = project.projectData.evidenceSyncDates;

  it("finds dated evidence headings to compare", () => {
    // Guards the parser itself: a refactor of the ledger's heading style would otherwise make
    // this whole test vacuously pass.
    expect(latest.size).toBeGreaterThan(50);
  });

  it("declares a reflected evidence date for every task the ledger dates", () => {
    const undeclared = [...latest.keys()].filter((id) => declared[id] === undefined).sort();

    expect(
      undeclared,
      `tasks.md dates evidence for ${undeclared.join(", ")} but Lista/Lista.js declares no ` +
        "evidenceSyncDates entry. Add the task's evidence to Lista and record its date.",
    ).toEqual([]);
  });

  it("is never behind the newest evidence recorded in tasks.md", () => {
    const stale = [...latest.entries()]
      .filter(([id, date]) => declared[id] !== undefined && declared[id]! < date)
      .map(([id, date]) => `${id}: ledger ${date} > board ${declared[id]}`)
      .sort();

    expect(
      stale,
      "tasks.md records newer evidence than Lista/Lista.js reflects:\n" +
        stale.map((line) => `  ${line}`).join("\n") +
        "\nUpdate the task's evidence in Lista/Lista.js and move its evidenceSyncDates entry " +
        "forward in the same edit.",
    ).toEqual([]);
  });

  it("declares dates only for tasks the board actually lists", () => {
    const listed = new Set(project.flattenItems(project.projectData.stages).map((item) => item.id));
    const orphaned = Object.keys(declared)
      .filter((id) => !listed.has(id))
      .sort();

    expect(
      orphaned,
      `evidenceSyncDates names ${orphaned.join(", ")}, which the board does not list. ` +
        "Either add the task row or drop the entry.",
    ).toEqual([]);
  });
});
