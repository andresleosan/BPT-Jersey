import { describe, expect, it, vi } from "vitest";

import type { AdminProvisioningServices, SyntheticFirestore } from "./admin-provisioning.js";
import {
  bootstrapEmulatorOwner,
  provisionAdminRoleWithServices,
  renewRoleLock,
  writeImportAuditEvent,
} from "./admin-provisioning.js";
import type { FirestoreDocumentData } from "./admin-provisioning.js";

type SyntheticUser = {
  uid: string;
  email: string;
  displayName: string | null;
  disabled: boolean;
  customClaims: Record<string, unknown>;
  providerData: Array<{ providerId: string }>;
};

type SyntheticTransaction = {
  get: (ref: { readonly path: string }) => Promise<{
    exists: boolean;
    data: () => FirestoreDocumentData | undefined;
  }>;
  set: (ref: { readonly path: string }, data: FirestoreDocumentData) => SyntheticTransaction;
  delete: (ref: { readonly path: string }) => SyntheticTransaction;
};

type SyntheticServicesOptions = Readonly<{
  failTransaction?: boolean;
  failTransactionNumber?: number;
  failTransactionNumbers?: ReadonlyArray<number>;
  onGetUser?: (records: Map<string, FirestoreDocumentData>) => void;
  onSetCustomUserClaims?: (records: Map<string, FirestoreDocumentData>) => void;
  onTransactionFailure?: (
    records: Map<string, FirestoreDocumentData>,
    transactionCount: number,
  ) => void;
  pauseAfterFirstCommit?: Readonly<{ onCommitted: () => void; wait: Promise<void> }>;
  pauseAfterCompensationTransition?: Readonly<{
    onCommitted: () => void;
    wait: Promise<void>;
  }>;
  pauseBeforeTransactionCommit?: Readonly<{
    transactionNumber: number;
    onPaused: () => void;
    wait: Promise<void>;
  }>;
  pauseAfterTransactionCommit?: Readonly<{
    transactionNumber: number;
    onCommitted: () => void;
    wait: Promise<void>;
  }>;
  onTransactionCommitted?: (transactionCount: number) => void;
}>;

function callableRequest(
  role: "owner" | "administrator",
  academyId: string,
  action: "grant" | "revoke" = "grant",
) {
  return {
    auth: {
      uid: "owner-1",
      token: { academyId, role, firebase: { sign_in_second_factor: "totp" } },
    },
    data: { action },
  } as never;
}

function createSyntheticServices(
  users: SyntheticUser[],
  options: SyntheticServicesOptions = {},
): AdminProvisioningServices & { firestore: SyntheticFirestore } {
  const records = new Map<string, FirestoreDocumentData>();
  let nextAuditId = 0;
  let transactionCount = 0;
  const getDocument = (path: string) => ({
    id: path.split("/").at(-1) ?? "",
    path,
    set: async (data: FirestoreDocumentData) => {
      records.set(path, { ...(records.get(path) ?? {}), ...data });
    },
  });
  const firestore = {
    collection: (path: string) => ({
      doc: (id?: string) => getDocument(id ? `${path}/${id}` : `${path}/audit-${nextAuditId++}`),
    }),
    doc: getDocument,
    records,
    runTransaction: async <T>(callback: (transaction: SyntheticTransaction) => Promise<T>) => {
      transactionCount += 1;
      const shouldFailTransaction =
        options.failTransactionNumber !== undefined
          ? options.failTransactionNumber === transactionCount
          : options.failTransactionNumbers !== undefined
            ? options.failTransactionNumbers.includes(transactionCount)
            : true;
      if (options.failTransaction && shouldFailTransaction) {
        options.onTransactionFailure?.(records, transactionCount);
        throw new Error("synthetic firestore transaction failed");
      }

      const staged = new Map<string, FirestoreDocumentData>();
      const stagedDeletes = new Set<string>();
      const transaction: SyntheticTransaction = {
        get: async (ref) => ({
          exists: records.has(ref.path),
          data: () => records.get(ref.path),
        }),
        set: (ref, data) => {
          stagedDeletes.delete(ref.path);
          staged.set(ref.path, { ...(records.get(ref.path) ?? {}), ...data });
          return transaction;
        },
        delete: (ref) => {
          staged.delete(ref.path);
          stagedDeletes.add(ref.path);
          return transaction;
        },
      };
      const result = await callback(transaction);
      if (options.pauseBeforeTransactionCommit?.transactionNumber === transactionCount) {
        options.pauseBeforeTransactionCommit.onPaused();
        await options.pauseBeforeTransactionCommit.wait;
      }
      for (const path of stagedDeletes) {
        records.delete(path);
      }
      for (const [path, data] of staged) {
        records.set(path, data);
      }
      options.onTransactionCommitted?.(transactionCount);
      if (options.pauseAfterTransactionCommit?.transactionNumber === transactionCount) {
        options.pauseAfterTransactionCommit.onCommitted();
        await options.pauseAfterTransactionCommit.wait;
      }
      const transitionedToCompensating = [...staged.values()].some(
        (data) => data.phase === "compensating",
      );
      if (transactionCount === 1 && options.pauseAfterFirstCommit) {
        options.pauseAfterFirstCommit.onCommitted();
        await options.pauseAfterFirstCommit.wait;
      }
      if (transitionedToCompensating && options.pauseAfterCompensationTransition) {
        options.pauseAfterCompensationTransition.onCommitted();
        await options.pauseAfterCompensationTransition.wait;
      }
      return result;
    },
  } as SyntheticFirestore & {
    runTransaction: <T>(callback: (transaction: SyntheticTransaction) => Promise<T>) => Promise<T>;
  };

  return {
    firestore,
    auth: {
      getUser: async (uid: string) => {
        options.onGetUser?.(records);
        const user = users.find((candidate) => candidate.uid === uid);
        if (!user) {
          throw new Error("auth/user-not-found");
        }
        return user;
      },
      setCustomUserClaims: async (uid: string, claims: Record<string, unknown>) => {
        options.onSetCustomUserClaims?.(records);
        const user = users.find((candidate) => candidate.uid === uid);
        if (!user) {
          throw new Error("auth/user-not-found");
        }
        user.customClaims = claims;
      },
    },
  };
}

