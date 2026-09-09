import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "../../Listav2/Listav2.js";

type InterferenceLevel = "en-curso" | "sin-empezar" | "cerrada";

type Interference = {
  id: string;
  status: string;
  level: InterferenceLevel;
  files: readonly string[];
};

type BoardItem = {
  id: string;
  status: string;
  track: string;
  open: boolean;
  ready: boolean;
  active: boolean;
  available: boolean;
  parallelWith: readonly string[];
  surface: readonly string[] | null;
  interference: readonly Interference[];
  interferenceLevel: InterferenceLevel | "ninguna" | "no-toca" | "sin-declarar";
};

type ListaV2Project = {
  projectData: { stages: unknown };
  flattenItems: (stages: unknown) => BoardItem[];
  isClosedStatus: (status: string) => boolean;
  interferenceLevel: (status: string) => InterferenceLevel;
  renderProject: (document: Document) => boolean;
  VALID_STATUSES: readonly string[];
};

type JSDOMInstance = { window: Window & typeof globalThis };
type JSDOMConstructor = new (html: string, options?: { url: string }) => JSDOMInstance;

const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: JSDOMConstructor };
const project = (globalThis as typeof globalThis & { ListaV2Project: ListaV2Project })
  .ListaV2Project;

type Runtime = { window: unknown; document: unknown };
const runtime = globalThis as unknown as Runtime;
let previous: Runtime;
let dom: JSDOMInstance;

function mount(): Document {
  dom = new JSDOM(readFileSync(new URL("../../Listav2/Listav2.html", import.meta.url), "utf8"), {
    url: "http://localhost/Listav2/Listav2.html",
  });
  previous = { window: runtime.window, document: runtime.document };
  runtime.window = dom.window;
  runtime.document = dom.window.document;
  return dom.window.document;
}

/** Cambiar un `select` a mano no dispara nada: la pagina escucha `change` sobre el formulario. */
function selectFilter(document: Document, id: string, value: string): void {
  const control = document.getElementById(id) as HTMLSelectElement;
  control.value = value;
  control.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

function boardIds(document: Document): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-resolution-item]")].map(
    (entry) => entry.dataset.resolutionItem!,
  );
}

function checklistSummary(document: Document): string {
  return document.querySelector("[data-checklist-summary]")!.textContent ?? "";
}

const items = project.flattenItems(project.projectData.stages);
const byId = new Map(items.map((item) => [item.id, item]));

/**
 * Una carpeta cubre lo que cuelga de ella. Se repite aqui a proposito: si el motor cambiara su
 * definicion de solape, esta prueba tiene que fallar en vez de seguirle la corriente.
 */
function overlaps(left: readonly string[], right: readonly string[]): boolean {
  return left.some((leftPath) =>
    right.some(
      (rightPath) =>
        leftPath === rightPath ||
        leftPath.startsWith(`${rightPath}/`) ||
        rightPath.startsWith(`${leftPath}/`),
    ),
  );
}

