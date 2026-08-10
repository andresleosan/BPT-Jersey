import { cp, readdir, readFile, writeFile } from "node:fs/promises";

const repositoryRoot = new URL("../../../", import.meta.url);
const deployRoot = new URL("../../../.firebase-functions/", import.meta.url);
const packagePath = new URL("package.json", deployRoot);
const packageValue = JSON.parse(await readFile(packagePath, "utf8"));

packageValue.dependencies = Object.fromEntries(
  Object.entries(packageValue.dependencies ?? {}).filter(([name]) => name !== "@bpt-jersey/domain"),
);
packageValue.dependencies.zod = "4.4.3";
delete packageValue.devDependencies;
await writeFile(packagePath, `${JSON.stringify(packageValue, null, 2)}\n`, "utf8");

await cp(new URL("packages/domain/lib/", repositoryRoot), new URL("lib/domain/", deployRoot), {
  recursive: true,
});

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

for (const outputPath of await runtimeFiles(new URL("lib/src/", deployRoot))) {
  const source = await readFile(outputPath, "utf8");
  const prepared = source
    .replace(/@bpt-jersey\/domain\/auth\/admin-contracts/g, "../../domain/auth/admin-contracts.js")
    .replace(
      /@bpt-jersey\/domain\/migration\/regyfit-access/g,
      "../../domain/migration/regyfit-access.js",
    );
  await writeFile(outputPath, prepared, "utf8");
}
