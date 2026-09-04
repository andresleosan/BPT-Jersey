import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import "../../Lista/Lista.js";

type ListaItem = { status: string };
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

describe("Lista resolution board", () => {
  it("provides concrete resolution requirements for every non-approved task", () => {
    const items = project.flattenItems(project.projectData.stages);
    const unresolved = items.filter((item) => item.status !== "aprobada");

    expect(unresolved).toHaveLength(22);
    for (const item of unresolved) {
      expect(project.getResolutionRequirements(item)).toEqual(
        expect.arrayContaining([expect.any(String)]),
      );
    }
  });

  it("renders one detailed resolution entry per non-approved task", () => {
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
      expect(dom.window.document.querySelectorAll("[data-resolution-item]")).toHaveLength(22);
      expect(dom.window.document.querySelector("#resolution-board")?.textContent).toContain(
        "Qu\u00e9 falta para resolver",
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
