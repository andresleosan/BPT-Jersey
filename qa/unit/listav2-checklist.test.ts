import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "../../Listav2/Listav2.js";

type Requirement = { text: string; done: boolean };
type BoardItem = { id: string; status: string };
type ListaV2Project = {
  projectData: { stages: unknown };
  flattenItems: (stages: unknown) => BoardItem[];
  isClosedStatus: (status: string) => boolean;
  getResolutionRequirements: (item: BoardItem) => readonly Requirement[];
  renderProject: (document: Document) => boolean;
  checklistProgress: (item: BoardItem) => { done: number; total: number };
  countChecklist: (items: BoardItem[]) => { done: number; total: number };
  RESOLUTION_NOTES: Readonly<Record<string, string>>;
};
type JSDOMInstance = { window: Window & typeof globalThis };
type JSDOMConstructor = new (html: string, options?: { url: string }) => JSDOMInstance;

const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: JSDOMConstructor };
const project = (globalThis as typeof globalThis & { ListaV2Project: ListaV2Project })
  .ListaV2Project;

type Runtime = { window: unknown; document: unknown };
const runtime = globalThis as unknown as Runtime;
let previous: Runtime;

function mount(): Document {
  const dom = new JSDOM(
    readFileSync(new URL("../../Listav2/Listav2.html", import.meta.url), "utf8"),
    { url: "http://localhost/Listav2/Listav2.html" },
  );
  previous = { window: runtime.window, document: runtime.document };
  runtime.window = dom.window;
  runtime.document = dom.window.document;
  return dom.window.document;
}

/**
 * Se le pregunta al motor cual es una fila cerrada en vez de repetir aqui la lista de estados.
 * Repetirla ya costo un fallo: al anadir `desplegada` el tablero dejo de pedir requisitos a las dos
 * filas ya desplegadas y esta prueba seguia contandolos, porque tenia su propia copia de la regla.
 */
function unresolved(): BoardItem[] {
  return project
    .flattenItems(project.projectData.stages)
    .filter((item) => !project.isClosedStatus(item.status));
}

function requirementsOf(document: Document, taskId: string): HTMLElement[] {
  const entry = document.querySelector(`[data-resolution-item="${taskId}"]`);
  return [...(entry?.querySelectorAll<HTMLElement>(".resolution-requirement") ?? [])];
}

