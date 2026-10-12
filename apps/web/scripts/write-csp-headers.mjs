import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
// Cloudflare Pages silently drops any _headers line longer than this, CSP included.
const maxHeaderLineLength = 2_000;
const charsetTag = '<meta charSet="utf-8"/>';

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await htmlFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(path);
  }
  return files;
}

const headers = await readFile(join(outDirectory, "_headers"), "utf8");
for (const line of headers.split("\n")) {
  if (line.length > maxHeaderLineLength) {
    throw new Error(`A _headers line has ${line.length} characters; Pages drops it.`);
  }
}
// The header allows 'unsafe-inline'; each page's meta policy narrows inline scripts to its hashes.
// ponytail: the meta's script-src also governs workers (no blob:); add worker-src if one appears.
const scriptHosts = /script-src 'self' 'unsafe-inline'((?: https:\/\/[^\s;]+)*);/u.exec(
  headers,
)?.[1];
if (scriptHosts === undefined || headers.split("script-src ").length !== 2) {
  throw new Error("The CSP template must contain one inline-script allowance.");
}

const pages = await htmlFiles(outDirectory);
if (pages.length === 0) throw new Error("The static export contains no pages to protect.");
const inlineScriptPattern = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/giu;
for (const path of pages) {
  const html = await readFile(path, "utf8");
  const charsetAt = html.indexOf(charsetTag);
  const firstScriptAt = html.indexOf("<script");
  if (
    html.split(charsetTag).length !== 2 ||
    (firstScriptAt !== -1 && firstScriptAt < charsetAt) ||
    html.includes('http-equiv="Content-Security-Policy"')
  ) {
    throw new Error(`${path} needs one charset meta ahead of every script and no CSP meta yet.`);
  }
  const hashes = new Set();
  for (const match of html.matchAll(inlineScriptPattern)) {
    const source = match[1];
    if (source === undefined) continue;
    hashes.add(`'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`);
  }
  const sources = [...[...hashes].sort(), ...scriptHosts.split(" ").filter(Boolean)];
  const policy = ["script-src 'self'", ...sources].join(" ");
  const at = charsetAt + charsetTag.length;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}"/>`;
  await writeFile(path, html.slice(0, at) + meta + html.slice(at), "utf8");
}