describe("Listav2 says what else writes the same files", () => {
  /**
   * La pregunta que responde la insignia no es «esta desplegada?» sino «hay alguien escribiendo
   * ahora mismo en lo que voy a tocar?». Con dos personas repartiendose el ledger, confundir las
   * dos manda a las dos al mismo fichero.
   */
  it("classifies a row by whether someone is writing it right now", () => {
    expect(project.interferenceLevel("en-progreso")).toBe("en-curso");
    expect(project.interferenceLevel("revision")).toBe("en-curso");
    expect(project.interferenceLevel("pendiente")).toBe("sin-empezar");
    expect(project.interferenceLevel("bloqueada")).toBe("sin-empezar");
    expect(project.interferenceLevel("desplegada")).toBe("cerrada");
    expect(project.interferenceLevel("aprobada")).toBe("cerrada");
    expect(project.interferenceLevel("cancelada")).toBe("cerrada");
  });

  it("gives every status a level, so no row can render an unlabelled badge", () => {
    for (const status of project.VALID_STATUSES) {
      expect(["en-curso", "sin-empezar", "cerrada"], status).toContain(
        project.interferenceLevel(status),
      );
    }
  });

  it("lists exactly the rows whose surface overlaps, and no others", () => {
    for (const item of items) {
      if (!item.surface || item.surface.length === 0) {
        expect(item.interference, item.id).toEqual([]);
        continue;
      }

      const expected = items
        .filter((other) => other !== item && other.surface && other.surface.length > 0)
        .filter((other) => overlaps(item.surface!, other.surface!))
        .map((other) => other.id)
        .sort();

      expect([...item.interference.map((entry) => entry.id)].sort(), item.id).toEqual(expected);
    }
  });

  /**
   * Si A escribe el fichero de B, B escribe el de A. Una asimetria querria decir que una de las dos
   * personas ve el aviso y la otra no, que es peor que no avisar a ninguna.
   */
  it("never warns one side of a shared file without warning the other", () => {
    for (const item of items) {
      for (const entry of item.interference) {
        const other = byId.get(entry.id)!;
        expect(
          other.interference.map((back) => back.id),
          `${entry.id} no devuelve el aviso a ${item.id}`,
        ).toContain(item.id);
      }
    }
  });

  it("reads the level of each entry from the other row's status, not from its own", () => {
    for (const item of items) {
      for (const entry of item.interference) {
        const other = byId.get(entry.id)!;
        expect(entry.status, `${item.id} -> ${entry.id}`).toBe(other.status);
        expect(entry.level, `${item.id} -> ${entry.id}`).toBe(
          project.interferenceLevel(other.status),
        );
      }
    }
  });

  it("summarises a row by its worst interference, not by its first", () => {
    const severity = { "en-curso": 3, "sin-empezar": 2, cerrada: 1 } as const;

    for (const item of items) {
      if (item.surface === null) {
        expect(item.interferenceLevel, item.id).toBe("sin-declarar");
        continue;
      }
      if (item.surface.length === 0) {
        expect(item.interferenceLevel, item.id).toBe("no-toca");
        continue;
      }
      if (item.interference.length === 0) {
        expect(item.interferenceLevel, item.id).toBe("ninguna");
        continue;
      }

      const worst = Math.max(...item.interference.map((entry) => severity[entry.level]));
      expect(severity[item.interferenceLevel as InterferenceLevel], item.id).toBe(worst);
    }
  });

  describe("on the page", () => {
    let document: Document;

    beforeEach(() => {
      document = mount();
      expect(project.renderProject(document)).toBe(true);
    });

    afterEach(() => {
      runtime.window = previous.window;
      runtime.document = previous.document;
    });

    it("puts a badge on every task card, with the level the engine computed", () => {
      const cards = [...document.querySelectorAll<HTMLElement>(".task")];
      expect(cards.length).toBe(items.length);

      for (const card of cards) {
        const badge = card.querySelector<HTMLElement>(".task-interference");
        expect(badge, `${card.dataset.taskId} no pinta insignia de interferencia`).not.toBeNull();
        expect(badge!.dataset.interference, card.dataset.taskId).toBe(
          byId.get(card.dataset.taskId!)!.interferenceLevel,
        );
        expect(badge!.textContent, card.dataset.taskId).toContain("Interferencia");
      }
    });

    it("keeps the badge separate from the backlog status, because they answer different questions", () => {
      for (const card of document.querySelectorAll(".task")) {
        expect(card.querySelector(".task-status")!.textContent).toMatch(/^Backlog: /u);
        expect(card.querySelector(".task-interference")!.textContent).toMatch(/^Interferencia: /u);
      }
    });
  });
});

/**
 * Empezable y libre no son lo mismo. Una fila que alguien ya esta escribiendo cumple las dos
 * condiciones de `ready` -sin dependencia abierta y sin bloqueo- y anunciarla como «lista»
 * invitaria a cogerla dos veces, que es justo lo que el reparto existe para evitar.
 */