describe("Listav2 resolution checklist", () => {
  let document: Document;

  beforeEach(() => {
    document = mount();
    expect(project.renderProject(document)).toBe(true);
  });

  afterEach(() => {
    runtime.window = previous.window;
    runtime.document = previous.document;
  });

  it("renders one box per requirement of every unresolved row", () => {
    const expected = unresolved().reduce(
      (total, item) => total + project.getResolutionRequirements(item).length,
      0,
    );

    expect(expected).toBeGreaterThan(0);
    expect(document.querySelectorAll(".requirement-box")).toHaveLength(expected);
  });

  /**
   * The whole point of this board: a tick is a claim about the project, so it is made in the
   * repository where it has an author and a diff, never from the page. A real form control would
   * invite someone to change it, and that change would live only in their own browser.
   */
  it("offers nothing to click: the boxes are not form controls", () => {
    const board = document.querySelector("#resolution-list")!;
    expect(board.querySelectorAll("input")).toHaveLength(0);
    expect(board.querySelectorAll("button")).toHaveLength(0);
    expect(document.querySelector("[data-checklist-reset]")).toBeNull();
  });

  it("writes X in a resolved box and leaves a pending one empty", () => {
    for (const item of unresolved()) {
      const requirements = project.getResolutionRequirements(item);
      const rendered = requirementsOf(document, item.id);
      expect(rendered).toHaveLength(requirements.length);

      requirements.forEach((requirement, index) => {
        const box = rendered[index]!.querySelector(".requirement-box")!;
        expect(box.textContent, `${item.id} #${index + 1}`).toBe(requirement.done ? "X" : "");
        expect(rendered[index]!.classList.contains("requirement-done")).toBe(requirement.done);
      });
    }
  });

  it("labels each box for a screen reader, which cannot see an X", () => {
    for (const box of document.querySelectorAll(".requirement-box")) {
      expect(["Resuelto:", "Pendiente:"]).toContain(box.getAttribute("aria-label"));
    }
  });

  it("counts resolved requirements per row", () => {
    for (const item of unresolved()) {
      const progress = project.checklistProgress(item);
      const counter = document.querySelector(
        `[data-resolution-item="${item.id}"] .resolution-item-progress`,
      );
      expect(counter?.textContent, item.id).toBe(`${progress.done}/${progress.total}`);
    }
  });

  it("marks a row complete only when every requirement of it is resolved", () => {
    for (const item of unresolved()) {
      const { done, total } = project.checklistProgress(item);
      const entry = document.querySelector(`[data-resolution-item="${item.id}"]`)!;
      expect(entry.classList.contains("resolution-item-complete"), item.id).toBe(
        total > 0 && done === total,
      );
    }
  });

  it("reports the global total in the summary", () => {
    const { done, total } = project.countChecklist(unresolved());
    const summary = document.querySelector("[data-checklist-summary]");

    expect(summary?.textContent).toBe(
      `${done} de ${total} requisitos resueltos en ${unresolved().length} tareas.`,
    );
  });

  it("shows the findings as a note, separate from the actions", () => {
    // A finding is a fact, not a task: it cannot be completed, so it must not sit in a list whose
    // whole purpose is to say what is left to do.
    //
    // Solo se afirma sobre las filas que este tablero pinta. Una fila cerrada conserva su nota
    // -sigue siendo cierta, y su tarjeta la sigue mostrando- pero desaparece de "que falta para
    // resolver", porque no falta nada.
    const open = new Set(unresolved().map((item) => item.id));
    for (const [id, note] of Object.entries(project.RESOLUTION_NOTES)) {
      if (!open.has(id)) continue;
      const rendered = document.querySelector(
        `[data-resolution-item="${id}"] .resolution-item-note`,
      );
      expect(rendered?.textContent, id).toContain(note);
    }
  });
});

describe("Listav2 checklist data", () => {
  it("gives every requirement a text and an explicit boolean", () => {
    const malformed: string[] = [];
    for (const item of unresolved()) {
      project.getResolutionRequirements(item).forEach((requirement, index) => {
        const ok =
          typeof requirement.text === "string" &&
          requirement.text.length > 0 &&
          typeof requirement.done === "boolean";
        if (!ok) malformed.push(`${item.id} #${index + 1}`);
      });
    }

    expect(malformed, `Requirements that are not {text, done}: ${malformed.join(", ")}`).toEqual(
      [],
    );
  });

  it("attaches every note to a row that exists on the board", () => {
    // Se compara contra TODAS las filas, no solo las abiertas: lo que hay que cazar es una nota
    // colgada de un id que no existe. Que una fila se cierre no invalida lo que se averiguo de
    // ella, y su tarjeta lo sigue mostrando.
    const ids = new Set(project.flattenItems(project.projectData.stages).map((item) => item.id));
    const orphans = Object.keys(project.RESOLUTION_NOTES).filter((id) => !ids.has(id));

    expect(orphans, `Notes attached to unknown rows: ${orphans.join(", ")}`).toEqual([]);
  });

  /**
   * A row stays fully resolved yet still open only for as long as nobody has updated the ledger.
   * Catching it here is the point: the board is telling us the row is ready to close.
   */
  it("names any row whose requirements are all resolved but whose status has not moved", () => {
    const ready = unresolved()
      .filter((item) => {
        const { done, total } = project.checklistProgress(item);
        return total > 0 && done === total;
      })
      .map((item) => item.id);

    expect(
      ready,
      `Every requirement of ${ready.join(", ")} is resolved. Move the row forward in ` +
        "tasksv2.md, or add the requirement that is actually still missing.",
    ).toEqual([]);
  });
});
