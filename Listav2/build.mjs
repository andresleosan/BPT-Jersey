/**
 * Ensambla `Listav2.js` a partir de `Listav2.data.js` (las filas) y `Listav2.engine.js` (el render).
 *
 * Existe para que el navegador cargue un unico fichero sin modulos, y para que las pruebas puedan
 * importarlo tal cual. Los dos archivos fuente se editan a mano; `Listav2.js` es generado.
 *
 * Uso: node Listav2/build.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");

const header = `/**
 * Listav2.js - GENERADO por Listav2/build.mjs. No lo edites a mano.
 *
 * Es la concatenacion de \`Listav2.data.js\` (las filas) y \`Listav2.engine.js\` (el render).
 * Edita esos dos y vuelve a ensamblar; cualquier cambio hecho aqui se pierde.
 *
 * Fuente unica de verdad de las filas: \`tasksv2.md\`.
 */

`;

const separator = `
// ---------------------------------------------------------------------------
// Motor de render (Listav2.engine.js)
// ---------------------------------------------------------------------------

`;

const output = header + read("Listav2.data.js") + separator + read("Listav2.engine.js");

writeFileSync(new URL("Listav2.js", import.meta.url), output, "utf8");
process.stdout.write(`Listav2.js ensamblado en ${here}: ${output.split("\n").length} lineas\n`);
