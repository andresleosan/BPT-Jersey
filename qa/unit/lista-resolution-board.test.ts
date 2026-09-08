import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import "../../Lista/Lista.js";

type ListaItem = { id: string; status: string };
type ListaProject = {
  projectData: { stages: unknown };
  flattenItems: (stages: unknown) => ListaItem[];
  getResolutionRequirements: (item: ListaItem) => readonly string[];
  renderProject: (document: Document) => boolean;
};
type JSDOMInstance = { window: Window };
type JSDOMConstructor = new (html: string, options?: { url: string }) => JSDOMInstance;

const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: JSDOMConstructor };
const project = (globalThis as typeof globalThis & { ListaProject: ListaProject }).ListaProject;

/**
 * "What is missing to resolve" lists the rows that still owe work: approved rows are done and
 * cancelled rows are decisions already taken, so neither belongs here.
 */
function unresolved(): ListaItem[] {
  return project
    .flattenItems(project.projectData.stages)
    .filter((item) => item.status !== "aprobada" && item.status !== "cancelada");
}

describe("Lista resolution board", () => {
  it("provides concrete resolution requirements for every unresolved task", () => {
    const items = unresolved();

    expect(items.map((item) => item.id).sort()).toEqual(["T058", "T059", "T108", "T127"]);
    for (const item of items) {
      expect(project.getResolutionRequirements(item)).toEqual(
        expect.arrayContaining([expect.any(String)]),
      );
    }
  });

  it("renders one detailed resolution entry per unresolved task", () => {
    const dom = new JSDOM(
      readFileSync(new URL("../../Lista/Lista.html", import.meta.url), "utf8"),
      {
        url: "http://localhost/Lista/Lista.html",
      },
    );
    const resolutionBoard = dom.window.document.createElement("section");
    resolutionBoard.innerHTML = '<div id="resolution-list"></div>';
    dom.window.document.body.append(resolutionBoard);

    const runtime = globalThis as unknown as { window: Window; document: Document };
    const previousWindow = runtime.window;
    const previousDocument = runtime.document;
    runtime.window = dom.window;
    runtime.document = dom.window.document;

    try {
      expect(project.renderProject(dom.window.document)).toBe(true);
      const entries = dom.window.document.querySelectorAll("[data-resolution-item]");
      expect(entries).toHaveLength(unresolved().length);
      expect([...entries].map((entry) => entry.getAttribute("data-resolution-item"))).not.toContain(
        "T017",
      );
      expect(dom.window.document.querySelector("#resolution-board")?.textContent).toContain(
        "Qué falta para resolver",
      );
    } finally {
      runtime.window = previousWindow;
      runtime.document = previousDocument;
    }
  });

  it("does not expose mojibake markers in the project data", () => {
    expect(JSON.stringify(project.projectData)).not.toMatch(/[ÃÂƒ�]/u);
  });
});
