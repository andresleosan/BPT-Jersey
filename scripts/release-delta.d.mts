// Type surface of scripts/release-delta.mjs for the qa unit tests. Keep it in step with the
// exports of the .mjs; the tests import both through this file.

export const GOOGLE_CLOUD_PROJECT_ID: RegExp;

export type IndexExport = { name: string; local: string; module: string };

export function parseIndexExports(indexSource: string): IndexExport[];

export function isCloudFunctionDeclaration(moduleSource: string, localName: string): boolean;

export function listCloudFunctionExports(
  indexSource: string,
  readModuleSource: (module: string) => string,
): { names: string[]; skipped: string[] };

export function collectWebCallableNames(
  webSourceDirectory: string,
  exportNames: readonly string[],
): Map<string, string[]>;

export type DeployedFunction = {
  id: string;
  region: string;
  trigger: string;
  deployedAt: string;
  secrets: string[];
};

export function parseDeployedFunctions(jsonText: string): DeployedFunction[];

export type ReleaseDelta = {
  exportedCount: number;
  deployedCount: number;
  webInvokedCount: number;
  webMissing: { name: string; files: string[] }[];
  codeMissing: string[];
  orphaned: DeployedFunction[];
  skippedExports: string[];
};

export function computeReleaseDelta(input: {
  exportNames: readonly string[];
  webCallables: Map<string, string[]>;
  deployed: DeployedFunction[];
  skippedExports?: readonly string[];
}): ReleaseDelta;

export function renderReleaseDelta(delta: ReleaseDelta, deployed: DeployedFunction[]): string;

export function main(
  argv: readonly string[],
  context: { repositoryRoot: string; stdout: { write(chunk: string): unknown } },
): ReleaseDelta;
