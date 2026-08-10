import { readdir, readFile, writeFile } from "node:fs/promises";

async function runtimeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...(await runtimeFiles(path)));
    else if (entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

for (const outputPath of await runtimeFiles(new URL("../lib/", import.meta.url))) {
  const source = await readFile(outputPath, "utf8");
  const prepared = source.replace(/from "(\.\.?\/[^"\n]+)"/g, (match, specifier) =>
    /\.[a-z]+$/i.test(specifier) ? match : `from "${specifier}.js"`,
  );
  await writeFile(outputPath, prepared, "utf8");
}
