import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { createMemberRecoveryService, normalizeRecoveryName } from "./member-recovery-service.js";
import { buildInitialMemberDirectoryControlPlane } from "./member-directory-state.js";
import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import { createFamilyStore, type FamilyFirestore } from "../families/family-service.js";

const now = "2026-09-18T10:00:00.000Z";
const identitySecretMaterial = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const academyId = "academy-1";
const prefix = `academies/${academyId}/`;
const source = {
  recordId: "123",
  memberNumber: "MEM-123",
  fullName: "José Silva",
  email: "old@example.test",
  mobile: "+15550000001",
  birthDate: "1990-01-01",
  gender: "male",
  membershipState: "active",
  appAccess: {},
  graduation: {},
  plan: {},
  attendance: { records: [] },
  payments: [],
  capturedAt: now,
  source: "regyfit-admin-capture",
  schemaVersion: "1",
};
const profile = { trainingCenter: "Town" as const, trainingTimePreferences: ["evening" as const] };
function harness() {
  const state: MemberDirectoryState = {
    stateId: "current",
    academyId,
    readerVersion: "canonical-v1",
    directoryWriteMode: "canonical-v1",
    freezeStatus: "open",
    stateRevision: 0,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "complete",
    digestVersion: "hmac-sha256-v1",
    secretVersion: "identity-v1",
    identityKeyBaselineMac: "a".repeat(64),
    identityKeyBaselineArtifactId: "baseline-1",
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: 0,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: now,
    createdBy: "system-1",
    updatedAt: now,
    updatedBy: "system-1",
  };
  const control = buildInitialMemberDirectoryControlPlane({
    projectId: "demo-bpt-jersey",
    state,
    integritySecretMaterial,
    integritySecretVersion: "integrity-v1",
    now,
    actorId: "system-1",
  });
  const records = new Map<string, Record<string, unknown>>([
    [prefix + "regyfitMemberRecords/123", source],
    [prefix + "memberDirectoryStates/current", state],
    [`memberDirectoryRestoreGuards/${academyId}`, control.guard],
    [`memberDirectoryRestoreGuards/${academyId}/events/0`, control.event],
  ]);
  type QueryOptions = {
    filters?: readonly { field: string; operator: string; value: unknown }[];
    orders?: readonly { field: string; direction: "asc" | "desc" }[];
  };
  type Ref = { path: string; id: string; limit?: number } & QueryOptions;
  const ref = (path: string): Ref => ({ path, id: path.split("/").at(-1)! });
  const query = (path: string, extra: QueryOptions = {}) => ({
    ...ref(path),
    ...extra,
    limit: (count: number) => ({ ...ref(path), ...extra, limit: count }),
    orderBy: (field: string, direction: "asc" | "desc" = "asc") =>
      query(path, { ...extra, orders: [...(extra.orders ?? []), { field, direction }] }),
    where: (field: string, operator: string, value: unknown) =>
      query(path, { ...extra, filters: [...(extra.filters ?? []), { field, operator, value }] }),
  });
  let chain = Promise.resolve();
  const firestore = {
    doc: ref,
    collection: query,
    runTransaction: <T>(callback: (t: unknown) => Promise<T>) => {
      const result = chain.then(async () => {
        const pending: { ref: Ref; value: Record<string, unknown>; create: boolean }[] = [];
        let writing = false;
        const snapshot = (target: Ref) => ({
          ...target,
          exists: records.has(target.path),
          data: () => records.get(target.path),
        });
        const transaction = {
          get: async (target: Ref) => {
            if (writing) throw new Error("read after write");
            if (typeof target.limit === "number")
              return {
                docs: [...records.entries()]
                  .filter(
                    ([path, data]) =>
                      path.startsWith(target.path + "/") &&
                      path.split("/").length === target.path.split("/").length + 1 &&
                      (target.filters ?? []).every((filter) =>
                        filter.operator === "in"
                          ? (filter.value as unknown[]).includes(data[filter.field])
                          : filter.operator === "=="
                            ? data[filter.field] === filter.value
                            : filter.operator === ">" &&
                              typeof data[filter.field] === "string" &&
                              typeof filter.value === "string" &&
                              String(data[filter.field]) > filter.value,
                      ) &&
                      (target.orders ?? []).every((order) => data[order.field] !== undefined),
                  )
                  .sort(([a, left], [b, right]) => {
                    for (const order of target.orders ?? []) {
                      const result = String(left[order.field]).localeCompare(
                        String(right[order.field]),
                      );
                      if (result) return order.direction === "desc" ? -result : result;
                    }
                    return a.localeCompare(b);
                  })
                  .slice(0, target.limit)
                  .map(([path]) => snapshot(ref(path))),
              };
            return snapshot(target);
          },
          create: (target: Ref, value: Record<string, unknown>) => {
            writing = true;
            pending.push({ ref: target, value, create: true });
            return transaction;
          },
          set: (target: Ref, value: Record<string, unknown>) => {
            writing = true;
            pending.push({ ref: target, value, create: false });
            return transaction;
          },
        };
        const value = await callback(transaction);
        for (const write of pending)
          if (write.create && records.has(write.ref.path)) throw new Error("already exists");
        for (const write of pending) records.set(write.ref.path, write.value);
        return value;
      });
      chain = result.then(
        () => {},
        () => {},
      );
      return result;
    },
  } as unknown as Firestore;
  let user = {
    uid: "user-1",
    disabled: false,
    emailVerified: true,
    email: "old@example.test",
    displayName: "José Silva",
    customClaims: {} as Record<string, unknown>,
  };
  let failClaim = false;
  const auth = {
    getUser: async (uid: string) => ({ ...user, uid }),
    setCustomUserClaims: async (_uid: string, claims: Record<string, unknown>) => {
      if (failClaim) throw new Error("claim unavailable");
      user = { ...user, customClaims: claims };
    },
  };
  let currentTime = now;
  const service = createMemberRecoveryService({
    firestore,
    auth,
    academyId,
    projectId: "demo-bpt-jersey",
    identitySecretMaterial,
    integritySecretMaterial,
    identitySecretVersion: "identity-v1",
    integritySecretVersion: "integrity-v1",
    now: () => currentTime,
  });
  return {
    service,
    families: createFamilyStore({ firestore: firestore as unknown as FamilyFirestore, auth }),
    records,
    time: (value: string) => {
      currentTime = value;
    },
    user: (patch: Partial<typeof user>) => {
      user = { ...user, ...patch };
    },
    failClaim: (value: boolean) => {
      failClaim = value;
    },
    auth,
  };
}
const begin = (
  h: ReturnType<typeof harness>,
  email = "old@example.test",
  fullName = "José Silva",
) => h.service.begin({ fullName, email }, "192.0.2.1");

