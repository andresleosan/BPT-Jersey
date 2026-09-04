import { describe, expect, it, vi } from "vitest";

import type { UserProfile } from "@bpt-jersey/domain/profiles";

import {
  getGuardianProfileHandler,
  guardianProfileCallableOptions,
  saveGuardianProfileHandler,
  type GuardianProfileCallableServices,
} from "./guardian-profile-callables.js";
import {
  createGuardianProfileStore,
  GuardianProfileStoreError,
  type GuardianProfileDocumentData,
  type GuardianProfileFirestore,
  type SaveGuardianProfileInput,
} from "./guardian-profile-service.js";

type Ref = Readonly<{ id: string; path: string }>;

const integritySecret = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const now = "2026-09-03T14:00:00.000Z";

function createFakeFirestore(initial: Record<string, GuardianProfileDocumentData> = {}) {
  const records = new Map(Object.entries(initial));
  const operations: string[] = [];
  const ref = (path: string): Ref => ({ id: path.split("/").at(-1) ?? "", path });
  const firestore: GuardianProfileFirestore = {
    doc: ref,
    runTransaction: async (callback) => {
      const transaction = {
        get: async (target: Ref) => {
          const data = records.get(target.path);
          return { ...target, exists: data !== undefined, data: () => data };
        },
        create: (target: Ref, data: GuardianProfileDocumentData) => {
          if (records.has(target.path)) throw new Error("already exists");
          operations.push(`create:${target.path}`);
          records.set(target.path, data);
          return transaction;
        },
        set: (target: Ref, data: GuardianProfileDocumentData) => {
          operations.push(`set:${target.path}`);
          records.set(target.path, data);
          return transaction;
        },
      };
      return callback(transaction);
    },
  };
  return { firestore, operations, records };
}

function saveInput(overrides: Partial<SaveGuardianProfileInput> = {}): SaveGuardianProfileInput {
  return {
    academyId: "academy-1",
    userId: "guardian-1",
    email: "guardian@example.test",
    requestId: "guardian-request-1",
    displayName: "Synthetic Guardian",
    phoneNumber: "+15550000001",
    now,
    ...overrides,
  };
}

function store(firestore: GuardianProfileFirestore) {
  let auditSequence = 0;
  return createGuardianProfileStore({
    firestore,
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    generateAuditId: () => `guardian-audit-${++auditSequence}`,
  });
}

function callableRequest(
  data: unknown,
  role: "guardian" | "adultStudent" = "guardian",
  app: unknown = { appId: "verified-app" },
) {
  return {
    auth: { uid: "guardian-1", token: { academyId: "academy-1", role } },
    data,
    ...(app === null ? {} : { app }),
  } as never;
}

function callableServices(): GuardianProfileCallableServices {
  const profile: UserProfile = {
    userId: "guardian-1",
    academyId: "academy-1",
    accountType: "client",
    displayName: "Synthetic Guardian",
    email: "guardian@example.test",
    phoneNumber: "+15550000001",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: now,
    createdBy: "guardian-1",
    updatedAt: now,
    updatedBy: "guardian-1",
  };
  return {
    auth: {
      getUser: vi.fn(async () => ({
        uid: "guardian-1",
        disabled: false,
        email: "Guardian@Example.Test",
        customClaims: { academyId: "academy-1", role: "guardian", mfaEnrolled: true },
      })),
    },
    store: {
      getGuardianProfile: vi.fn(async () => profile),
      saveGuardianProfile: vi.fn(async () => profile),
    },
    now: () => now,
  };
}