describe("Listav2 tells apart a row that can be started from one that is free", () => {
  it("marks as active exactly the rows someone has started", () => {
    for (const item of items) {
      expect(item.active, item.id).toBe(
        item.status === "en-progreso" || item.status === "revision",
      );
    }
  });

  it("never offers an active row as free, however unblocked it is", () => {
    for (const item of items) {
      expect(item.available, item.id).toBe(item.ready && !item.active);
      if (item.active) expect(item.available, item.id).toBe(false);
    }
  });

  /**
   * Seguir comparandola en paralelo si es correcto: quien elige la otra mitad del reparto necesita
   * saber que no chocan. Lo que no puede es figurar como libre.
   */
  it("keeps comparing an active row in parallel, for whoever picks the other half", () => {
    for (const item of items) {
      if (!item.active || item.surface === null) continue;
      for (const partnerId of item.parallelWith) {
        expect(
          byId.get(partnerId)!.parallelWith,
          `${partnerId} no devuelve el par a ${item.id}`,
        ).toContain(item.id);
      }
    }
  });
});

/**
 * El tablero de resolucion vivia fuera del ciclo de filtrado: al filtrar por «Desplegada» el
 * resumen de arriba decia 2 y abajo seguian saliendo las pendientes de siempre. La pagina daba dos
 * respuestas a la misma pregunta y la de abajo era la vieja.
 */
describe("Listav2 filters the whole page, not half of it", () => {
  let document: Document;

  beforeEach(() => {
    document = mount();
    expect(project.renderProject(document)).toBe(true);
  });

  afterEach(() => {
    runtime.window = previous.window;
    runtime.document = previous.document;
  });

  it("shows every unresolved row when nothing is filtered", () => {
    const unresolved = items.filter((item) => !project.isClosedStatus(item.status));
    expect(boardIds(document)).toEqual(unresolved.map((item) => item.id));
  });

  it("stops showing pending rows when the filter asks for deployed ones", () => {
    selectFilter(document, "status-filter", "desplegada");

    const deployed = items.filter((item) => item.status === "desplegada");
    expect(deployed.length).toBeGreaterThan(0);
    expect(
      [...document.querySelectorAll<HTMLElement>(".task")].map((n) => n.dataset.taskId),
    ).toEqual(deployed.map((item) => item.id));
    expect(boardIds(document)).toEqual([]);
  });

  it("says why the list is empty instead of leaving it blank", () => {
    selectFilter(document, "status-filter", "desplegada");
    expect(checklistSummary(document)).toContain("ya están cerradas");

    selectFilter(document, "status-filter", "pendiente");
    expect(checklistSummary(document)).toMatch(/requisitos resueltos/u);
  });

  it("narrows the list to one line of work when a track is picked", () => {
    const track = items.find((item) => !project.isClosedStatus(item.status))!.track;
    selectFilter(document, "track-filter", track);

    const expected = items
      .filter((item) => item.track === track && !project.isClosedStatus(item.status))
      .map((item) => item.id);

    expect(expected.length).toBeGreaterThan(0);
    expect(boardIds(document)).toEqual(expected);
  });

  it("puts the whole list back when the filters are cleared", () => {
    selectFilter(document, "status-filter", "desplegada");
    expect(boardIds(document)).toEqual([]);

    selectFilter(document, "status-filter", "");
    expect(boardIds(document)).toEqual(
      items.filter((item) => !project.isClosedStatus(item.status)).map((item) => item.id),
    );
  });
});

/**
 * La barra decia «0 de 25 tareas completadas» con dos filas corriendo en produccion, porque contaba
 * solo `aprobada` y en este ledger el estado final es `desplegada`. Una barra que afirma algo falso
 * sobre el proyecto es peor que no tenerla.
 */
describe("Listav2 counts a deployed row as done", () => {
  let document: Document;

  beforeEach(() => {
    document = mount();
    expect(project.renderProject(document)).toBe(true);
  });

  afterEach(() => {
    runtime.window = previous.window;
    runtime.document = previous.document;
  });

  it("counts every closed row in the global progress", () => {
    const counted = items.filter((item) => item.status !== "cancelada");
    const done = counted.filter((item) => project.isClosedStatus(item.status)).length;

    expect(done).toBeGreaterThan(0);
    expect(document.querySelector('[data-render-target="global-progress"]')!.textContent).toContain(
      `${done} de ${counted.length} tareas completadas`,
    );
  });
});
