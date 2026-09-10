import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import "../../Listav2/Listav2.js";
import {
  applyParallelReport,
  endMarker,
  renderParallelReport,
  startMarker,
} from "../../Listav2/parallel-report.mjs";

type BoardItem = {
  id: string;
  status: string;
  dependsOn: string;
  title: string;
  resolutionRequirements: readonly string[];
  open: boolean;
  ready: boolean;
  surface: readonly string[] | null;
  parallelWith: readonly string[];
  conflicts: readonly { id: string; files: readonly string[] }[];
};

type ListaV2Project = {
  projectData: {
    cutoffDate: string;
    evidenceSyncDates: Readonly<Record<string, string>>;
    stages: unknown;
  };
  flattenItems: (stages: unknown) => BoardItem[];
  getResolutionRequirements: (item: BoardItem) => readonly string[];
  getPhaseAnchorId: (stage: { id: string; track: string }) => string | null;
  TASK_SURFACES: Readonly<Record<string, readonly string[]>>;
  VALID_STATUSES: readonly string[];
};

const project = (globalThis as typeof globalThis & { ListaV2Project: ListaV2Project })
  .ListaV2Project;

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

function readProjectFile(relativePath: string): string {
  return readFileSync(
    new URL(relativePath, `file:///${projectRoot.replaceAll("\\", "/")}/`),
    "utf8",
  );
}

/**
 * The v1 board drifted from its ledger once already, and only a test written after the fact caught
 * it. This board starts with that test instead of waiting for the same failure.
 *
 * The v1 test compares evidence dates because `tasks.md` records evidence in dated headings. This
 * ledger is younger and records its rows in tables, so this test compares the thing that actually
 * drifts here: the set of rows, and the status and dependency each row declares. Anyone who edits a
 * row on one side and forgets the other gets a failure naming the row.
 */
const rowPattern = /^\| (T\d{3}V2) \| (.+?) \| (.+?) \| (\S+) \|/gmu;

type LedgerRow = { id: string; title: string; dependsOn: string; status: string };

/**
 * El bloque de reparto se genera desde el tablero y sus filas empiezan igual que las del ledger,
 * asi que leerlo aqui seria tomar por fuente de verdad algo que es un reflejo: cada fila acabaria
 * declarando como estado la palabra "lista" y como dependencia una lista de ficheros.
 */
function withoutGeneratedBlock(ledger: string): string {
  const start = ledger.indexOf(startMarker);
  const end = ledger.indexOf(endMarker);
  if (start === -1 || end === -1) return ledger;
  return ledger.slice(0, start) + ledger.slice(end + endMarker.length);
}

function ledgerRows(ledger: string): Map<string, LedgerRow> {
  const rows = new Map<string, LedgerRow>();
  for (const match of withoutGeneratedBlock(ledger).matchAll(rowPattern)) {
    const [, id, title, dependsOn, status] = match;
    rows.set(id!, {
      id: id!,
      title: title!.trim(),
      dependsOn: dependsOn!.trim(),
      status: status!.trim(),
    });
  }
  return rows;
}

const validStatuses = new Set([
  "desplegada",
  "aprobada",
  "revision",
  "en-progreso",
  "pendiente",
  "bloqueada",
  "cancelada",
]);