describe("guardian profile onboarding", () => {
  it("uses mandatory replay-protected App Check and derives all authority from current Auth", async () => {
    expect(guardianProfileCallableOptions).toMatchObject({
      enforceAppCheck: true,
      consumeAppCheckToken: true,
    });
    const services = callableServices();

    await expect(
      saveGuardianProfileHandler(
        callableRequest({
          requestId: "guardian-request-1",
          displayName: "Synthetic Guardian",
          phoneNumber: "+15550000001",
        }),
        services,
      ),
    ).resolves.toMatchObject({ userId: "guardian-1", academyId: "academy-1" });
    expect(services.auth.getUser).toHaveBeenCalledWith("guardian-1");
    expect(services.store.saveGuardianProfile).toHaveBeenCalledWith({
      academyId: "academy-1",
      userId: "guardian-1",
      email: "Guardian@Example.Test",
      requestId: "guardian-request-1",
      displayName: "Synthetic Guardian",
      phoneNumber: "+15550000001",
      now,
    });
  });

  it("rejects missing App Check, non-guardian authority, payload authority, and stale Auth", async () => {
    const noAppCheck = callableServices();
    await expect(
      getGuardianProfileHandler(callableRequest(null, "guardian", null), noAppCheck),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(noAppCheck.auth.getUser).not.toHaveBeenCalled();

    const adult = callableServices();
    await expect(
      saveGuardianProfileHandler(
        callableRequest(
          {
            requestId: "guardian-request-1",
            displayName: "Synthetic Guardian",
            phoneNumber: "+15550000001",
          },
          "adultStudent",
        ),
        adult,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });

    const injected = callableServices();
    await expect(
      saveGuardianProfileHandler(
        callableRequest({
          requestId: "guardian-request-1",
          displayName: "Synthetic Guardian",
          phoneNumber: "+15550000001",
          email: "attacker@example.test",
        }),
        injected,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(injected.store.saveGuardianProfile).not.toHaveBeenCalled();

    for (const authUser of [
      {
        uid: "guardian-1",
        disabled: true,
        email: "guardian@example.test",
        customClaims: { academyId: "academy-1", role: "guardian" },
      },
      {
        uid: "other-guardian",
        disabled: false,
        email: "guardian@example.test",
        customClaims: { academyId: "academy-1", role: "guardian" },
      },
      {
        uid: "guardian-1",
        disabled: false,
        email: "guardian@example.test",
        customClaims: { academyId: "academy-2", role: "guardian" },
      },
      {
        uid: "guardian-1",
        disabled: false,
        email: "guardian@example.test",
        customClaims: { academyId: "academy-1", role: "adultStudent" },
      },
    ]) {
      const revoked = callableServices();
      vi.mocked(revoked.auth.getUser).mockResolvedValue(authUser);
      await expect(getGuardianProfileHandler(callableRequest(null), revoked)).rejects.toMatchObject(
        {
          code: "permission-denied",
        },
      );
      expect(revoked.store.getGuardianProfile).not.toHaveBeenCalled();
    }
  });

  it("creates once, binds exact retries, and writes one metadata-only audit and receipt", async () => {
    const { firestore, records, operations } = createFakeFirestore();
    const current = store(firestore);

    const first = await current.saveGuardianProfile(saveInput());
    const retried = await current.saveGuardianProfile(saveInput());

    expect(retried).toEqual(first);
    expect(operations.filter((entry) => entry.includes("/users/"))).toHaveLength(1);
    const audits = [...records.entries()].filter(([path]) => path.includes("/auditEvents/"));
    const receipts = [...records.entries()].filter(([path]) =>
      path.includes("/profileWriteReceipts/guardian-write-"),
    );
    expect(audits).toHaveLength(1);
    expect(receipts).toHaveLength(1);
    expect(audits[0]?.[1]).toMatchObject({
      academyId: "academy-1",
      actorId: "guardian-1",
      action: "guardian.profile.created",
      targetRef: "academies/academy-1/users/guardian-1",
      purpose: "guardian-profile-maintenance",
      correlationId: expect.stringMatching(/^guardian-write-[a-f0-9]{64}$/u),
      auditEventId: "guardian-audit-1",
      result: "completed",
      schemaVersion: 1,
    });
    const internalEvidence = JSON.stringify([audits[0]?.[1], receipts[0]?.[1]]);
    expect(internalEvidence).not.toMatch(
      /guardian@example|Synthetic Guardian|15550000001|displayName|phoneNumber|email/iu,
    );

    await expect(
      current.saveGuardianProfile(saveInput({ displayName: "Divergent Retry" })),
    ).rejects.toBeInstanceOf(GuardianProfileStoreError);
    expect([...records.keys()].filter((path) => path.includes("/auditEvents/"))).toHaveLength(1);
  });

  it("updates only editable fields, preserves provenance, and fails closed on stored drift", async () => {
    const { firestore, records } = createFakeFirestore();
    const current = store(firestore);
    const created = await current.saveGuardianProfile(saveInput());
    const updated = await current.saveGuardianProfile(
      saveInput({
        requestId: "guardian-request-2",
        displayName: "Updated Guardian",
        phoneNumber: "+15550000002",
        now: "2026-09-04T14:00:00.000Z",
      }),
    );

    expect(updated).toMatchObject({
      displayName: "Updated Guardian",
      phoneNumber: "+15550000002",
      email: "guardian@example.test",
      createdAt: created.createdAt,
      createdBy: created.createdBy,
      active: true,
      status: "active",
    });
    expect(
      [...records.values()].filter((value) => value.action === "guardian.profile.updated"),
    ).toHaveLength(1);

    const userPath = "academies/academy-1/users/guardian-1";
    const storedUser = records.get(userPath);
    if (storedUser === undefined) throw new Error("expected stored guardian profile");
    records.set(userPath, { ...storedUser, email: "drift@example.test" });
    await expect(
      current.getGuardianProfile("guardian-1", "academy-1", "guardian@example.test"),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
