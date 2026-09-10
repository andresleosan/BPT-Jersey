import { describe, expect, it } from "vitest";

import {
  parseGrantPermissionCommand,
  parseRevokePermissionCommand,
} from "@bpt-jersey/domain/staff/permission-grants";

import {
  PermissionGrantError,
  createPermissionGrantService,
  type GrantFirestore,
} from "./permission-grant-service";

const academyId = "academy-1";
const now = "2026-09-05T12:00:00.000Z";
const expiresAt = "2026-10-05T12:00:00.000Z";

type Data = Record<string, unknown>;

function grantCommand(overrides: Record<string, unknown> = {}) {
  const parsed = parseGrantPermissionCommand({
    subjectUserId: "coach-1",
    permission: "reviewPenalties",
    reason: "Covers the office desk while Ana is away",
    expiresAt,
    ...overrides,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function revokeCommand(grantId: string) {
  const parsed = parseRevokePermissionCommand({ grantId, reason: "Ana is back at the desk" });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function staffDoc(userId: string, role: string, overrides: Partial<Data> = {}): Data {
  return {
    staffId: `staff-${userId}`,
    academyId,
    userId,
    role,
    active: true,
    status: "active",
    schemaVersion: "1",
    ...overrides,
  };
}

function fixture(seed: Map<string, Data> = new Map()) {
  const documents = new Map<string, Data>(seed);
  function query(path: string, filters: readonly (readonly [string, unknown])[]) {
    const self = {
      where: (field: string, _operator: string, value: unknown) =>
        query(path, [...filters, [field, value] as const]),
      limit: () => self,
      get: async () => {
        const prefix = `${path}/`;
        return {
          docs: [...documents.entries()]
            .filter(
              ([documentPath, data]) =>
                documentPath.startsWith(prefix) &&
                !documentPath.slice(prefix.length).includes("/") &&
                filters.every(([field, value]) => data[field] === value),
            )
            .map(([documentPath, data]) => ({
              id: documentPath.split("/").at(-1) ?? "",
              exists: true,
              data: () => data,
            })),
        };
      },
    };
    return self as unknown as ReturnType<GrantFirestore["collection"]>;
  }

  const firestore = {
    doc: (path: string) => ({ id: path.split("/").at(-1) ?? "", path }),
    collection: (path: string) => query(path, []),
    runTransaction: async <T>(update: (transaction: unknown) => Promise<T>) =>
      update({
        get: async (reference: { path: string }) => ({
          id: reference.path.split("/").at(-1) ?? "",
          exists: documents.has(reference.path),
          data: () => documents.get(reference.path),
        }),
        create: (reference: { path: string }, data: Data) => documents.set(reference.path, data),
        set: (reference: { path: string }, data: Data) => documents.set(reference.path, data),
      }),
  } as unknown as GrantFirestore;

  return {
    documents,
    service: createPermissionGrantService({
      firestore,
      now: () => now,
      newGrantId: () => "grant-1",
    }),
  };
}

function withCoach() {
  return new Map<string, Data>([
    [`academies/${academyId}/staff/staff-coach-1`, staffDoc("coach-1", "coach")],
  ]);
}

describe("createPermissionGrantService (T116)", () => {
  it("grants a listed permission to a coach and audits it, without touching any claim", async () => {
    const { service, documents } = fixture(withCoach());
    const grant = await service.grantPermission({
      academyId,
      actorId: "owner-1",
      actorRole: "owner",
      command: grantCommand(),
    });

    expect(grant).toMatchObject({
      grantId: "grant-1",
      subjectUserId: "coach-1",
      permission: "reviewPenalties",
      grantedBy: "owner-1",
      status: "active",
    });
    expect(documents.has(`academies/${academyId}/staffPermissionGrants/grant-1`)).toBe(true);
    expect(
      documents.has(`academies/${academyId}/auditEvents/staff-permission-granted-grant-1`),
    ).toBe(true);
    // The staff record is untouched: the role a coach signs in with is still "coach".
    expect(documents.get(`academies/${academyId}/staff/staff-coach-1`)).toMatchObject({
      role: "coach",
    });
  });

  it("reads the subject's role from the staff record, not from the caller", async () => {
    // No staff record at all: nothing the caller sends can invent one.
    const { service } = fixture();
    await expect(
      service.grantPermission({
        academyId,
        actorId: "owner-1",
        actorRole: "owner",
        command: grantCommand(),
      }),
    ).rejects.toThrow(PermissionGrantError);
  });

  it("refuses a coach who tries to grant, and an owner who grants to an administrator", async () => {
    const seed = withCoach();
    seed.set(`academies/${academyId}/staff/staff-admin-1`, staffDoc("admin-1", "administrator"));
    const { service } = fixture(seed);
    await expect(
      service.grantPermission({
        academyId,
        actorId: "coach-2",
        actorRole: "coach",
        command: grantCommand(),
      }),
    ).rejects.toThrow(PermissionGrantError);
    await expect(
      service.grantPermission({
        academyId,
        actorId: "owner-1",
        actorRole: "owner",
        command: grantCommand({ subjectUserId: "admin-1" }),
      }),
    ).rejects.toThrow(PermissionGrantError);
  });

  it("refuses an inactive coach", async () => {
    const seed = new Map<string, Data>([
      [
        `academies/${academyId}/staff/staff-coach-1`,
        staffDoc("coach-1", "coach", { active: false, status: "inactive" }),
      ],
    ]);
    const { service } = fixture(seed);
    await expect(
      service.grantPermission({
        academyId,
        actorId: "owner-1",
        actorRole: "owner",
        command: grantCommand(),
      }),
    ).rejects.toThrow(PermissionGrantError);
  });

  it("never mints the same grant twice", async () => {
    const { service } = fixture(withCoach());
    await service.grantPermission({
      academyId,
      actorId: "owner-1",
      actorRole: "owner",
      command: grantCommand(),
    });
    await expect(
      service.grantPermission({
        academyId,
        actorId: "owner-1",
        actorRole: "owner",
        command: grantCommand(),
      }),
    ).rejects.toThrow(PermissionGrantError);
  });

  it("answers the read-side question for the holder and refuses everyone else", async () => {
    const { service } = fixture(withCoach());
    await service.grantPermission({
      academyId,
      actorId: "owner-1",
      actorRole: "owner",
      command: grantCommand(),
    });

    await expect(
      service.evaluatePermission({
        academyId,
        subjectUserId: "coach-1",
        permission: "reviewPenalties",
      }),
    ).resolves.toMatchObject({ allowed: true, grantId: "grant-1" });
    await expect(
      service.evaluatePermission({
        academyId,
        subjectUserId: "coach-2",
        permission: "reviewPenalties",
      }),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      service.evaluatePermission({
        academyId,
        subjectUserId: "coach-1",
        permission: "manageClasses",
      }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("closes the door the moment office revokes, and audits the revocation", async () => {
    const { service, documents } = fixture(withCoach());
    await service.grantPermission({
      academyId,
      actorId: "owner-1",
      actorRole: "owner",
      command: grantCommand(),
    });

    const revoked = await service.revokePermission({
      academyId,
      actorId: "admin-1",
      actorRole: "administrator",
      command: revokeCommand("grant-1"),
    });
    expect(revoked).toMatchObject({
      status: "revoked",
      revokedBy: "admin-1",
      revocationReason: "Ana is back at the desk",
    });
    expect(
      documents.has(`academies/${academyId}/auditEvents/staff-permission-revoked-grant-1`),
    ).toBe(true);
    await expect(
      service.evaluatePermission({
        academyId,
        subjectUserId: "coach-1",
        permission: "reviewPenalties",
      }),
    ).resolves.toMatchObject({ allowed: false, grantId: null });
  });

  it("refuses a second revocation and a revocation by anyone but office", async () => {
    const { service } = fixture(withCoach());
    await service.grantPermission({
      academyId,
      actorId: "owner-1",
      actorRole: "owner",
      command: grantCommand(),
    });
    await expect(
      service.revokePermission({
        academyId,
        actorId: "coach-1",
        actorRole: "coach",
        command: revokeCommand("grant-1"),
      }),
    ).rejects.toThrow(PermissionGrantError);
    await service.revokePermission({
      academyId,
      actorId: "owner-1",
      actorRole: "owner",
      command: revokeCommand("grant-1"),
    });
    await expect(
      service.revokePermission({
        academyId,
        actorId: "owner-1",
        actorRole: "owner",
        command: revokeCommand("grant-1"),
      }),
    ).rejects.toThrow(PermissionGrantError);
  });

  it("stops allowing once the grant expires, with nothing having to sweep it", async () => {
    const { service } = fixture(withCoach());
    await service.grantPermission({
      academyId,
      actorId: "owner-1",
      actorRole: "owner",
      command: grantCommand(),
    });
    await expect(
      service.evaluatePermission({
        academyId,
        subjectUserId: "coach-1",
        permission: "reviewPenalties",
        now: "2026-12-01T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("lists the academy's grants with their live status, newest first", async () => {
    const { service } = fixture(withCoach());
    await service.grantPermission({
      academyId,
      actorId: "owner-1",
      actorRole: "owner",
      command: grantCommand(),
    });
    const listed = await service.listPermissionGrants({ academyId });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ grantId: "grant-1", status: "active" });
  });

  it("refuses an invalid tenant or identifier before reading anything", async () => {
    const { service } = fixture(withCoach());
    await expect(service.listPermissionGrants({ academyId: "../escape" })).rejects.toThrow(
      PermissionGrantError,
    );
    await expect(
      service.evaluatePermission({
        academyId,
        subjectUserId: "../escape",
        permission: "reviewPenalties",
      }),
    ).rejects.toThrow(PermissionGrantError);
  });

  it("never reads a grant that belongs to another academy", async () => {
    const seed = withCoach();
    seed.set(`academies/${academyId}/staffPermissionGrants/foreign`, {
      grantId: "foreign",
      academyId: "academy-2",
      subjectUserId: "coach-1",
      permission: "reviewPenalties",
      expiresAt,
      revokedAt: null,
    });
    const { service } = fixture(seed);
    await expect(
      service.evaluatePermission({
        academyId,
        subjectUserId: "coach-1",
        permission: "reviewPenalties",
      }),
    ).resolves.toMatchObject({ allowed: false });
  });
});
