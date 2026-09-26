import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import type { R2Client } from "../storage/r2-client";
import { createAccountSettingsService, type TeenAccessAuth } from "./account-settings-service";

const actor = { userId: "guardian-1", academyId: "demo-academy" };

function service() {
  // Refusing every member stops the flow right after the input check, so no Firestore read is needed.
  const authorise = vi.fn(async () => ({ allowed: false as const }));
  const auth = {} as TeenAccessAuth;
  const settings = createAccountSettingsService({
    firestore: {} as Firestore,
    r2: {} as R2Client,
    access: { authorise } as never,
    teen: { auth, linkStudentAccount: vi.fn() },
  });
  return { settings, authorise };
}

describe("createTeenAccess password minimum", () => {
  const input = { studentId: "student-1", email: "teen@example.test" };

  it("refuses an 11-character password before any permission check", async () => {
    const { settings, authorise } = service();

    await expect(
      settings.createTeenAccess(actor as never, { ...input, password: "a".repeat(11) }),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(authorise).not.toHaveBeenCalled();
  });

  it("lets a 12-character password through to the permission check", async () => {
    const { settings, authorise } = service();

    await expect(
      settings.createTeenAccess(actor as never, { ...input, password: "a".repeat(12) }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(authorise).toHaveBeenCalledOnce();
  });
});