const googleUser = (): SyntheticUser => ({
  uid: "target-1",
  email: "target@example.test",
  displayName: "Synthetic Target",
  disabled: false,
  customClaims: {},
  providerData: [{ providerId: "google.com" }],
});

describe("administrative role provisioning", () => {
  it("allows an owner to grant a Google-authenticated target in the same academy", async () => {
    const target = googleUser();
    target.customClaims = { mfaEnrolled: true, locale: "en-GB" };
    let lockAtAuthMutation: FirestoreDocumentData | undefined;
    const services = createSyntheticServices([target], {
      onSetCustomUserClaims: (records) => {
        lockAtAuthMutation = records.get("academies/academy-1/adminRoleLocks/target-1");
      },
    });

    await provisionAdminRoleWithServices(
      callableRequest("owner", "academy-1"),
      { uid: target.uid, email: target.email, role: "administrator" },
      services,
    );

    expect(target.customClaims).toEqual({
      mfaEnrolled: true,
      locale: "en-GB",
      academyId: "academy-1",
      role: "administrator",
    });
    expect(lockAtAuthMutation?.phase).toBe("mutating");
    expect(lockAtAuthMutation?.expiresAt).toEqual(expect.any(Number));
    expect(lockAtAuthMutation?.leaseDeadline).toEqual(expect.any(Number));
    expect(lockAtAuthMutation?.expiresAt).toBeGreaterThan(Date.now());
    expect(lockAtAuthMutation?.expiresAt).toBeLessThanOrEqual(
      lockAtAuthMutation?.leaseDeadline as number,
    );
    expect(lockAtAuthMutation?.expiresAt).toBeLessThan(Date.now() + 60_000);
    const userRecord = services.firestore.records.get("academies/academy-1/users/target-1");
    expect(userRecord).toEqual(
      expect.objectContaining({
        academyId: "academy-1",
        displayName: "Synthetic Target",
        authProvider: "google",
        active: true,
        adminRole: "administrator",
        createdBy: "owner-1",
        updatedBy: "owner-1",
        status: "active",
        schemaVersion: 1,
      }),
    );
    expect(userRecord?.lastRoleChangeAuditId).toEqual(expect.any(String));
    expect(userRecord?.createdAt).toBeDefined();
    expect(userRecord?.updatedAt).toBeDefined();
    expect(services.firestore.records.has("academies/academy-1/adminRoleLocks/target-1")).toBe(
      false,
    );
  });

  it("rejects non-owners, cross-academy targets, and non-Google users", async () => {
    const target = googleUser();
    target.customClaims = { academyId: "academy-2", role: "administrator" };
    const services = createSyntheticServices([target]);

    await expect(
      provisionAdminRoleWithServices(
        callableRequest("administrator", "academy-1"),
        { uid: target.uid, email: target.email, role: "administrator" },
        services,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      provisionAdminRoleWithServices(
        callableRequest("owner", "academy-1"),
        { uid: target.uid, email: target.email, role: "administrator" },
        services,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });

    target.customClaims = {};
    target.providerData = [{ providerId: "password" }];
    await expect(
      provisionAdminRoleWithServices(
        callableRequest("owner", "academy-1"),
        { uid: target.uid, email: target.email, role: "administrator" },
        services,
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });

    target.providerData = [{ providerId: "google.com" }];
    target.customClaims = { academyId: 42 };
    await expect(
      provisionAdminRoleWithServices(
        callableRequest("owner", "academy-1"),
        { uid: target.uid, email: target.email, role: "administrator" },
        services,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("rejects every non-administrative existing claim pair on grant", async () => {
    for (const role of ["headCoach", "coach", "guardian", "adultStudent"] as const) {
      const target = googleUser();
      target.customClaims = {
        academyId: "academy-1",
        role,
        mfaEnrolled: true,
      };
      const services = createSyntheticServices([target]);

      await expect(
        provisionAdminRoleWithServices(
          callableRequest("owner", "academy-1"),
          { uid: target.uid, email: target.email, role: "administrator" },
          services,
        ),
      ).rejects.toMatchObject({ code: "permission-denied" });
      expect(target.customClaims).toEqual({
        academyId: "academy-1",
        role,
        mfaEnrolled: true,
      });
      expect(services.firestore.records.has("academies/academy-1/adminRoleLocks/target-1")).toBe(
        false,
      );
      expect(services.firestore.records.has("academies/academy-1/users/target-1")).toBe(false);
      expect(
        [...services.firestore.records.keys()].some((path) =>
          path.startsWith("academies/academy-1/auditEvents/"),
        ),
      ).toBe(false);
    }
  });

  it("reads and validates the target while holding the lock, then releases it on failure", async () => {
    const target = googleUser();
    target.providerData = [{ providerId: "password" }];
    let observedLockDuringRead = false;
    const services = createSyntheticServices([target], {
      onGetUser: (records) => {
        observedLockDuringRead = records.has("academies/academy-1/adminRoleLocks/target-1");
      },
    });

    await expect(
      provisionAdminRoleWithServices(
        callableRequest("owner", "academy-1"),
        { uid: target.uid, email: target.email, role: "administrator" },
        services,
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    expect(observedLockDuringRead).toBe(true);
    expect(services.firestore.records.has("academies/academy-1/adminRoleLocks/target-1")).toBe(
      false,
    );
  });

  it("rejects when the lease expires immediately before Auth mutation", async () => {
    const target = googleUser();
    let authMutationCount = 0;
    const services = createSyntheticServices([target], {
      onGetUser: (records) => {
        records.set("academies/academy-1/adminRoleLocks/target-1", {
          ...(records.get("academies/academy-1/adminRoleLocks/target-1") ?? {}),
          expiresAt: Date.now() - 1,
        });
      },
      onSetCustomUserClaims: () => {
        authMutationCount += 1;
      },
    });

    await expect(
      provisionAdminRoleWithServices(
        callableRequest("owner", "academy-1"),
        { uid: target.uid, email: target.email, role: "administrator" },
        services,
      ),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(authMutationCount).toBe(0);
    expect(target.customClaims).toEqual({});
    expect(services.firestore.records.has("academies/academy-1/adminRoleLocks/target-1")).toBe(
      false,
    );
  });

  it("revokes administrative claims without deleting the Firebase user", async () => {
    const target = googleUser();
    target.customClaims = {
      academyId: "academy-1",
      role: "administrator",
      mfaEnrolled: true,
    };
    const services = createSyntheticServices([target]);

    await provisionAdminRoleWithServices(
      callableRequest("owner", "academy-1", "revoke"),
      { uid: target.uid, email: target.email, role: "administrator" },
      services,
    );

    expect(target.customClaims).toEqual({ mfaEnrolled: true });
    expect(services.firestore.records.get("academies/academy-1/users/target-1")).toEqual(
      expect.objectContaining({ active: true, adminRole: null }),
    );
  });

  it("preserves existing user creation and status metadata", async () => {
    const target = googleUser();
    const services = createSyntheticServices([target]);
    services.firestore.records.set("academies/academy-1/users/target-1", {
      userId: target.uid,
      academyId: "academy-1",
      accountType: "staff",
      displayName: "Stored Name",
      email: target.email,
      authProvider: "google",
      active: true,
      status: "suspended",
      schemaVersion: 1,
      createdAt: "synthetic-created-at",
      createdBy: "original-actor",
    });

    await provisionAdminRoleWithServices(
      callableRequest("owner", "academy-1"),
      { uid: target.uid, email: target.email, role: "administrator" },
      services,
    );

    expect(services.firestore.records.get("academies/academy-1/users/target-1")).toEqual(
      expect.objectContaining({
        displayName: "Synthetic Target",
        createdAt: "synthetic-created-at",
        createdBy: "original-actor",
        status: "suspended",
      }),
    );
  });

  it("restores previous claims and leaves no completed audit when Firestore fails", async () => {
    const target = googleUser();
    target.customClaims = { mfaEnrolled: true };
    const services = createSyntheticServices([target], {
      failTransaction: true,
      failTransactionNumber: 4,
    });

    await expect(
      provisionAdminRoleWithServices(
        callableRequest("owner", "academy-1"),
        { uid: target.uid, email: target.email, role: "administrator" },
        services,
      ),
    ).rejects.toThrow("synthetic firestore transaction failed");

    expect(target.customClaims).toEqual({ mfaEnrolled: true });
    expect(services.firestore.records).toEqual(new Map());
  });

  it("does not compensate over newer Auth claims after a stale lease", async () => {
    const target = googleUser();
    target.customClaims = { mfaEnrolled: true };
    const services = createSyntheticServices([target], {
      failTransaction: true,
      failTransactionNumber: 4,
      onTransactionFailure: (records) => {
        target.customClaims = {
          mfaEnrolled: true,
          academyId: "academy-1",
          role: "administrator",
        };
        records.set("academies/academy-1/adminRoleLocks/target-1", {
          lockId: "newer-operation-lock",
          expiresAt: Date.now() + 30_000,
          leaseDeadline: Date.now() + 60_000,
          phase: "mutating",
        });
      },
    });

    await expect(
      provisionAdminRoleWithServices(
        callableRequest("owner", "academy-1"),
        { uid: target.uid, email: target.email, role: "administrator" },
        services,
      ),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(target.customClaims).toEqual({
      mfaEnrolled: true,
      academyId: "academy-1",
      role: "administrator",
    });
  });

  it("rejects malformed locks and replaces only valid expired leases", async () => {
    for (const phase of ["mutating", "compensating", "recovered", "invalid"]) {
      const nonActiveTarget = googleUser();
      const nonActiveServices = createSyntheticServices([nonActiveTarget]);
      nonActiveServices.firestore.records.set("academies/academy-1/adminRoleLocks/target-1", {
        lockId: "non-active-lock",
        expiresAt: phase === "invalid" ? Date.now() - 1 : Date.now() + 30_000,
        leaseDeadline: Date.now() + 60_000,
        phase,
      });

      await expect(
        provisionAdminRoleWithServices(
          callableRequest("owner", "academy-1"),
          { uid: nonActiveTarget.uid, email: nonActiveTarget.email, role: "administrator" },
          nonActiveServices,
        ),
      ).rejects.toMatchObject({ code: "aborted" });
      expect(nonActiveTarget.customClaims).toEqual({});
      expect(
        nonActiveServices.firestore.records.get("academies/academy-1/adminRoleLocks/target-1"),
      ).toEqual(expect.objectContaining({ phase }));
    }

    for (const malformedLock of [
      { lockId: "malformed-lock" },
      { lockId: "expired-without-phase", expiresAt: Date.now() - 1 },
      { lockId: "", expiresAt: Date.now() + 30_000 },
      { lockId: "   ", expiresAt: Date.now() + 30_000 },
      { lockId: "malformed-lock", expiresAt: 0 },
      { lockId: "malformed-lock", expiresAt: -1 },
      { lockId: "malformed-lock", expiresAt: "later" },
      { lockId: 42, expiresAt: Date.now() + 30_000 },
      { lockId: "malformed-lock", expiresAt: Number.NaN },
      { lockId: "malformed-lock", expiresAt: Number.POSITIVE_INFINITY },
      { lockId: "malformed-lock", expiresAt: Number.NEGATIVE_INFINITY },
      { lockId: "malformed-lock", expiresAt: Date.now() - 1, phase: "active" },
      {
        lockId: "malformed-lock",
        expiresAt: Date.now() - 1,
        phase: "active",
        leaseDeadline: Number.NaN,
      },
      {
        lockId: "malformed-lock",
        expiresAt: Date.now() - 1,
        phase: "active",
        leaseDeadline: Number.POSITIVE_INFINITY,
      },
      {
        lockId: "malformed-lock",
        expiresAt: Date.now() - 1,
        phase: "active",
        leaseDeadline: "later",
      },
    ]) {
      const malformedTarget = googleUser();
      const malformedServices = createSyntheticServices([malformedTarget]);
      malformedServices.firestore.records.set(
        "academies/academy-1/adminRoleLocks/target-1",
        malformedLock,
      );

      await expect(
        provisionAdminRoleWithServices(
          callableRequest("owner", "academy-1"),
          { uid: malformedTarget.uid, email: malformedTarget.email, role: "administrator" },
          malformedServices,
        ),
      ).rejects.toMatchObject({ code: "aborted" });
      expect(malformedTarget.customClaims).toEqual({});
    }

    const expiredTarget = googleUser();
    const expiredServices = createSyntheticServices([expiredTarget]);
    expiredServices.firestore.records.set("academies/academy-1/adminRoleLocks/target-1", {
      lockId: "expired-lock",
      expiresAt: Date.now() - 1,
      leaseDeadline: Date.now() + 60_000,
      phase: "active",
    });

    await provisionAdminRoleWithServices(
      callableRequest("owner", "academy-1"),
      { uid: expiredTarget.uid, email: expiredTarget.email, role: "administrator" },
      expiredServices,
    );
    expect(expiredTarget.customClaims).toEqual({
      academyId: "academy-1",
      role: "administrator",
    });
    expect(
      expiredServices.firestore.records.has("academies/academy-1/adminRoleLocks/target-1"),
    ).toBe(false);
  });

  it("recovers valid expired mutating and compensating leases with a new lock ID", async () => {
    for (const phase of ["mutating", "compensating"] as const) {
      const target = googleUser();
      let lockAtAuthMutation: FirestoreDocumentData | undefined;
      const services = createSyntheticServices([target], {
        onSetCustomUserClaims: (records) => {
          lockAtAuthMutation = records.get("academies/academy-1/adminRoleLocks/target-1");
        },
      });
      services.firestore.records.set("academies/academy-1/adminRoleLocks/target-1", {
        lockId: `expired-${phase}-lock`,
        expiresAt: Date.now() - 1,
        leaseDeadline: Date.now() - 1,
        phase,
      });

      await provisionAdminRoleWithServices(
        callableRequest("owner", "academy-1"),
        { uid: target.uid, email: target.email, role: "administrator" },
        services,
      );

      expect(lockAtAuthMutation?.lockId).not.toBe(`expired-${phase}-lock`);
      expect(lockAtAuthMutation?.leaseDeadline).toBeGreaterThan(Date.now());
      expect(target.customClaims).toEqual({
        academyId: "academy-1",
        role: "administrator",
      });
      expect(services.firestore.records.has("academies/academy-1/adminRoleLocks/target-1")).toBe(
        false,
      );
    }
  });

  it("renews a finite fenced lease while persistence is delayed", async () => {
    vi.useFakeTimers();
    let releasePersistence!: () => void;
    let markPersistencePaused!: () => void;
    const persistencePaused = new Promise<void>((resolve) => {
      markPersistencePaused = resolve;
    });
    const persistenceRelease = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const target = googleUser();
    const services = createSyntheticServices([target], {
      pauseBeforeTransactionCommit: {
        transactionNumber: 4,
        onPaused: markPersistencePaused,
        wait: persistenceRelease,
      },
    });

    try {
      const update = provisionAdminRoleWithServices(
        callableRequest("owner", "academy-1"),
        { uid: target.uid, email: target.email, role: "administrator" },
        services,
      );
      await persistencePaused;
      const lockPath = "academies/academy-1/adminRoleLocks/target-1";
      const beforeRenewal = services.firestore.records.get(lockPath)?.expiresAt;
      await vi.advanceTimersByTimeAsync(31_000);
      const afterRenewal = services.firestore.records.get(lockPath)?.expiresAt;

      expect(afterRenewal).toBeGreaterThan(beforeRenewal as number);
      releasePersistence();
      await update;
    } finally {
      vi.useRealTimers();
    }
  });

  it("renews a compensating lease while compensation is delayed", async () => {
    vi.useFakeTimers();
    let releaseCompensation!: () => void;
    let markCompensationCommitted!: () => void;
    const compensationCommitted = new Promise<void>((resolve) => {
      markCompensationCommitted = resolve;
    });
    const compensationRelease = new Promise<void>((resolve) => {
      releaseCompensation = resolve;
    });
    const target = googleUser();
    target.customClaims = { mfaEnrolled: true };
    const services = createSyntheticServices([target], {
      failTransaction: true,
      failTransactionNumber: 4,
      pauseAfterCompensationTransition: {
        onCommitted: markCompensationCommitted,
        wait: compensationRelease,
      },
    });
    const failedUpdate = provisionAdminRoleWithServices(
      callableRequest("owner", "academy-1"),
      { uid: target.uid, email: target.email, role: "administrator" },
      services,
    );

    try {
      await compensationCommitted;
      const lockPath = "academies/academy-1/adminRoleLocks/target-1";
      const beforeRenewal = services.firestore.records.get(lockPath)?.expiresAt;
      await vi.advanceTimersByTimeAsync(31_000);
      const afterRenewal = services.firestore.records.get(lockPath)?.expiresAt;

      expect(afterRenewal).toBeGreaterThan(beforeRenewal as number);
      releaseCompensation();
      await expect(failedUpdate).rejects.toThrow("synthetic firestore transaction failed");
      expect(target.customClaims).toEqual({ mfaEnrolled: true });
    } finally {
      releaseCompensation();
      vi.useRealTimers();
    }
  });

  it("rejects renewal from a stale process without changing a newer lock", async () => {
    const services = createSyntheticServices([]);
    const lockPath = "academies/academy-1/adminRoleLocks/target-1";
    const newerLock = {
      lockId: "newer-operation-lock",
      expiresAt: Date.now() + 30_000,
      leaseDeadline: Date.now() + 60_000,
      phase: "mutating",
    };
    services.firestore.records.set(lockPath, newerLock);

    await expect(
      renewRoleLock(services, {
        ref: services.firestore.doc(lockPath),
        lockId: "stale-operation-lock",
      } as never),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(services.firestore.records.get(lockPath)).toEqual(newerLock);
  });

  it("caps renewal at the finite absolute lease deadline", async () => {
    vi.useFakeTimers();
    const services = createSyntheticServices([]);
    const lockPath = "academies/academy-1/adminRoleLocks/target-1";
    const leaseDeadline = Date.now() + 5_000;
    services.firestore.records.set(lockPath, {
      lockId: "deadline-lock",
      expiresAt: Date.now() + 1_000,
      leaseDeadline,
      phase: "mutating",
    });

    try {
      await renewRoleLock(services, {
        ref: services.firestore.doc(lockPath),
        lockId: "deadline-lock",
      } as never);
      expect(services.firestore.records.get(lockPath)?.expiresAt).toBe(leaseDeadline);

      vi.setSystemTime(leaseDeadline);
      await expect(
        renewRoleLock(services, {
          ref: services.firestore.doc(lockPath),
          lockId: "deadline-lock",
        } as never),
      ).rejects.toMatchObject({ code: "aborted" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for an in-flight renewal before lease cleanup returns", async () => {
    vi.useFakeTimers();
    let releaseBeforeMutation!: () => void;
    let markMutationCommitted!: () => void;
    const mutationCommitted = new Promise<void>((resolve) => {
      markMutationCommitted = resolve;
    });
    const mutationRelease = new Promise<void>((resolve) => {
      releaseBeforeMutation = resolve;
    });
    let releaseRenewal!: () => void;
    let markRenewalPaused!: () => void;
    const renewalPaused = new Promise<void>((resolve) => {
      markRenewalPaused = resolve;
    });
    const renewalRelease = new Promise<void>((resolve) => {
      releaseRenewal = resolve;
    });
    let persistenceCommitted = false;
    const target = googleUser();
    const services = createSyntheticServices([target], {
      pauseAfterTransactionCommit: {
        transactionNumber: 3,
        onCommitted: markMutationCommitted,
        wait: mutationRelease,
      },
      pauseBeforeTransactionCommit: {
        transactionNumber: 4,
        onPaused: markRenewalPaused,
        wait: renewalRelease,
      },
      onTransactionCommitted: (transactionCount) => {
        if (transactionCount === 5) {
          persistenceCommitted = true;
        }
      },
    });

    try {
      const update = provisionAdminRoleWithServices(
        callableRequest("owner", "academy-1"),
        { uid: target.uid, email: target.email, role: "administrator" },
        services,
      );
      await mutationCommitted;
      await vi.advanceTimersByTimeAsync(10_000);
      await renewalPaused;
      releaseBeforeMutation();
      await vi.waitFor(() => expect(persistenceCommitted).toBe(true));

      let settled = false;
      void update.finally(() => {
        settled = true;
      });
      await vi.runAllTicks();
      expect(settled).toBe(false);

      releaseRenewal();
      await update;
    } finally {
      releaseBeforeMutation();
      releaseRenewal();
      vi.useRealTimers();
    }
  });

  it("blocks a newer operation while compensation owns the lock", async () => {
    let releaseCompensation!: () => void;
    let markCompensationCommitted!: () => void;
    const compensationCommitted = new Promise<void>((resolve) => {
      markCompensationCommitted = resolve;
    });
    const compensationRelease = new Promise<void>((resolve) => {
      releaseCompensation = resolve;
    });
    const target = googleUser();
    target.customClaims = { mfaEnrolled: true };
    const services = createSyntheticServices([target], {
      failTransaction: true,
      failTransactionNumber: 4,
      pauseAfterCompensationTransition: {
        onCommitted: markCompensationCommitted,
        wait: compensationRelease,
      },
    });

    const failedUpdate = provisionAdminRoleWithServices(
      callableRequest("owner", "academy-1"),
      { uid: target.uid, email: target.email, role: "administrator" },
      services,
    );
    await compensationCommitted;

    await expect(
      provisionAdminRoleWithServices(
        callableRequest("owner", "academy-1"),
        { uid: target.uid, email: target.email, role: "owner" },
        services,
      ),
    ).rejects.toMatchObject({ code: "aborted" });

    releaseCompensation();
    await expect(failedUpdate).rejects.toThrow("synthetic firestore transaction failed");
    expect(target.customClaims).toEqual({ mfaEnrolled: true });
    expect(services.firestore.records.has("academies/academy-1/adminRoleLocks/target-1")).toBe(
      false,
    );
  });

  it("blocks an equal-claims replacement while compensation owns the lock", async () => {
    let releaseCompensation!: () => void;
    let markCompensationCommitted!: () => void;
    const compensationCommitted = new Promise<void>((resolve) => {
      markCompensationCommitted = resolve;
    });
    const compensationRelease = new Promise<void>((resolve) => {
      releaseCompensation = resolve;
    });
    const target = googleUser();
    target.customClaims = { mfaEnrolled: true };
    const services = createSyntheticServices([target], {
      failTransaction: true,
      failTransactionNumber: 4,
      pauseAfterCompensationTransition: {
        onCommitted: markCompensationCommitted,
        wait: compensationRelease,
      },
    });

    const failedUpdate = provisionAdminRoleWithServices(
      callableRequest("owner", "academy-1"),
      { uid: target.uid, email: target.email, role: "administrator" },
      services,
    );
    await compensationCommitted;

    await expect(
      provisionAdminRoleWithServices(
        callableRequest("owner", "academy-1"),
        { uid: target.uid, email: target.email, role: "administrator" },
        services,
      ),
    ).rejects.toMatchObject({ code: "aborted" });

    releaseCompensation();
    await expect(failedUpdate).rejects.toThrow("synthetic firestore transaction failed");
    expect(target.customClaims).toEqual({ mfaEnrolled: true });
  });

  it("does not release the lock when compensation cannot transition it", async () => {
    const target = googleUser();
    target.customClaims = { mfaEnrolled: true };
    const services = createSyntheticServices([target], {
      failTransaction: true,
      failTransactionNumbers: [4, 5],
    });

    await expect(
      provisionAdminRoleWithServices(
        callableRequest("owner", "academy-1"),
        { uid: target.uid, email: target.email, role: "administrator" },
        services,
      ),
    ).rejects.toMatchObject({ code: "internal" });

    expect(target.customClaims).toEqual({
      mfaEnrolled: true,
      academyId: "academy-1",
      role: "administrator",
    });
    expect(services.firestore.records.get("academies/academy-1/adminRoleLocks/target-1")).toEqual(
      expect.objectContaining({ phase: "mutating", expiresAt: expect.any(Number) }),
    );
    expect(
      services.firestore.records.get("academies/academy-1/adminRoleLocks/target-1")?.expiresAt,
    ).toBeGreaterThan(Date.now());
  });

  it("keeps a compensating lock when Auth restoration cannot be verified", async () => {
    const target = googleUser();
    target.customClaims = { mfaEnrolled: true };
    let authReadCount = 0;
    const services = createSyntheticServices([target], {
      failTransaction: true,
      failTransactionNumber: 4,
      onGetUser: () => {
        authReadCount += 1;
        if (authReadCount === 2) {
          target.customClaims = {
            mfaEnrolled: true,
            academyId: "academy-1",
            role: "owner",
          };
        }
      },
    });

    await expect(
      provisionAdminRoleWithServices(
        callableRequest("owner", "academy-1"),
        { uid: target.uid, email: target.email, role: "administrator" },
        services,
      ),
    ).rejects.toMatchObject({ code: "aborted" });

    expect(target.customClaims).toEqual({
      mfaEnrolled: true,
      academyId: "academy-1",
      role: "owner",
    });
    expect(services.firestore.records.get("academies/academy-1/adminRoleLocks/target-1")).toEqual(
      expect.objectContaining({ phase: "compensating" }),
    );
  });

  it("keeps a compensating lock when recovery marking fails", async () => {
    const target = googleUser();
    target.customClaims = { mfaEnrolled: true };
    const failedTransactions: number[] = [];
    const services = createSyntheticServices([target], {
      failTransaction: true,
      failTransactionNumbers: [4, 6],
      onTransactionFailure: (_records, transactionCount) =>
        failedTransactions.push(transactionCount),
    });

    await expect(
      provisionAdminRoleWithServices(
        callableRequest("owner", "academy-1"),
        { uid: target.uid, email: target.email, role: "administrator" },
        services,
      ),
    ).rejects.toMatchObject({ code: "internal" });

    expect(failedTransactions).toEqual([4, 6]);
    expect(target.customClaims).toEqual({ mfaEnrolled: true });
    expect(services.firestore.records.get("academies/academy-1/adminRoleLocks/target-1")).toEqual(
      expect.objectContaining({ phase: "compensating" }),
    );
  });

  it("fails closed when a concurrent role update holds the target lock", async () => {
    let releaseFirstTransaction!: () => void;
    let markFirstTransactionCommitted!: () => void;
    const firstTransactionCommitted = new Promise<void>((resolve) => {
      markFirstTransactionCommitted = resolve;
    });
    const firstTransactionRelease = new Promise<void>((resolve) => {
      releaseFirstTransaction = resolve;
    });
    const target = googleUser();
    const services = createSyntheticServices([target], {
      pauseAfterFirstCommit: {
        onCommitted: markFirstTransactionCommitted,
        wait: firstTransactionRelease,
      },
    });

    const firstUpdate = provisionAdminRoleWithServices(
      callableRequest("owner", "academy-1"),
      { uid: target.uid, email: target.email, role: "administrator" },
      services,
    );
    await firstTransactionCommitted;

    await expect(
      provisionAdminRoleWithServices(
        callableRequest("owner", "academy-1"),
        { uid: target.uid, email: target.email, role: "owner" },
        services,
      ),
    ).rejects.toMatchObject({ code: "aborted" });

    releaseFirstTransaction();
    await firstUpdate;
    expect(target.customClaims).toEqual({ academyId: "academy-1", role: "administrator" });
    expect([...services.firestore.records.keys()]).not.toContain(
      "academies/academy-1/adminRoleLocks/target-1",
    );
  });

  it("rejects first-owner bootstrap outside the Firebase Auth and Firestore emulators", async () => {
    const previousAuthEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const previousFirestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;

    try {
      await expect(
        bootstrapEmulatorOwner({
          uid: "owner-1",
          email: "owner@example.test",
          academyId: "academy-1",
        }),
      ).rejects.toMatchObject({ code: "failed-precondition" });
    } finally {
      if (previousAuthEmulator === undefined) {
        delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
      } else {
        process.env.FIREBASE_AUTH_EMULATOR_HOST = previousAuthEmulator;
      }
      if (previousFirestoreEmulator === undefined) {
        delete process.env.FIRESTORE_EMULATOR_HOST;
      } else {
        process.env.FIRESTORE_EMULATOR_HOST = previousFirestoreEmulator;
      }
    }
  });

  it("rejects first-owner bootstrap when an emulator host is remote", async () => {
    const previousAuthEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const previousFirestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "192.0.2.10:9099";
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

    try {
      await expect(
        bootstrapEmulatorOwner({
          uid: "owner-1",
          email: "owner@example.test",
          academyId: "academy-1",
        }),
      ).rejects.toMatchObject({ code: "failed-precondition" });
    } finally {
      if (previousAuthEmulator === undefined) {
        delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
      } else {
        process.env.FIREBASE_AUTH_EMULATOR_HOST = previousAuthEmulator;
      }
      if (previousFirestoreEmulator === undefined) {
        delete process.env.FIRESTORE_EMULATOR_HOST;
      } else {
        process.env.FIRESTORE_EMULATOR_HOST = previousFirestoreEmulator;
      }
    }
  });

  it("writes import audit metadata without accepting a raw record", async () => {
    const services = createSyntheticServices([]);
    const event = {
      academyId: "academy-1",
      actorId: "system-importer",
      action: "regyfit.access.imported",
      targetRef: "academies/academy-1/regyfitAccessRecords",
      purpose: "approved synthetic import validation",
      correlationId: "correlation-1",
      recordCount: 10,
      contentSha256: "a".repeat(64),
      importRunId: "run-1",
    } as const;

    await writeImportAuditEvent(services.firestore as never, event);

    const audit = [...services.firestore.records.values()].find(
      (record) => record.action === event.action,
    );
    expect(audit).toEqual(expect.objectContaining(event));
    expect(audit).not.toHaveProperty("ip");
    expect(audit).not.toHaveProperty("memberDisplayName");
    expect(audit).not.toHaveProperty("memberNumber");
    await expect(
      writeImportAuditEvent(
        services.firestore as never,
        {
          ...event,
          rawRecord: { ip: "198.51.100.10" },
        } as never,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