describe("Listav2 stays in step with tasksv2.md", () => {
  const ledger = readProjectFile("tasksv2.md");
  const rows = ledgerRows(ledger);
  const items = project.flattenItems(project.projectData.stages);
  const board = new Map(items.map((item) => [item.id, item]));

  it("finds the ledger rows to compare", () => {
    // Guards the parser itself: if the ledger's table style changes, this fails loudly instead of
    // letting every other assertion pass vacuously against an empty map.
    expect(rows.size).toBeGreaterThan(0);
    expect(board.size).toBeGreaterThan(0);
  });

  it("declares the same task IDs on both sides", () => {
    const onlyLedger = [...rows.keys()].filter((id) => !board.has(id)).sort();
    const onlyBoard = [...board.keys()].filter((id) => !rows.has(id)).sort();

    expect(
      onlyLedger,
      `tasksv2.md declares ${onlyLedger.join(", ")} but Listav2 does not. Add the row to ` +
        "Listav2/Listav2.data.js and reassemble the board.",
    ).toEqual([]);
    expect(
      onlyBoard,
      `Listav2 declares ${onlyBoard.join(", ")} but tasksv2.md does not. The ledger is the ` +
        "source of truth: add the row there first.",
    ).toEqual([]);
  });

  it("agrees on the status of every row", () => {
    const drifted = [...rows.values()]
      .filter((row) => board.has(row.id) && board.get(row.id)!.status !== row.status)
      .map((row) => `${row.id}: ledger=${row.status} board=${board.get(row.id)!.status}`);

    expect(drifted, `Status drift between tasksv2.md and Listav2: ${drifted.join("; ")}`).toEqual(
      [],
    );
  });

  it("agrees on the dependencies of every row", () => {
    const drifted = [...rows.values()]
      .filter((row) => board.has(row.id) && board.get(row.id)!.dependsOn !== row.dependsOn)
      .map((row) => `${row.id}: ledger=${row.dependsOn} board=${board.get(row.id)!.dependsOn}`);

    expect(
      drifted,
      `Dependency drift between tasksv2.md and Listav2: ${drifted.join("; ")}`,
    ).toEqual([]);
  });

  it("uses only statuses the board knows how to render", () => {
    const unknown = [...rows.values()]
      .filter((row) => !validStatuses.has(row.status))
      .map((row) => `${row.id}=${row.status}`);

    expect(
      unknown,
      `tasksv2.md uses statuses the board cannot render: ${unknown.join(", ")}`,
    ).toEqual([]);
  });

  it("points every dependency at a row that exists", () => {
    const dangling: string[] = [];
    for (const row of rows.values()) {
      for (const dependency of row.dependsOn.match(/T\d{3}V2/gu) ?? []) {
        if (!rows.has(dependency)) dangling.push(`${row.id} -> ${dependency}`);
      }
    }

    expect(
      dangling,
      `Rows depend on IDs that do not exist in this ledger: ${dangling.join(", ")}. A v1 ` +
        "dependency belongs in the evidence text, not in the Depende de column.",
    ).toEqual([]);
  });

  it("numbers every row T001V2 upward, with no gaps and no duplicates", () => {
    // The `V2` suffix is what keeps the two ledgers apart: T001V2 is not T001. A row that loses
    // the suffix would collide with a v1 ID and make the number ambiguous across both ledgers.
    const ids = [...rows.keys()];
    const malformed = ids.filter((id) => !/^T\d{3}V2$/u.test(id));
    expect(malformed, `IDs that break the T###V2 scheme: ${malformed.join(", ")}`).toEqual([]);

    const numbers = ids.map((id) => Number.parseInt(id.slice(1, 4), 10)).sort((a, b) => a - b);
    const expected = Array.from({ length: numbers.length }, (_, index) => index + 1);
    expect(numbers, "Row numbers must run 1..n with no gaps and no duplicates").toEqual(expected);
  });

  it("never collides with an ID that tasks.md already spent", () => {
    const v1 = readProjectFile("tasks.md");
    const v1Ids = new Set([...v1.matchAll(/^\| (T\d{3})\b/gmu)].map((match) => match[1]!));
    const collisions = [...rows.keys()].filter((id) => v1Ids.has(id)).sort();

    expect(
      collisions,
      `These IDs exist in both tasks.md and tasksv2.md: ${collisions.join(", ")}`,
    ).toEqual([]);
  });

  it("gives every unresolved row concrete steps to close it", () => {
    // A row with no requirements renders as an empty card on the resolution board, which reads as
    // "nothing left to do" when it actually means "nobody thought this through yet".
    const empty = items
      .filter((item) => item.status !== "aprobada" && item.status !== "cancelada")
      .filter((item) => project.getResolutionRequirements(item).length === 0)
      .map((item) => item.id);

    expect(
      empty,
      `These rows have no resolution requirements: ${empty.join(", ")}. Add them to ` +
        "RESOLUTION_REQUIREMENTS so the board can say what closing them takes.",
    ).toEqual([]);
  });

  it("anchors every stage to a target the page actually declares", () => {
    const html = readProjectFile("Listav2/Listav2.html");
    const declared = new Set(
      [...html.matchAll(/<div id="([^"]+)" class="phase-anchor"/gu)].map((match) => match[1]!),
    );
    const stages = project.projectData.stages as { id: string; track: string }[];
    const missing = stages
      .map((stage) => project.getPhaseAnchorId(stage))
      .filter((anchor): anchor is string => anchor !== null)
      .filter((anchor) => !declared.has(anchor));

    expect(
      missing,
      `Listav2.html declares no anchor for: ${missing.join(", ")}. Navigation would scroll nowhere.`,
    ).toEqual([]);
  });

  it("gives every status a card in the summary", () => {
    // Anadir un estado sin su tarjeta lo hace invisible: las tarjetas dejan de sumar el total y las
    // filas de ese estado no se pueden filtrar desde el resumen. Paso exactamente eso el 2026-09-09
    // al anadir `desplegada`, y solo se vio abriendo la pagina.
    const html = readProjectFile("Listav2/Listav2.html");
    const declared = new Set(
      [...html.matchAll(/<div data-status="([^"]+)" data-render-target="status-cards"/gu)].map(
        (match) => match[1]!,
      ),
    );
    const missing = project.VALID_STATUSES.filter((status) => !declared.has(status));

    expect(
      missing,
      `Listav2.html no declara tarjeta para: ${missing.join(", ")}. Esas filas no suman en el ` +
        "resumen ni se pueden filtrar desde el.",
    ).toEqual([]);
  });

  it("dates the board on or after the ledger's own cut", () => {
    // The board prints this date as its cut-off, so a stale value states something untrue on screen.
    expect(project.projectData.cutoffDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(ledger).toContain(project.projectData.cutoffDate);
  });

  /**
   * El reparto de trabajo entre dos personas. Estas tres existen porque la tabla del ledger es una
   * afirmacion sobre quien puede tocar que a la vez, y una afirmacion asi solo vale mientras se
   * pueda comprobar.
   */
  it("keeps the ledger's work-split block generated, not hand-written", () => {
    // Sin esto el bloque envejece en silencio y manda a dos personas al mismo fichero.
    expect(
      applyParallelReport(ledger, renderParallelReport()),
      "El bloque de reparto de tasksv2.md esta desactualizado. Ejecuta: " +
        "node Listav2/parallel-report.mjs",
    ).toEqual(ledger);
  });

  it("makes every open row declare what it writes", () => {
    // Una fila que nadie declaro no es una fila compatible con todo: es una pregunta sin responder,
    // y el calculo la deja fuera del reparto. Se pide la declaracion explicita para que anadir una
    // fila nueva sin pensar en su superficie falle nombrandola.
    const undeclared = items
      .filter((item) => item.open)
      .filter((item) => !Object.hasOwn(project.TASK_SURFACES, item.id))
      .map((item) => item.id);

    expect(
      undeclared,
      `Estas filas no aparecen en TASK_SURFACES: ${undeclared.join(", ")}. Declara los ficheros ` +
        "que va a escribir cada una, o [] si no toca codigo.",
    ).toEqual([]);
  });

  it("never calls two rows parallel when they write to the same place", () => {
    // La propiedad que hace util a la tabla, comprobada contra el resultado y no contra la
    // intencion: si el calculo se rompiera, esto lo dice antes que un conflicto de merge.
    const byId = new Map(items.map((item) => [item.id, item]));
    const wrong: string[] = [];

    for (const item of items) {
      for (const partnerId of item.parallelWith ?? []) {
        const partner = byId.get(partnerId);
        if (!partner?.surface || !item.surface) continue;
        const shared = item.surface.filter((left) =>
          partner.surface!.some(
            (right) =>
              left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`),
          ),
        );
        if (shared.length > 0) wrong.push(`${item.id}+${partnerId} en ${shared.join(", ")}`);
      }
    }

    expect(
      wrong,
      `Filas declaradas paralelas que escriben en el mismo sitio: ${wrong.join("; ")}`,
    ).toEqual([]);
  });

  it("keeps the ledger itself out of every surface", () => {
    // tasksv2.md lo toca cualquier fila que avance, asi que contarlo como superficie haria que
    // ninguna pareja fuese nunca paralela y la tabla no serviria para nada.
    const offenders = Object.entries(project.TASK_SURFACES)
      .filter(([, surface]) =>
        (surface ?? []).some((path) => path.endsWith(".md") && path.includes("tasks")),
      )
      .map(([id]) => id);

    expect(
      offenders,
      `Estas filas cuentan el ledger como superficie: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
