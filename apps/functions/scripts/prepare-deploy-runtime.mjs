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

  await cp(new URL("packages/domain/lib/", repositoryRoot), new URL("lib/domain/", deployRoot), {
    recursive: true,
  });

  await rewriteDeployRuntimeImports(fileURLToPath(new URL("lib/src/", deployRoot)));
}

const invokedScript =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedScript) await prepareDeployRuntime();