describe("legacy member recovery", () => {
  async function approve(h: ReturnType<typeof harness>, recoveryId: string, uid = "user-1") {
    const bound = await h.service.complete({ recoveryId }, uid);
    if (bound.status === "linked") return bound;
    const actor = queueOffice(h);
    const detail = await h.service.detail({ requestId: recoveryId }, actor);
    const candidate =
      detail.candidates.find((c) => c.source === "regyfit") ?? detail.candidates[0]!;
    return h.service.review(
      {
        requestId: recoveryId,
        decision: "approve",
        candidateId: candidate.candidateId,
        identityConfirmed: true,
      },
      actor,
    );
  }

  it.each([true, false])(
    "requires office review for a name-only request, stored email present: %s",
    async (hasEmail) => {
      const h = harness();
      const imported = { ...source };
      if (!hasEmail) Reflect.deleteProperty(imported, "email");
      h.records.set(prefix + "regyfitMemberRecords/123", imported);
      const ticket = await h.service.begin({ fullName: "  JOSE   SILVA " }, "192.0.2.1");
      expect(Object.keys(ticket).sort()).toEqual(["expiresAt", "recoveryId"]);
      expect(
        await h.service.complete({ recoveryId: ticket.recoveryId, profile }, "user-1"),
      ).toEqual({ status: "pending-review" });
      expect([...h.records.keys()].some((p) => p.startsWith(prefix + "students/"))).toBe(false);
      const actor = queueOffice(h);
      const detail = await h.service.detail({ requestId: ticket.recoveryId }, actor);
      expect(detail.request.previousEmail).toBe("");
      expect(detail.candidates).toHaveLength(1);
      h.user({ email: "new@example.test" });
      await h.service.complete({ recoveryId: ticket.recoveryId }, "user-1");
      await h.service.review(
        {
          requestId: ticket.recoveryId,
          decision: "approve",
          candidateId: detail.candidates[0]!.candidateId,
          identityConfirmed: true,
        },
        actor,
      );
      expect(
        await h.service.complete({ recoveryId: ticket.recoveryId, profile }, "user-1"),
      ).toEqual({ status: "linked" });
      expect(h.records.get(prefix + "regyfitMemberRecords/123")).toEqual(imported);
      expect(h.records.get(prefix + "users/user-1")).toMatchObject({ email: "new@example.test" });
    },
  );
  it("does not treat missing source emails as a match for an unrelated name", async () => {
    const h = harness();
    const imported = { ...source };
    Reflect.deleteProperty(imported, "email");
    h.records.set(prefix + "regyfitMemberRecords/123", imported);
    const ticket = await h.service.begin({ fullName: "Unknown Member", email: "  " }, "192.0.2.1");
    await h.service.complete({ recoveryId: ticket.recoveryId }, "user-1");
    const detail = await h.service.detail({ requestId: ticket.recoveryId }, queueOffice(h));
    expect(detail.candidates).toEqual([]);
    expect(detail.request.status).toBe("pending-review");
  });
  it("normalizes accents, case and repeated whitespace", () => {
    expect(normalizeRecoveryName("  JOSÉ   Silva ")).toBe("jose silva");
  });
  it("returns the same public shape on match and miss", async () => {
    const h = harness();
    const a = await begin(h),
      b = await begin(h, "missing@example.test", "Nobody");
    expect(Object.keys(a).sort()).toEqual(["expiresAt", "recoveryId"]);
    expect(Object.keys(b)).toEqual(Object.keys(a));
    expect(a.recoveryId).not.toBe(b.recoveryId);
  });
  it("bounds persistent public attempts", async () => {
    const h = harness();
    for (let i = 0; i < 10; i++) await begin(h);
    await expect(begin(h)).rejects.toMatchObject({ code: "resource-exhausted" });
  });
  it("never writes a member for an unverified account", async () => {
    const h = harness();
    h.user({ emailVerified: false });
    const ticket = await begin(h);
    expect(await h.service.complete({ recoveryId: ticket.recoveryId }, "user-1")).toEqual({
      status: "verify-email",
    });
    expect([...h.records.keys()].some((p) => p.startsWith(prefix + "students/"))).toBe(false);
  });
  it("requires review when the current account has a different email", async () => {
    const h = harness();
    h.user({ email: "new@example.test" });
    const ticket = await begin(h);
    expect(await h.service.complete({ recoveryId: ticket.recoveryId, profile }, "user-1")).toEqual({
      status: "pending-review",
    });
  });
  it("requires completion then atomically links and replays without duplicating source or student", async () => {
    const h = harness();
    const ticket = await begin(h);
    await approve(h, ticket.recoveryId);
    expect(await h.service.complete({ recoveryId: ticket.recoveryId }, "user-1")).toMatchObject({
      status: "profile-required",
      profile: { dateOfBirth: "1990-01-01" },
    });
    expect(await h.service.complete({ recoveryId: ticket.recoveryId, profile }, "user-1")).toEqual({
      status: "linked",
    });
    expect(await h.service.complete({ recoveryId: ticket.recoveryId, profile }, "user-1")).toEqual({
      status: "linked",
    });
    expect([...h.records.keys()].filter((p) => p.startsWith(prefix + "students/"))).toHaveLength(1);
    expect(h.records.get(prefix + "regyfitMemberRecords/123")).toEqual(source);
    expect((await h.auth.getUser("user-1")).customClaims).toMatchObject({
      role: "adultStudent",
      academyId,
    });
  });
  it("ignores obsolete access data and stored metadata without copying or changing the source", async () => {
    const h = harness();
    const stored = {
      ...source,
      academyId,
      appAccess: { password: { obsolete: "synthetic-import-marker" } },
    };
    const sourcePath = prefix + "regyfitMemberRecords/123";
    h.records.set(sourcePath, stored);
    const ticket = await begin(h);
    await approve(h, ticket.recoveryId);
    expect(await h.service.complete({ recoveryId: ticket.recoveryId, profile }, "user-1")).toEqual({
      status: "linked",
    });
    expect(h.records.get(sourcePath)).toEqual(stored);
    for (const [path, value] of h.records) {
      if (path !== sourcePath)
        expect(JSON.stringify(value)).not.toContain("synthetic-import-marker");
    }
  });
  it("preserves a durable link and repairs failed Auth promotion", async () => {
    const h = harness();
    const ticket = await begin(h);
    await approve(h, ticket.recoveryId);
    h.failClaim(true);
    await expect(
      h.service.complete({ recoveryId: ticket.recoveryId, profile }, "user-1"),
    ).rejects.toThrow();
    h.failClaim(false);
    expect(await h.service.complete({ recoveryId: ticket.recoveryId }, "user-1")).toEqual({
      status: "linked",
    });
    expect([...h.records.keys()].filter((p) => p.startsWith(prefix + "students/"))).toHaveLength(1);
  });
  it("rejects disabled, foreign academy and staff accounts", async () => {
    for (const patch of [
      { disabled: true },
      { customClaims: { academyId: "other", role: "shopper" } },
      { customClaims: { academyId, role: "owner" } },
    ]) {
      const h = harness();
      h.user(patch);
      const ticket = await begin(h);
      await expect(
        h.service.complete({ recoveryId: ticket.recoveryId }, "user-1"),
      ).rejects.toMatchObject({ code: "permission-denied" });
    }
  });
  it("sends minors and inactive legacy records to review", async () => {
    for (const patch of [{ birthDate: "2015-01-01" }, { membershipState: "inactive" }]) {
      const h = harness();
      h.records.set(prefix + "regyfitMemberRecords/123", { ...source, ...patch });
      const ticket = await begin(h);
      expect(
        await h.service.complete({ recoveryId: ticket.recoveryId, profile }, "user-1"),
      ).toEqual({ status: "pending-review" });
    }
  });
  it("serializes competing tickets and preserves one student", async () => {
    const h = harness();
    const a = await begin(h),
      b = await begin(h);
    await approve(h, a.recoveryId);
    await approve(h, b.recoveryId);
    const results = await Promise.all([
      h.service.complete({ recoveryId: a.recoveryId, profile }, "user-1"),
      h.service.complete({ recoveryId: b.recoveryId, profile }, "user-1"),
    ]);
    expect(results).toEqual([{ status: "linked" }, { status: "linked" }]);
    expect([...h.records.keys()].filter((p) => p.startsWith(prefix + "students/"))).toHaveLength(1);
  });
  it("rejects expired tickets and tickets bound to another account", async () => {
    const h = harness();
    const ticket = await begin(h);
    await h.service.complete({ recoveryId: ticket.recoveryId }, "user-1");
    await expect(
      h.service.complete({ recoveryId: ticket.recoveryId }, "user-2"),
    ).rejects.toMatchObject({ code: "permission-denied" });
    h.time("2026-10-20T10:00:00.000Z");
    await expect(
      h.service.complete({ recoveryId: ticket.recoveryId }, "user-1"),
    ).rejects.toMatchObject({ code: "deadline-exceeded" });
  });
  it("requires review for duplicate legacy names and email", async () => {
    const h = harness();
    h.records.set(prefix + "regyfitMemberRecords/124", { ...source, recordId: "124" });
    const ticket = await begin(h);
    expect(await h.service.complete({ recoveryId: ticket.recoveryId, profile }, "user-1")).toEqual({
      status: "pending-review",
    });
  });
  it("does not overwrite an existing account link", async () => {
    const h = harness();
    const a = await begin(h),
      b = await begin(h);
    await h.service.complete({ recoveryId: a.recoveryId, profile }, "user-1");
    expect(await h.service.complete({ recoveryId: b.recoveryId, profile }, "user-2")).toEqual({
      status: "pending-review",
    });
    expect(
      [...h.records.values()].filter((value) => value.studentId && value.userId === "user-2"),
    ).toHaveLength(0);
  });
  it("preserves source birth date and phone when completion tries to replace them", async () => {
    const h = harness();
    const ticket = await begin(h);
    await approve(h, ticket.recoveryId);
    await h.service.complete(
      {
        recoveryId: ticket.recoveryId,
        profile: { ...profile, dateOfBirth: "1980-01-01", phoneNumber: "+15550000099" },
      },
      "user-1",
    );
    const student = [...h.records.entries()].find(([path]) =>
      path.startsWith(prefix + "students/"),
    )?.[1];
    expect(student).toMatchObject({ dateOfBirth: source.birthDate, phoneNumber: source.mobile });
  });
  it("requires active provisioned admin and explicit identity confirmation for review", async () => {
    const h = harness();
    h.user({ email: "new@example.test" });
    const ticket = await begin(h);
    await h.service.complete({ recoveryId: ticket.recoveryId }, "user-1");
    const actor = {
      actorId: "office-1",
      academyId,
      role: "owner" as const,
      active: true,
      appCheckVerified: true,
    };
    await expect(h.service.detail({ requestId: ticket.recoveryId }, actor)).rejects.toMatchObject({
      code: "permission-denied",
    });
    h.records.set(prefix + "users/office-1", {
      userId: "office-1",
      academyId,
      accountType: "staff",
      displayName: "Office",
      email: "office@example.test",
      authProvider: "google",
      active: true,
      adminRole: "owner",
      lastRoleChangeAuditId: "audit-1",
      createdAt: Timestamp.now(),
      createdBy: "office-1",
      updatedAt: Timestamp.now(),
      updatedBy: "office-1",
      status: "active",
      schemaVersion: 1,
    });
    const detail = await h.service.detail({ requestId: ticket.recoveryId }, actor);
    const candidateId = detail.candidates[0]!.candidateId;
    expect(JSON.stringify(detail)).not.toContain("recordId");
    await expect(
      h.service.review({ requestId: ticket.recoveryId, decision: "approve", candidateId }, actor),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(
      await h.service.review(
        { requestId: ticket.recoveryId, decision: "approve", candidateId, identityConfirmed: true },
        actor,
      ),
    ).toMatchObject({ status: "profile-required" });
    expect(await h.service.complete({ recoveryId: ticket.recoveryId, profile }, "user-1")).toEqual({
      status: "linked",
    });
  });

  it("reuses an existing canonical student, retaining creation fields and profile metadata", async () => {
    const h = harness();
    const initial = await begin(h);
    await approve(h, initial.recoveryId);
    await h.service.complete({ recoveryId: initial.recoveryId, profile }, "user-1");
    const [studentPath, old] = [...h.records.entries()].find(([path]) =>
      path.startsWith(prefix + "students/"),
    )!;
    const unlinked: Record<string, unknown> = {
      ...old,
      photoUrl: "https://example.test/member.jpg",
    };
    delete unlinked.userId;
    h.records.set(studentPath, unlinked);
    h.records.delete(prefix + "users/user-1");
    for (const [path, value] of h.records) {
      if (
        path.startsWith(prefix + "regyfitMemberLinks/") ||
        path.startsWith(prefix + "memberRecoveryWriteReceipts/") ||
        (path.startsWith(prefix + "studentIdentityKeys/") && value.kind === "auth-user-id")
      )
        h.records.delete(path);
    }
    const next = await begin(h);
    await approve(h, next.recoveryId);
    expect(await h.service.complete({ recoveryId: next.recoveryId }, "user-1")).toEqual({
      status: "linked",
    });
    expect(h.records.get(studentPath)).toMatchObject({
      studentId: old.studentId,
      createdAt: old.createdAt,
      photoUrl: "https://example.test/member.jpg",
      userId: "user-1",
    });
    expect(
      [...h.records.keys()].filter((path) => path.startsWith(prefix + "students/")),
    ).toHaveLength(1);
    expect(
      h.records.get(prefix + "memberDirectoryStates/current")?.rollbackEligibleStudentCount,
    ).toBe(1);
  });
  it.each(["complete", "review"] as const)(
    "claims an office family with guardianContact and keeps it readable after %s",
    async (action) => {
      const h = harness();
      const initial = await begin(h);
      await approve(h, initial.recoveryId);
      await h.service.complete({ recoveryId: initial.recoveryId, profile }, "user-1");
      const [studentPath, student] = [...h.records.entries()].find(([path]) =>
        path.startsWith(prefix + "students/"),
      )!;
      const offline = { ...student };
      delete offline.userId;
      h.records.set(studentPath, offline);
      const familyPath = prefix + "families/" + student.familyId;
      const family = h.records.get(familyPath)!;
      h.records.set(familyPath, {
        ...family,
        primaryContactUserId: null,
        billingContactUserId: null,
        guardianContact: { fullName: "Synthetic Guardian", email: "guardian@example.test" },
      });
      h.records.set(prefix + "regyfitOfficeLinks/123", {
        academyId,
        recordId: "123",
        studentId: student.studentId,
        schemaVersion: "1",
        createdAt: now,
        createdBy: "owner-1",
      });
      h.records.delete(prefix + "users/user-1");
      for (const [path, value] of h.records) {
        if (
          path.startsWith(prefix + "regyfitMemberLinks/") ||
          path.startsWith(prefix + "memberRecoveryWriteReceipts/") ||
          (path.startsWith(prefix + "studentIdentityKeys/") && value.kind === "auth-user-id")
        )
          h.records.delete(path);
      }
      const next = await begin(h);
      if (action === "review") {
        h.user({ email: "new@example.test" });
        expect(await h.service.complete({ recoveryId: next.recoveryId }, "user-1")).toEqual({
          status: "pending-review",
        });
        const actor = queueOffice(h);
        const detail = await h.service.detail({ requestId: next.recoveryId }, actor);
        expect(
          await h.service.review(
            {
              requestId: next.recoveryId,
              decision: "approve",
              candidateId: detail.candidates[0]!.candidateId,
              identityConfirmed: true,
            },
            actor,
          ),
        ).toEqual({ status: "linked" });
      } else {
        await approve(h, next.recoveryId);
        expect(await h.service.complete({ recoveryId: next.recoveryId }, "user-1")).toEqual({
          status: "linked",
        });
      }
      expect(h.records.get(familyPath)).toMatchObject({
        familyId: student.familyId,
        primaryContactUserId: "user-1",
        billingContactUserId: "user-1",
        createdAt: family.createdAt,
      });
      expect(h.records.get(familyPath)).not.toHaveProperty("guardianContact");
      await expect(
        h.families.getStaffFamily(academyId, String(student.familyId)),
      ).resolves.toMatchObject({
        family: { familyId: student.familyId, primaryContactUserId: "user-1" },
      });
      expect(h.records.get(studentPath)).toMatchObject({
        studentId: student.studentId,
        userId: "user-1",
      });
      expect(
        [...h.records.keys()].filter((path) => path.startsWith(prefix + "students/")),
      ).toHaveLength(1);
    },
  );
  it("fails closed when the directory is frozen without writing source links", async () => {
    const h = harness();
    h.records.set(prefix + "memberDirectoryStates/current", {
      ...h.records.get(prefix + "memberDirectoryStates/current"),
      freezeStatus: "frozen",
    });
    const ticket = await begin(h);
    await expect(approve(h, ticket.recoveryId)).rejects.toThrow();
    expect(h.records.has(prefix + "regyfitMemberLinks/123")).toBe(false);
  });
  it("allows an authenticated pending request to resume after a week while unbound tickets expire", async () => {
    const h = harness();
    h.user({ email: "new@example.test" });
    const bound = await begin(h);
    const unbound = await begin(h);
    await h.service.complete({ recoveryId: bound.recoveryId }, "user-1");
    h.time("2026-09-25T10:00:00.000Z");
    expect(await h.service.complete({ recoveryId: bound.recoveryId }, "user-1")).toEqual({
      status: "pending-review",
    });
    await expect(
      h.service.complete({ recoveryId: unbound.recoveryId }, "user-1"),
    ).rejects.toMatchObject({ code: "deadline-exceeded" });
  });
  it.each(["2030-01-01", "1990-01-01"])(
    "requires review for recorded minor age with conflicting DOB %s",
    async (birthDate) => {
      const h = harness();
      const imported = { ...source, age: 12, birthDate };
      h.records.set(prefix + "regyfitMemberRecords/123", imported);
      const ticket = await begin(h);
      expect(
        await h.service.complete(
          { recoveryId: ticket.recoveryId, profile: { ...profile, dateOfBirth: "1990-01-01" } },
          "user-1",
        ),
      ).toEqual({ status: "pending-review" });
      expect(
        [...h.records.keys()].filter(
          (path) =>
            path.startsWith(prefix + "students/") ||
            path.startsWith(prefix + "regyfitMemberLinks/"),
        ),
      ).toEqual([]);
      expect((await h.auth.getUser("user-1")).customClaims).toEqual({});
      expect(h.records.get(prefix + "regyfitMemberRecords/123")).toEqual(imported);
      expect(h.records.get(prefix + "memberDirectoryStates/current")?.stateRevision).toBe(0);
    },
  );
  it("requires review for any future imported birth date instead of replacing it with supplied adult data", async () => {
    const h = harness();
    h.records.set(prefix + "regyfitMemberRecords/123", {
      ...source,
      age: 36,
      birthDate: "2030-01-01",
    });
    const ticket = await begin(h);
    expect(
      await h.service.complete(
        { recoveryId: ticket.recoveryId, profile: { ...profile, dateOfBirth: "1990-01-01" } },
        "user-1",
      ),
    ).toEqual({ status: "pending-review" });
    expect([...h.records.keys()].filter((path) => path.startsWith(prefix + "students/"))).toEqual(
      [],
    );
  });
  it.each([undefined, "1990-01-01"])(
    "does not merge another person with a shared email and DOB %s, even after office approval",
    async (birthDate) => {
      const h = harness();
      const first: Record<string, unknown> = { ...source };
      delete first.memberNumber;
      h.records.set(prefix + "regyfitMemberRecords/123", first);
      const initial = await begin(h);
      await approve(h, initial.recoveryId);
      expect(
        await h.service.complete({ recoveryId: initial.recoveryId, profile }, "user-1"),
      ).toEqual({ status: "linked" });
      const studentBefore = [...h.records.entries()].find(([path]) =>
        path.startsWith(prefix + "students/"),
      )!;
      const second: Record<string, unknown> = {
        ...first,
        recordId: "124",
        fullName: "Maria Silva",
      };
      if (birthDate) second.birthDate = birthDate;
      else delete second.birthDate;
      h.records.set(prefix + "regyfitMemberRecords/124", second);
      const ticket = await begin(h, "old@example.test", "Maria Silva");
      expect(
        await h.service.complete({ recoveryId: ticket.recoveryId, profile }, "user-1"),
      ).toEqual({ status: "pending-review" });
      const actor = {
        actorId: "office-1",
        academyId,
        role: "owner" as const,
        active: true,
        appCheckVerified: true,
      };
      h.records.set(prefix + "users/office-1", {
        userId: "office-1",
        academyId,
        accountType: "staff",
        displayName: "Office",
        email: "office@example.test",
        authProvider: "google",
        active: true,
        adminRole: "owner",
        lastRoleChangeAuditId: "audit-1",
        createdAt: Timestamp.now(),
        createdBy: "office-1",
        updatedAt: Timestamp.now(),
        updatedBy: "office-1",
        status: "active",
        schemaVersion: 1,
      });
      const detail = await h.service.detail({ requestId: ticket.recoveryId }, actor);
      const candidateId = detail.candidates.find(
        (candidate) => candidate.fullName === "Maria Silva",
      )!.candidateId;
      expect(
        await h.service.review(
          {
            requestId: ticket.recoveryId,
            decision: "approve",
            candidateId,
            identityConfirmed: true,
          },
          actor,
        ),
      ).toEqual({ status: "pending-review" });
      expect(h.records.has(prefix + "regyfitMemberLinks/124")).toBe(false);
      expect(h.records.get(studentBefore[0])).toEqual(studentBefore[1]);
      expect(
        [...h.records.keys()].filter((path) => path.startsWith(prefix + "students/")),
      ).toHaveLength(1);
      expect(h.records.get(prefix + "memberDirectoryStates/current")?.stateRevision).toBe(1);
    },
  );
  it("requires review when an adult source age contradicts DOB at capture time", async () => {
    const h = harness();
    h.records.set(prefix + "regyfitMemberRecords/123", { ...source, age: 30 });
    const ticket = await begin(h);
    expect(await h.service.complete({ recoveryId: ticket.recoveryId, profile }, "user-1")).toEqual({
      status: "pending-review",
    });
  });
  it("accepts consistent captured age and reuses a matching person with name and source DOB", async () => {
    const h = harness();
    const imported: Record<string, unknown> = { ...source, age: 36 };
    delete imported.memberNumber;
    h.records.set(prefix + "regyfitMemberRecords/123", imported);
    const initial = await begin(h);
    await approve(h, initial.recoveryId);
    expect(await h.service.complete({ recoveryId: initial.recoveryId, profile }, "user-1")).toEqual(
      { status: "linked" },
    );
    h.records.set(prefix + "regyfitMemberRecords/124", {
      ...imported,
      recordId: "124",
      fullName: "JOSE SILVA",
      email: "new@example.test",
    });
    h.user({ email: "new@example.test" });
    const duplicate = await begin(h, "new@example.test");
    await approve(h, duplicate.recoveryId);
    expect(await h.service.complete({ recoveryId: duplicate.recoveryId }, "user-1")).toEqual({
      status: "linked",
    });
    expect(
      [...h.records.keys()].filter((path) => path.startsWith(prefix + "students/")),
    ).toHaveLength(1);
  });
  function queueOffice(h: ReturnType<typeof harness>) {
    const actor = {
      actorId: "office-queue",
      academyId,
      role: "owner" as const,
      active: true,
      appCheckVerified: true,
    };
    h.records.set(prefix + "users/office-queue", {
      userId: actor.actorId,
      academyId,
      accountType: "staff",
      displayName: "Office",
      email: "office@example.test",
      authProvider: "google",
      active: true,
      adminRole: "owner",
      lastRoleChangeAuditId: "audit-1",
      createdAt: Timestamp.now(),
      createdBy: actor.actorId,
      updatedAt: Timestamp.now(),
      updatedBy: actor.actorId,
      status: "active",
      schemaVersion: 1,
    });
    return actor;
  }
  function seedQueue(
    h: ReturnType<typeof harness>,
    count: number,
    offset: number,
    overrides: Record<string, unknown> = {},
  ) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const recoveryId = (offset + i).toString(16).padStart(64, "0");
      ids.push(recoveryId);
      h.records.set(prefix + "memberRecoveryRequests/" + recoveryId, {
        recoveryId,
        academyId,
        fullName: "Synthetic Queue Member",
        previousEmail: "previous@example.test",
        createdAt: new Date(Date.parse("2026-09-17T10:00:00.000Z") + i * 1000).toISOString(),
        updatedAt: now,
        expiresAt: new Date(Date.parse("2026-10-17T10:00:00.000Z") + i * 1000).toISOString(),
        candidates: [],
        userId: "queue-member-" + i,
        accountEmail: "current@example.test",
        accountVerified: true,
        status: "pending-review",
        ...overrides,
      });
    }
    return ids;
  }
  it("keeps verified actionable requests reachable beyond over 50 terminal, expired, unbound and unverified tickets", async () => {
    const h = harness();
    const actor = queueOffice(h);
    const actionable = seedQueue(h, 1, 999);
    seedQueue(h, 60, 1000, { status: "rejected" });
    seedQueue(h, 60, 2000, { status: "linked" });
    seedQueue(h, 60, 3000, { expiresAt: "2026-09-18T09:00:00.000Z" });
    const unbound = seedQueue(h, 60, 4000, { accountVerified: false });
    for (const id of unbound) {
      const value = { ...h.records.get(prefix + "memberRecoveryRequests/" + id) };
      delete value.userId;
      delete value.accountEmail;
      h.records.set(prefix + "memberRecoveryRequests/" + id, value);
    }
    seedQueue(h, 60, 5000, { accountVerified: false });
    seedQueue(h, 60, 6000, { status: "profile-required", expiresAt: now });
    const first = await h.service.list(actor);
    expect(first.truncated).toBe(false);
    expect(first.requests.map((value) => value.requestId)).toEqual(actionable);
    expect(await h.service.list(actor)).toEqual(first);
  });
  it("serves more than 50 actionable requests in oldest binding order and reveals the next requests after resolutions", async () => {
    const h = harness();
    const actor = queueOffice(h);
    const ids = seedQueue(h, 65, 1000);
    const first = await h.service.list(actor);
    expect(first.truncated).toBe(true);
    expect(first.requests.map((value) => value.requestId)).toEqual(ids.slice(0, 50));
    for (let i = 0; i < 50; i++) {
      if (i % 20 === 0)
        h.time(new Date(Date.parse(now) + Math.floor(i / 20) * 16 * 60000).toISOString());
      await h.service.review({ requestId: ids[i], decision: "reject" }, actor);
    }
    const next = await h.service.list(actor);
    expect(next.truncated).toBe(false);
    expect(next.requests.map((value) => value.requestId)).toEqual(ids.slice(50));
    // Expiring the oldest still-pending request cannot consume a page slot.
    h.records.set(prefix + "memberRecoveryRequests/" + ids[50], {
      ...h.records.get(prefix + "memberRecoveryRequests/" + ids[50]),
      expiresAt: now,
    });
    expect((await h.service.list(actor)).requests.map((value) => value.requestId)).toEqual(
      ids.slice(51),
    );
  });
  it("queues only a bound account verified by the latest completion and removes resolved requests", async () => {
    const h = harness();
    const actor = queueOffice(h);
    const ticket = await begin(h);
    expect((await h.service.list(actor)).requests).toEqual([]);
    h.user({ email: "new@example.test", emailVerified: false });
    await h.service.complete({ recoveryId: ticket.recoveryId }, "user-1");
    expect((await h.service.list(actor)).requests).toEqual([
      expect.objectContaining({ status: "verify-email", accountVerified: false }),
    ]);
    h.user({ emailVerified: true });
    await h.service.complete({ recoveryId: ticket.recoveryId }, "user-1");
    expect((await h.service.list(actor)).requests.map((value) => value.requestId)).toEqual([
      ticket.recoveryId,
    ]);
    h.user({ emailVerified: false });
    await h.service.complete({ recoveryId: ticket.recoveryId }, "user-1");
    expect((await h.service.list(actor)).requests).toEqual([
      expect.objectContaining({ status: "verify-email", accountVerified: false }),
    ]);
    h.user({ emailVerified: true });
    await h.service.complete({ recoveryId: ticket.recoveryId }, "user-1");
    await h.service.review({ requestId: ticket.recoveryId, decision: "reject" }, actor);
    expect((await h.service.list(actor)).requests).toEqual([]);
  });
  it("declares the deployable index for verified, unexpired pending queue order", () => {
    const indexes = JSON.parse(
      readFileSync(new URL("../../../../firestore.indexes.json", import.meta.url), "utf8"),
    ) as { indexes: unknown[] };
    expect(indexes.indexes).toContainEqual({
      collectionGroup: "memberRecoveryRequests",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "accountVerified", order: "ASCENDING" },
        { fieldPath: "expiresAt", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "ASCENDING" },
      ],
    });
  });
});
