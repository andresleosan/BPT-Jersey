import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalizeDisclaimerContent,
  parseDisclaimerPublicationInput,
  type DisclaimerPublicationInput,
} from "@bpt-jersey/domain/consents/disclaimers";

import {
  DisclaimerError,
  createDisclaimerService,
  type DisclaimerFirestore,
} from "./disclaimer-service";

const academyId = "academy-1";
const now = "2026-09-05T12:00:00.000Z";

type Data = Record<string, unknown>;

function publication(overrides: Record<string, unknown> = {}): DisclaimerPublicationInput {
  const parsed = parseDisclaimerPublicationInput({
    key: "photo-consent",
    versionLabel: "v1",
    title: "Photography at open mat",
    body: "Synthetic placeholder body for the pilot. No legal wording ships in this repository.",
    audience: "all",
    required: true,
    effectiveAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
}

function hashOf(input: DisclaimerPublicationInput): string {
  return createHash("sha256").update(canonicalizeDisclaimerContent(input), "utf8").digest("hex");
}

function adultStudent(studentId: string, userId: string): Data {
  return { studentId, academyId, participantType: "adult", userId, fullName: "Alex Adult" };
}

function minorStudent(studentId: string): Data {
  return { studentId, academyId, participantType: "minor", userId: null, fullName: "Mo Minor" };
}

function relationship(studentId: string, adultUserId: string, overrides: Partial<Data> = {}): Data {
  return {
    relationshipId: `${studentId}__${adultUserId}`,
    academyId,
    familyId: `family-${studentId}`,
    studentId,
    adultUserId,
    relationshipType: "guardian",
    permissions: ["readProfile"],
    validFrom: "2026-01-01T00:00:00.000Z",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "owner-1",
    ...overrides,
  };
}

function fixture(seed: Iterable<readonly [string, Data]> = []) {
  const documents = new Map<string, Data>(seed as Iterable<[string, Data]>);
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
    return self as unknown as ReturnType<DisclaimerFirestore["collection"]>;
  }

  const reference = (path: string) => ({
    id: path.split("/").at(-1) ?? "",
    path,
    get: async () => ({
      id: path.split("/").at(-1) ?? "",
      exists: documents.has(path),
      data: () => documents.get(path),
    }),
  });

  const firestore = {
    doc: reference,
    collection: (path: string) => query(path, []),
    runTransaction: async <T>(update: (transaction: unknown) => Promise<T>) =>
      update({
        get: async (target: { path?: string; get?: () => Promise<unknown> }) =>
          target.path !== undefined
            ? {
                id: target.path.split("/").at(-1) ?? "",
                exists: documents.has(target.path),
                data: () => documents.get(target.path as string),
              }
            : await (target.get as () => Promise<unknown>)(),
        create: (ref: { path: string }, data: Data) => documents.set(ref.path, data),
        set: (ref: { path: string }, data: Data) => documents.set(ref.path, data),
      }),
  } as unknown as DisclaimerFirestore;

  return {
    documents,
    service: createDisclaimerService({ firestore, now: () => now }),
  };
}

const adultSeed: readonly (readonly [string, Data])[] = [
  [`academies/${academyId}/students/student-1`, adultStudent("student-1", "adult-1")],
];
const minorSeed: readonly (readonly [string, Data])[] = [
  [`academies/${academyId}/students/student-2`, minorStudent("student-2")],
  [
    `academies/${academyId}/relationships/student-2__guardian-1`,
    relationship("student-2", "guardian-1"),
  ],
];

async function publish(
  service: ReturnType<typeof fixture>["service"],
  overrides: Record<string, unknown> = {},
) {
  return service.publishDisclaimer({
    academyId,
    actorId: "owner-1",
    input: publication(overrides),
  });
}

describe("createDisclaimerService (T117)", () => {
  it("publishes a disclaimer with a derived identity, hash and audit", async () => {
    const { service, documents } = fixture(adultSeed);
    const published = await publish(service);

    expect(published).toMatchObject({
      disclaimerId: "photo-consent__v1",
      key: "photo-consent",
      versionLabel: "v1",
      status: "published",
      publishedBy: "owner-1",
      supersededBy: null,
    });
    expect(published.contentHash).toBe(hashOf(publication()));
    expect(documents.has(`academies/${academyId}/disclaimers/photo-consent__v1`)).toBe(true);
    expect(
      documents.has(`academies/${academyId}/auditEvents/disclaimer-published-photo-consent__v1`),
    ).toBe(true);
  });

  it("refuses to republish a version label instead of overwriting accepted text", async () => {
    const { service } = fixture(adultSeed);
    await publish(service);
    await expect(publish(service)).rejects.toThrow(DisclaimerError);
  });

  it("supersedes the previous version of the same key in the same write", async () => {
    const { service, documents } = fixture(adultSeed);
    await publish(service);
    await publish(service, { versionLabel: "v2", body: "Reworded body for the second version." });

    expect(documents.get(`academies/${academyId}/disclaimers/photo-consent__v1`)).toMatchObject({
      status: "superseded",
      supersededBy: "photo-consent__v2",
    });
    expect(documents.get(`academies/${academyId}/disclaimers/photo-consent__v2`)).toMatchObject({
      status: "published",
    });
  });

  it("leaves a different key alone when one is superseded", async () => {
    const { service, documents } = fixture(adultSeed);
    await publish(service);
    await publish(service, { key: "filming-policy", title: "Filming policy" });
    await publish(service, { versionLabel: "v2", body: "Reworded body for the second version." });

    expect(documents.get(`academies/${academyId}/disclaimers/filming-policy__v1`)).toMatchObject({
      status: "published",
    });
  });

  describe("the outstanding list", () => {
    it("shows a live disclaimer to the adult it applies to", async () => {
      const { service } = fixture(adultSeed);
      await publish(service);
      const outstanding = await service.getOutstandingDisclaimers({
        academyId,
        actorId: "adult-1",
        role: "adultStudent",
        studentId: "student-1",
      });
      expect(outstanding).toHaveLength(1);
      expect(outstanding[0]?.disclaimer.title).toBe("Photography at open mat");
    });

    it("lets a guardian read for their minor and refuses an unrelated adult", async () => {
      const { service } = fixture([...adultSeed, ...minorSeed]);
      await publish(service);

      await expect(
        service.getOutstandingDisclaimers({
          academyId,
          actorId: "guardian-1",
          role: "guardian",
          studentId: "student-2",
        }),
      ).resolves.toHaveLength(1);
      await expect(
        service.getOutstandingDisclaimers({
          academyId,
          actorId: "stranger-1",
          role: "guardian",
          studentId: "student-2",
        }),
      ).rejects.toThrow(DisclaimerError);
      // An adult cannot use the adult path to read a minor's list.
      await expect(
        service.getOutstandingDisclaimers({
          academyId,
          actorId: "adult-1",
          role: "adultStudent",
          studentId: "student-2",
        }),
      ).rejects.toThrow(DisclaimerError);
    });

    it("refuses a guardian whose relationship has ended", async () => {
      const { service } = fixture([
        ...minorSeed,
        [
          `academies/${academyId}/relationships/student-2__guardian-1`,
          relationship("student-2", "guardian-1", { validTo: "2026-01-02T00:00:00.000Z" }),
        ],
      ]);
      await publish(service);
      await expect(
        service.getOutstandingDisclaimers({
          academyId,
          actorId: "guardian-1",
          role: "guardian",
          studentId: "student-2",
        }),
      ).rejects.toThrow(DisclaimerError);
    });
  });

  describe("acceptance", () => {
    it("records the acceptance against the exact text and audits it", async () => {
      const { service, documents } = fixture(adultSeed);
      const published = await publish(service);
      const accepted = await service.acceptDisclaimer({
        academyId,
        actorId: "adult-1",
        role: "adultStudent",
        input: {
          disclaimerId: published.disclaimerId,
          studentId: "student-1",
          contentHash: published.contentHash,
        },
      });

      expect(accepted).toMatchObject({
        acceptanceId: "photo-consent__v1__student-1",
        studentId: "student-1",
        acceptedBy: "adult-1",
        versionLabel: "v1",
        status: "accepted",
      });
      expect(accepted.contentHash).toBe(published.contentHash);
      expect(
        documents.has(
          `academies/${academyId}/auditEvents/disclaimer-accepted-photo-consent__v1__student-1`,
        ),
      ).toBe(true);

      await expect(
        service.getOutstandingDisclaimers({
          academyId,
          actorId: "adult-1",
          role: "adultStudent",
          studentId: "student-1",
        }),
      ).resolves.toEqual([]);
    });

    /** The guard that makes the hash worth carrying. */
    it("refuses a hash that does not match the published text", async () => {
      const { service } = fixture(adultSeed);
      const published = await publish(service);
      await expect(
        service.acceptDisclaimer({
          academyId,
          actorId: "adult-1",
          role: "adultStudent",
          input: {
            disclaimerId: published.disclaimerId,
            studentId: "student-1",
            contentHash: "c".repeat(64),
          },
        }),
      ).rejects.toThrow(DisclaimerError);
    });

    it("asks again after a new version and keeps the old acceptance as history", async () => {
      const { service, documents } = fixture(adultSeed);
      const v1 = await publish(service);
      await service.acceptDisclaimer({
        academyId,
        actorId: "adult-1",
        role: "adultStudent",
        input: {
          disclaimerId: v1.disclaimerId,
          studentId: "student-1",
          contentHash: v1.contentHash,
        },
      });

      const v2 = await publish(service, {
        versionLabel: "v2",
        body: "Reworded body for the second version.",
      });
      const outstanding = await service.getOutstandingDisclaimers({
        academyId,
        actorId: "adult-1",
        role: "adultStudent",
        studentId: "student-1",
      });
      expect(outstanding).toHaveLength(1);
      expect(outstanding[0]).toMatchObject({ previouslyAcceptedVersionLabel: "v1" });
      expect(outstanding[0]?.disclaimer.disclaimerId).toBe(v2.disclaimerId);
      // The v1 acceptance is still on file, unchanged.
      expect(
        documents.get(`academies/${academyId}/disclaimerAcceptances/photo-consent__v1__student-1`),
      ).toMatchObject({ status: "accepted", versionLabel: "v1" });
    });

    it("refuses a disclaimer that does not apply to this participant", async () => {
      const { service } = fixture(adultSeed);
      const published = await publish(service, { audience: "minor" });
      await expect(
        service.acceptDisclaimer({
          academyId,
          actorId: "adult-1",
          role: "adultStudent",
          input: {
            disclaimerId: published.disclaimerId,
            studentId: "student-1",
            contentHash: published.contentHash,
          },
        }),
      ).rejects.toThrow(DisclaimerError);
    });

    it("refuses to accept a withdrawn disclaimer", async () => {
      const { service } = fixture(adultSeed);
      const published = await publish(service);
      await service.withdrawDisclaimer({
        academyId,
        actorId: "owner-1",
        disclaimerId: published.disclaimerId,
      });
      await expect(
        service.acceptDisclaimer({
          academyId,
          actorId: "adult-1",
          role: "adultStudent",
          input: {
            disclaimerId: published.disclaimerId,
            studentId: "student-1",
            contentHash: published.contentHash,
          },
        }),
      ).rejects.toThrow(DisclaimerError);
    });

    it("refuses to accept twice and lets the participant take it back", async () => {
      const { service } = fixture(adultSeed);
      const published = await publish(service);
      const input = {
        disclaimerId: published.disclaimerId,
        studentId: "student-1",
        contentHash: published.contentHash,
      };
      const accepted = await service.acceptDisclaimer({
        academyId,
        actorId: "adult-1",
        role: "adultStudent",
        input,
      });
      await expect(
        service.acceptDisclaimer({
          academyId,
          actorId: "adult-1",
          role: "adultStudent",
          input,
        }),
      ).rejects.toThrow(DisclaimerError);

      const withdrawn = await service.withdrawAcceptance({
        academyId,
        actorId: "adult-1",
        role: "adultStudent",
        acceptanceId: accepted.acceptanceId,
      });
      expect(withdrawn).toMatchObject({ status: "withdrawn", withdrawnAt: now });

      // It comes back on the list, and it can be accepted again.
      await expect(
        service.getOutstandingDisclaimers({
          academyId,
          actorId: "adult-1",
          role: "adultStudent",
          studentId: "student-1",
        }),
      ).resolves.toHaveLength(1);
      await expect(
        service.acceptDisclaimer({
          academyId,
          actorId: "adult-1",
          role: "adultStudent",
          input,
        }),
      ).resolves.toMatchObject({ status: "accepted" });
    });

    it("never lets one participant withdraw another's acceptance", async () => {
      const { service } = fixture([...adultSeed, ...minorSeed]);
      const published = await publish(service);
      const accepted = await service.acceptDisclaimer({
        academyId,
        actorId: "adult-1",
        role: "adultStudent",
        input: {
          disclaimerId: published.disclaimerId,
          studentId: "student-1",
          contentHash: published.contentHash,
        },
      });
      await expect(
        service.withdrawAcceptance({
          academyId,
          actorId: "guardian-1",
          role: "guardian",
          acceptanceId: accepted.acceptanceId,
        }),
      ).rejects.toThrow(DisclaimerError);
    });
  });

  describe("the office list", () => {
    it("reports adoption as a count and never as a list of people", async () => {
      const { service } = fixture(adultSeed);
      const published = await publish(service);
      await service.acceptDisclaimer({
        academyId,
        actorId: "adult-1",
        role: "adultStudent",
        input: {
          disclaimerId: published.disclaimerId,
          studentId: "student-1",
          contentHash: published.contentHash,
        },
      });

      const listed = await service.listDisclaimers({ academyId });
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ acceptedCount: 1 });
      expect(JSON.stringify(listed)).not.toContain("student-1");
    });

    it("returns an honest empty list before anything is published", async () => {
      const { service } = fixture(adultSeed);
      await expect(service.listDisclaimers({ academyId })).resolves.toEqual([]);
    });
  });

  it("refuses an invalid tenant or identifier before reading anything", async () => {
    const { service } = fixture(adultSeed);
    await expect(service.listDisclaimers({ academyId: "../escape" })).rejects.toThrow(
      DisclaimerError,
    );
    await expect(
      service.withdrawDisclaimer({
        academyId,
        actorId: "owner-1",
        disclaimerId: "../escape",
      }),
    ).rejects.toThrow(DisclaimerError);
  });

  it("never reads a disclaimer that belongs to another academy", async () => {
    const { service, documents } = fixture(adultSeed);
    const published = await publish(service);
    documents.set(`academies/${academyId}/disclaimers/${published.disclaimerId}`, {
      ...(documents.get(`academies/${academyId}/disclaimers/${published.disclaimerId}`) as Data),
      academyId: "academy-2",
    });
    await expect(
      service.withdrawDisclaimer({
        academyId,
        actorId: "owner-1",
        disclaimerId: published.disclaimerId,
      }),
    ).rejects.toThrow(DisclaimerError);
  });
});
