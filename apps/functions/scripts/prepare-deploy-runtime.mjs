import { cp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { rewriteDeployRuntimeImports } = await import("../lib/src/deploy-runtime.js");

export async function prepareDeployRuntime({
  repositoryRoot = new URL("../../../", import.meta.url),
  deployRoot = new URL("../../../.firebase-functions/", import.meta.url),
} = {}) {
  const packagePath = new URL("package.json", deployRoot);
  const packageValue = JSON.parse(await readFile(packagePath, "utf8"));

  packageValue.dependencies = Object.fromEntries(
    Object.entries(packageValue.dependencies ?? {}).filter(
      ([name]) => name !== "@bpt-jersey/domain",
    ),
  );
  packageValue.dependencies.zod = "4.4.3";
  delete packageValue.devDependencies;
  await writeFile(packagePath, `${JSON.stringify(packageValue, null, 2)}\n`, "utf8");
  // Keep the exact security overrides recorded in the source lockfile. Dropping
  // them can either reject a frozen install or resolve vulnerable dependencies.
  const sourceWorkspace = await readFile(new URL("pnpm-workspace.yaml", repositoryRoot), "utf8");
  const overrides = sourceWorkspace.match(/^overrides:\r?\n(?:(?:[ \t].*|)\r?\n)*/m)?.[0] ?? "";
  await writeFile(
    new URL("pnpm-workspace.yaml", deployRoot),
    `packages:\n  - "."\n\n${overrides}`,
    "utf8",
  );

  await cp(new URL("packages/domain/lib/", repositoryRoot), new URL("lib/domain/", deployRoot), {
    recursive: true,
  });

  await rewriteDeployRuntimeImports(fileURLToPath(new URL("lib/src/", deployRoot)));
}

const invokedScript =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedScript) await prepareDeployRuntime();
