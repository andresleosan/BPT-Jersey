import { enrolmentWaiverTermsVersion } from "@bpt-jersey/domain/consents/enrolment-waiver";
import { describe, expect, it } from "vitest";
import { hasAcceptedEnrolmentWaiver } from "./enrolment-waiver-acceptance.js";

// A Firestore Transaction reads through `this`; the helper must call it as a method.
class MethodTransaction {
  private readonly accepted = new Set<string>();
  constructor(paths: readonly string[]) {
    paths.forEach((path) => this.accepted.add(path));
  }
  async get(target: { path?: string }) {
    if (target.path !== undefined) {
      const exists = this.accepted.has(target.path);
      return { exists, data: () => (exists ? {} : undefined) };
    }
    return { docs: [] };
  }
}
const firestore = {
  doc: (path: string) => ({ path }),
  collection: () => {
    const query = { where: () => query, limit: () => query };
    return query;
  },
};

describe("hasAcceptedEnrolmentWaiver", () => {
  it("reads through a real transaction object without losing it", async () => {
    const path = `academies/a1/enrolmentWaiverAcceptances/s1__${enrolmentWaiverTermsVersion}`;
    const transaction = new MethodTransaction([path]);
    await expect(
      hasAcceptedEnrolmentWaiver({ firestore, transaction } as never, "a1", "s1"),
    ).resolves.toBe(true);
    await expect(
      hasAcceptedEnrolmentWaiver({ firestore, transaction } as never, "a1", "s2"),
    ).resolves.toBe(false);
  });
});
