import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { validateRegyfitDiscoveryManifest } from "@bpt-jersey/domain";
import type {
  RegyfitDiscoveryManifest,
  RegyfitModuleSnapshot,
  UtcDateTime,
} from "@bpt-jersey/domain";

import {
  captureRegyfitPageMetadata,
  captureRegyfitFrameMetadata,
  hasRegyfitDiscoveryEnvironment,
  sanitizeRegyfitPageMetadata,
} from "../src/regyfit/discovery";

test.describe("Regyfit discovery", () => {
  test("offline metadata extraction never captures table values", async ({ page }) => {
    await page.setContent(`
      <!doctype html>
      <html>
        <head><title>Students</title></head>
        <body>
          <nav aria-label="Admin navigation">
            <a href="/admin/students?search=secret">Students</a>
            <a href="https://outside.invalid/admin">External</a>
          </nav>
          <main>
            <a href="/admin/classes">Classes</a>
            <button type="button">View</button>
            <button type="button">Delete</button>
            <label for="displayName">Student display name</label>
            <input id="displayName" name="displayName" value="Synthetic row value" required>
            <label for="email">Email</label>
            <input id="email" name="email" value="student@example.invalid">
            <table>
              <thead><tr><th>Display name</th><th>Status</th></tr></thead>
              <tbody><tr><td>Synthetic row value</td><td>active</td></tr></tbody>
            </table>
            <iframe srcdoc="<title>Families</title><a href='/admin/families'>Families</a>"></iframe>
          </main>
        </body>
      </html>
    `);

    const raw = await captureRegyfitPageMetadata(page);
    const moduleSnapshot = sanitizeRegyfitPageMetadata(raw);

    expect(raw.title).toBe("Students");
    expect(raw.navigationLinks).toEqual([
      { label: "Students", route: "/admin/students" },
      { label: "Classes", route: "/admin/classes" },
    ]);
    expect(raw.tableHeaders).toEqual(["Display name", "Status"]);
    expect(moduleSnapshot.discoveryActions).toEqual(["View"]);
    expect(JSON.stringify(raw)).not.toContain("Synthetic row value");
    expect(JSON.stringify(raw)).not.toContain("student@example.invalid");
    expect(JSON.stringify(moduleSnapshot)).not.toContain("active");

    const embeddedFrame = page.frames().find((frame) => frame !== page.mainFrame());
    expect(embeddedFrame).toBeDefined();
    const frameMetadata = await captureRegyfitFrameMetadata(embeddedFrame!);
    expect(frameMetadata.title).toBe("Families");
    expect(frameMetadata.navigationLinks).toEqual([
      { label: "Families", route: "/admin/families" },
    ]);
  });

  test("read-only discovery is opt-in and writes only an explicit sanitized manifest", async ({
    page,
  }) => {
    test.skip(
      !hasRegyfitDiscoveryEnvironment(process.env),
      "requires local REGYFIT_BASE_URL, REGYFIT_EMAIL, and REGYFIT_PASSWORD",
    );

    const baseUrl = new URL(process.env.REGYFIT_BASE_URL!);
    const email = process.env.REGYFIT_EMAIL!;
    const password = process.env.REGYFIT_PASSWORD!;
    await page.goto(baseUrl.href, { waitUntil: "domcontentloaded" });

    const passwordInput = page.locator('input[type="password"]:visible').first();
    if (await passwordInput.count()) {
      const emailInput = page
        .locator('input[type="email"]:visible, input[name*="email" i]:visible')
        .first();
      const signInButton = page
        .getByRole("button", { name: /sign in|log in|login|continue/i })
        .first();
      if (!(await emailInput.count()) || !(await signInButton.count())) {
        throw new Error("Read-only discovery could not identify the login controls.");
      }
      await emailInput.fill(email);
      await passwordInput.fill(password);
      await signInButton.click();
      await page.waitForLoadState("domcontentloaded");
      if (await passwordInput.isVisible().catch(() => false)) {
        throw new Error("Read-only discovery login did not complete.");
      }
    }
    if (/(?:login|signin|auth)/i.test(new URL(page.url()).pathname)) {
      throw new Error("Read-only discovery did not reach an authenticated page.");
    }

    const pendingRoutes = [new URL(page.url()).pathname || "/"];
    const visitedRoutes = new Set<string>();
    const modules: RegyfitModuleSnapshot[] = [];
    while (pendingRoutes.length > 0 && visitedRoutes.size < 40) {
      const route = pendingRoutes.shift()!;
      if (visitedRoutes.has(route) || !isSafeDiscoveryRoute(route)) {
        continue;
      }
      visitedRoutes.add(route);
      await page.goto(new URL(route, baseUrl.origin).href, { waitUntil: "domcontentloaded" });
      const raw = await captureRegyfitPageMetadata(page);
      const moduleSnapshot = sanitizeRegyfitPageMetadata(raw);
      if (!modules.some((candidate) => candidate.key === moduleSnapshot.key)) {
        modules.push(moduleSnapshot);
      }
      for (const link of raw.navigationLinks) {
        if (!visitedRoutes.has(link.route) && isSafeDiscoveryRoute(link.route)) {
          pendingRoutes.push(link.route);
        }
      }
      await page.waitForTimeout(250);
    }

    const manifest: RegyfitDiscoveryManifest = {
      schemaVersion: "1",
      sourceSystem: "regyfit",
      capturedAtUtc: new Date().toISOString() as UtcDateTime,
      capabilities: {
        export: { available: false, formats: [] },
        api: { available: false, documented: false },
      },
      modules,
      notes: ["Read-only structural discovery; row values are omitted."],
    };
    const validation = validateRegyfitDiscoveryManifest(manifest);
    expect(validation.ok).toBe(true);
    await writeManifestIfRequested(manifest);
  });
});

function isSafeDiscoveryRoute(route: string): boolean {
  const segments = route.split("/").filter(Boolean);
  return (
    route.startsWith("/") &&
    !route.includes("?") &&
    !route.includes("#") &&
    segments.every(
      (segment) =>
        !/^(?:logout|signout|delete|create|update|save|export|charge|refund|send|approve|correct|remove|archive|invite|new|edit)$/i.test(
          segment,
        ),
    )
  );
}

async function writeManifestIfRequested(manifest: RegyfitDiscoveryManifest): Promise<void> {
  if (process.env.REGYFIT_SAVE_DISCOVERY !== "true") {
    return;
  }
  const outputDirectory = process.env.REGYFIT_OUTPUT_DIR?.trim();
  if (!outputDirectory) {
    throw new Error("REGYFIT_OUTPUT_DIR is required when saving discovery output.");
  }

  const resolvedOutputDirectory = path.resolve(outputDirectory);
  const repositoryRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
  const relativeOutputPath = path.relative(repositoryRoot, resolvedOutputDirectory);
  if (
    relativeOutputPath === "" ||
    (!relativeOutputPath.startsWith(`..${path.sep}`) && relativeOutputPath !== "..")
  ) {
    throw new Error("Discovery output must be outside the repository.");
  }

  await mkdir(resolvedOutputDirectory, { recursive: true });
  await writeFile(
    path.join(resolvedOutputDirectory, "regyfit-discovery-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}
