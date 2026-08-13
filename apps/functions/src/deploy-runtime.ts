import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const domainImportReplacements: Readonly<Record<string, string>> = Object.freeze({
  "@bpt-jersey/domain/members": "../../domain/members/member-contracts.js",
  "@bpt-jersey/domain/auth/admin-contracts": "../../domain/auth/admin-contracts.js",
  "@bpt-jersey/domain/migration/regyfit-access": "../../domain/migration/regyfit-access.js",
});

async function runtimeFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await runtimeFiles(path)));
    else if (entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

export async function rewriteDeployRuntimeImports(deploySourceRoot: string): Promise<void> {
  for (const outputPath of await runtimeFiles(deploySourceRoot)) {
    const source = await readFile(outputPath, "utf8");
    let prepared = source;
    for (const [specifier, replacement] of Object.entries(domainImportReplacements)) {
      prepared = prepared.replaceAll(specifier, replacement);
    }
    if (/(?:from|import)\s*(?:[^"']*from\s*)?["']@bpt-jersey\/domain(?:["'/])/u.test(prepared)) {
      throw new Error(`Unrewritten domain runtime import in ${outputPath}`);
    }
    await writeFile(outputPath, prepared, "utf8");
  }
}
