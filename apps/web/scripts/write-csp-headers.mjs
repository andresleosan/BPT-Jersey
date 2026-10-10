import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
const inlineScriptDirective = "script-src 'self' 'unsafe-inline'";

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await htmlFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(path);
  }
  return files;
}

const hashes = new Set();
const inlineScriptPattern = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/giu;
for (const path of await htmlFiles(outDirectory)) {
  const html = await readFile(path, "utf8");
  for (const match of html.matchAll(inlineScriptPattern)) {
    const source = match[1];
    if (source === undefined) continue;
    hashes.add(`'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`);
  }
}
if (hashes.size === 0)
  throw new Error("The static export contains no inline scripts to authorize.");

const headersPath = join(outDirectory, "_headers");
const headers = await readFile(headersPath, "utf8");
if (headers.split(inlineScriptDirective).length !== 2) {
  throw new Error("The CSP template must contain one inline-script allowance.");
}
const rendered = headers.replace(
  inlineScriptDirective,
  `script-src 'self' ${[...hashes].sort().join(" ")}`,
);
const csp = rendered
  .split("\n")
  .find((line) => line.trimStart().startsWith("Content-Security-Policy:"));
if (csp === undefined || Buffer.byteLength(csp, "utf8") > 12_000) {
  throw new Error("The generated CSP header is missing or too large.");
}
await writeFile(headersPath, rendered, "utf8");
