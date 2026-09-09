/**
 * Genera el bloque de reparto de trabajo que vive dentro de `tasksv2.md`.
 *
 * Existe porque el reparto tiene que ser el mismo en los dos sitios, y la unica forma de que lo sea
 * es que solo se escriba una vez. La superficie de cada fila -los ficheros que va a escribir- se
 * declara en `Listav2/Listav2.data.js`, que es donde ya vivian las referencias por tarea;
 * duplicarla en el ledger a mano garantizaria que las dos copias se separen, que es exactamente lo
 * que le paso a las etiquetas del grafo.
 *
 * El estado y la evidencia de una fila siguen mandando desde `tasksv2.md`. Lo unico que viaja en
 * este sentido es la superficie.
 *
 * Uso: node Listav2/parallel-report.mjs        (reescribe el bloque en tasksv2.md)
 *      node Listav2/parallel-report.mjs --check (falla si el bloque esta desactualizado)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import "./Listav2.js";

export const startMarker = "<!-- REPARTO:INICIO -->";
export const endMarker = "<!-- REPARTO:FIN -->";

const ledgerPath = fileURLToPath(new URL("../tasksv2.md", import.meta.url));

function describeSurface(item) {
  if (item.surface === null) return "**sin declarar**";
  if (item.surface.length === 0) return "no toca codigo";
  return item.surface.map((path) => `\`${path}\``).join("<br>");
}

function describeParallel(item) {
  if (item.surface === null) return "no se puede afirmar";
  if (!item.ready) {
    return item.blockedBy.length > 0 ? `espera a ${item.blockedBy.join(", ")}` : "no esta lista";
  }
  return item.parallelWith.length > 0 ? item.parallelWith.join(", ") : "ninguna";
}

/**
 * Con quien comparte ficheros la fila, y en que estado esta esa otra.
 *
 * Sustituye a la columna «Choca con», que solo miraba filas listas. Eso dejaba fuera el caso que
 * hace dano: la fila que el compañero ya empezo, porque al pasar a `en-progreso` dejo de estar
 * lista y desaparecia de la columna justo cuando mas importaba verla. El estado va en la celda
 * porque un solape con algo en curso y otro con algo sin empezar no se deciden igual.
 */
function describeInterference(item) {
  if (item.surface === null) return "no se puede afirmar";
  if (!item.interference || item.interference.length === 0) return "-";
  const labels = globalThis.ListaV2Project.INTERFERENCE_STATE_LABELS;
  return item.interference
    .map(
      (entry) =>
        `${entry.id} (${labels[entry.level] || entry.level}) en \`${entry.files.join("`, `")}\``,
    )
    .join("<br>");
}

export function renderParallelReport() {
  const project = globalThis.ListaV2Project;
  const items = project.flattenItems(project.projectData.stages).filter((item) => item.open);
  const ready = items.filter((item) => item.ready);
  const undeclared = items.filter((item) => item.surface === null);
  const active = items.filter((item) => item.status === "en-progreso" || item.status === "revision");

  const lines = [
    startMarker,
    "",
    "<!-- Generado por `node Listav2/parallel-report.mjs`. No lo edites a mano: la superficie de",
    "     cada fila se declara en TASK_SURFACES, dentro de Listav2/Listav2.data.js. -->",
    "",
    "Dos filas se pueden repartir entre dos personas cuando se cumplen **las tres** a la vez:",
    "ninguna encadena a la otra, las dos estan listas para empezar -sin dependencia abierta- y no",
    "escriben en el mismo fichero. Esto se calcula, no se afirma: si una fila cambia de superficie,",
    "el reparto cambia solo.",
    "",
    "**Superficie sin declarar no quiere decir compatible con todo**, quiere decir que no se puede",
    "afirmar nada. Esas filas no se reparten hasta que alguien declare que ficheros van a escribir.",
    "",
    "La ultima columna responde a la otra pregunta, la que hay que hacerse antes de coger una fila:",
    "**quien mas escribe estos ficheros, y en que estado esta**. `en curso` es una fila que alguien",
    "ya empezo -no la cojas contra ella-; `sin empezar` es un choque futuro que se evita eligiendo",
    "el orden; `ya cerrada` es una fila desplegada, aprobada o cancelada, que no compite con nadie",
    "y solo dice quien toco ese fichero el ultimo.",
    "",
    `Hoy hay **${ready.length} filas listas** de ${items.length} abiertas` +
      (undeclared.length > 0
        ? `, y **${undeclared.length} con la superficie sin declarar**.`
        : ", y ninguna con la superficie sin declarar.") +
      (active.length > 0
        ? ` **${active.length} ${active.length === 1 ? "fila esta" : "filas estan"} en curso**: ` +
          `${active.map((item) => item.id).join(", ")}.`
        : " Ninguna fila esta en curso ahora mismo."),
    "",
    "| Fila | Estado | Toca | Puede ir a la vez que | Interfiere con |",
    "| ---- | ------ | ---- | --------------------- | -------------- |",
  ];

  for (const item of items) {
    lines.push(
      `| ${item.id} | ${item.ready ? "lista" : item.status} | ${describeSurface(item)} | ` +
        `${describeParallel(item)} | ${describeInterference(item)} |`,
    );
  }

  lines.push("", endMarker);
  return lines.join("\n");
}

export function applyParallelReport(ledger, report) {
  const start = ledger.indexOf(startMarker);
  const end = ledger.indexOf(endMarker);
  if (start === -1 || end === -1) {
    throw new Error("tasksv2.md no declara los marcadores REPARTO:INICIO / REPARTO:FIN");
  }
  return ledger.slice(0, start) + report + ledger.slice(end + endMarker.length);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ledger = readFileSync(ledgerPath, "utf8");
  const updated = applyParallelReport(ledger, renderParallelReport());
  if (process.argv.includes("--check")) {
    if (updated !== ledger) {
      process.stderr.write(
        "El bloque de reparto de tasksv2.md esta desactualizado. " +
          "Ejecuta: node Listav2/parallel-report.mjs\n",
      );
      process.exit(1);
    }
    process.stdout.write("El bloque de reparto esta al dia\n");
  } else {
    writeFileSync(ledgerPath, updated, "utf8");
    process.stdout.write("Bloque de reparto reescrito en tasksv2.md\n");
  }
}
