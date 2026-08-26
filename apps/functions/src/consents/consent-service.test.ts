import { describe, expect, it, vi } from "vitest";

import type { WaiverPublicationInput } from "@bpt-jersey/domain/consents";
import type { R2Client } from "../storage/r2-client.js";
import {
  ConsentStoreError,
  createConsentStore,
  type ConsentDocumentData,
  type ConsentFirestore,
} from "./consent-service.js";

type Ref = Readonly<{ id: string; path: string }>;
type Query = Readonly<{ path: string; field: string; value: unknown; limit: number }>;

function fakeFirestore(initial: Record<string, ConsentDocumentData> = {}, failCreate = "") {
  const records = new Map(Object.entries(initial));
  const ref = (path: string): Ref => ({ id: path.split("/").at(-1) ?? "", path });
  const firestore: ConsentFirestore = {
    doc: ref,
    collection: (path) => ({
      doc: (id?: string) => ref(`${path}/${id ?? `audit-${records.size + 1}`}`),
      where: (field, _operator, value) => ({
        limit: (limit) => ({ path, field, value, limit }),
      }),
    }),
    runTransaction: async (callback) => {
      const before = new Map(records);
      const transaction = {
        get: async (target: Ref | Query) => {
          if ("field" in target) {
            return {
              docs: [...records.entries()]
                .filter(
                  ([path, data]) =>
                    path.startsWith(`${target.path}/`) && data[target.field] === target.value,
                )
                .slice(0, target.limit)
                .map(([path, data]) => ({ ...ref(path), exists: true, data: () => data })),
            };
          }
          const data = records.get(target.path);
          return { ...target, exists: data !== undefined, data: () => data };
        },
        create: (target: Ref, data: ConsentDocumentData) => {
          if (failCreate && target.path.includes(failCreate))
            throw new Error("synthetic commit failure");
          if (records.has(target.path)) throw new Error("already exists");
          records.set(target.path, data);
          return transaction;
        },
        set: (target: Ref, data: ConsentDocumentData) => {
          records.set(target.path, data);
          return transaction;
        },
      };
      try {
        return await callback(transaction);
      } catch (error) {
        records.clear();
        for (const [path, data] of before) records.set(path, data);
        throw error;
      }
    },
  };
  return { firestore, records };
}

const now = "2026-08-25T12:00:00Z";
const user = {
  userId: "guardian-1",
  academyId: "academy-1",
  accountType: "client",
  displayName: "Synthetic Guardian",
  email: "guardian@example.test",
  phoneNumber: "+441534000001",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: now,
  createdBy: "owner-1",
  updatedAt: now,
  updatedBy: "owner-1",
};
const minor = {
  studentId: "student-1",
  academyId: "academy-1",
  familyId: "family-1",
  fullName: "Synthetic Minor",
  dateOfBirth: "2014-01-01",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  participantType: "minor",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: now,
  createdBy: "owner-1",
  updatedAt: now,
  updatedBy: "owner-1",
};
const relationship = {
  relationshipId: "family-1--student-1",
  academyId: "academy-1",
  familyId: "family-1",
  studentId: "student-1",
  adultUserId: "guardian-1",
  relationshipType: "guardian",
  permissions: ["readProfile"],
  validFrom: "2026-01-01T00:00:00Z",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: now,
  createdBy: "owner-1",
  updatedAt: now,
  updatedBy: "owner-1",
};
const publication: WaiverPublicationInput = {
  versionLabel: "pilot-2026-08",
  title: "Synthetic pilot waiver",
  introduction: "Synthetic content only. Operator legal wording is not bundled.",
  clauses: [
    {
      key: "photoVideo",
      heading: "Photo and video",
      body: "Synthetic media clause.",
      required: false,
    },
    {
      key: "medicalTreatment",
      heading: "Medical treatment",
      body: "Synthetic medical clause.",
      required: true,
    },
    { key: "hygiene", heading: "Hygiene", body: "Synthetic hygiene clause.", required: true },
    {
      key: "dataProtection",
      heading: "Data protection",
      body: "Synthetic data clause.",
      required: true,
    },
  ],
  effectiveAt: now,
  confirmReviewed: true,
};
const responses = {
  photoVideo: "declined",
  medicalTreatment: "accepted",
  hygiene: "accepted",
  dataProtection: "accepted",
} as const;

function r2() {
  const objects = new Map<string, Uint8Array>();
  const client: R2Client = {
    createPdfUploadUrl: async () => "https://r2.example.test/upload",
    createPdfDownloadUrl: async () => "https://r2.example.test/download",
    putObject: vi.fn(async (key, body) => {
      objects.set(key, body);
    }),
    readObject: async (key) => objects.get(key) ?? new Uint8Array(),
    deleteObject: vi.fn(async (key) => {
      objects.delete(key);
    }),
  };
  return { client, objects };
}

function seededStore(failCreate = "") {
  const seeded = fakeFirestore(
    {
      "academies/academy-1/users/guardian-1": user,
      "academies/academy-1/students/student-1": minor,
      "academies/academy-1/relationships/family-1--student-1": relationship,
    },
    failCreate,
  );
  const storage = r2();
  const audits: unknown[] = [];
  const store = createConsentStore({
    firestore: seeded.firestore,
    r2: storage.client,
    createEvidencePdf: async () => new TextEncoder().encode("%PDF synthetic waiver evidence"),
    generateDocumentId: () => "document-1",
    appendAudit: (transaction, reference, draft) => {
      audits.push(draft);
      transaction.create(reference, draft as ConsentDocumentData);
    },
  });
  return { ...seeded, ...storage, audits, store };
}

describe("consent store", () => {
  it("publishes one immutable current version and supersedes the prior version", async () => {
    const seeded = seededStore();
    const first = await seeded.store.publishWaiverVersion({
      academyId: "academy-1",
      actorId: "owner-1",
      now,
      publication,
    });
    expect(first.status).toBe("published");
    const second = await seeded.store.publishWaiverVersion({
      academyId: "academy-1",
      actorId: "owner-1",
      now: "2026-08-25T13:00:00Z",
      publication: {
        ...publication,
        versionLabel: "pilot-2026-09",
        title: "Synthetic pilot waiver revision",
      },
    });
    expect(second.waiverVersionId).not.toBe(first.waiverVersionId);
    expect(
      seeded.records.get(`academies/academy-1/waiverVersions/${first.waiverVersionId}`),
    ).toMatchObject({ status: "superseded", supersededAt: "2026-08-25T13:00:00Z" });
    await expect(
      seeded.store.getCurrentWaiverAdmin({ academyId: "academy-1" }),
    ).resolves.toMatchObject({ waiverVersionId: second.waiverVersionId });
  });

  it("accepts for an active linked minor and links consent, PDF metadata and audit", async () => {
    const seeded = seededStore();
    const version = await seeded.store.publishWaiverVersion({
      academyId: "academy-1",
      actorId: "owner-1",
      now,
      publication,
    });
    const accepted = await seeded.store.acceptWaiver({
      academyId: "academy-1",
      actorId: "guardian-1",
      role: "guardian",
      now: "2026-08-25T12:10:00Z",
      studentId: "student-1",
      waiverVersionId: version.waiverVersionId,
      contentHash: version.contentHash,
      typedName: "Synthetic Guardian",
      clauseResponses: responses,
    });
    expect(accepted).toMatchObject({
      studentId: "student-1",
      status: "accepted",
      evidenceDocumentId: "document-1",
    });
    expect(seeded.records.get(`academies/academy-1/consents/${accepted.consentId}`)).toMatchObject({
      signedBy: "guardian-1",
      waiverContentHash: version.contentHash,
    });
    expect(seeded.records.get("academies/academy-1/documents/document-1")).toMatchObject({
      status: "active",
      signedAt: "2026-08-25T12:10:00Z",
    });
    expect(seeded.objects.size).toBe(1);
    expect(seeded.audits).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "consent.accepted" })]),
    );
    await expect(
      seeded.store.getWaiverRegistration({
        academyId: "academy-1",
        actorId: "guardian-1",
        role: "guardian",
        now: "2026-08-25T12:11:00Z",
      }),
    ).resolves.toMatchObject({
      subjects: [{ studentId: "student-1", consent: { status: "accepted" } }],
    });
  });

  it("supports adult self-service and rejects forged subject, signer and required decisions", async () => {
    const seeded = seededStore();
    seeded.records.set("academies/academy-1/users/adult-1", {
      ...user,
      userId: "adult-1",
      displayName: "Synthetic Adult",
    });
    seeded.records.set("academies/academy-1/students/adult-student-1", {
      studentId: "adult-student-1",
      academyId: minor.academyId,
      userId: "adult-1",
      fullName: "Synthetic Adult",
      dateOfBirth: "1990-01-01",
      trainingCenter: minor.trainingCenter,
      trainingTimePreferences: minor.trainingTimePreferences,
      participantType: "adult",
      active: minor.active,
      status: minor.status,
      schemaVersion: minor.schemaVersion,
      createdAt: minor.createdAt,
      createdBy: minor.createdBy,
      updatedAt: minor.updatedAt,
      updatedBy: minor.updatedBy,
    });
    const version = await seeded.store.publishWaiverVersion({
      academyId: "academy-1",
      actorId: "owner-1",
      now,
      publication,
    });
    await expect(
      seeded.store.acceptWaiver({
        academyId: "academy-1",
        actorId: "adult-1",
        role: "adultStudent",
        now,
        studentId: "adult-student-1",
        waiverVersionId: version.waiverVersionId,
        contentHash: version.contentHash,
        typedName: "Synthetic Adult",
        clauseResponses: responses,
      }),
    ).resolves.toMatchObject({ studentId: "adult-student-1" });
    await expect(
      seeded.store.acceptWaiver({
        academyId: "academy-1",
        actorId: "guardian-2",
        role: "guardian",
        now,
        studentId: "student-1",
        waiverVersionId: version.waiverVersionId,
        contentHash: version.contentHash,
        typedName: "Synthetic Guardian",
        clauseResponses: responses,
      }),
    ).rejects.toBeInstanceOf(ConsentStoreError);
    await expect(
      seeded.store.acceptWaiver({
        academyId: "academy-1",
        actorId: "guardian-1",
        role: "guardian",
        now,
        studentId: "student-1",
        waiverVersionId: version.waiverVersionId,
        contentHash: version.contentHash,
        typedName: "Forged Name",
        clauseResponses: responses,
      }),
    ).rejects.toThrow(/signer/i);
    await expect(
      seeded.store.acceptWaiver({
        academyId: "academy-1",
        actorId: "guardian-1",
        role: "guardian",
        now,
        studentId: "student-1",
        waiverVersionId: version.waiverVersionId,
        contentHash: version.contentHash,
        typedName: "Synthetic Guardian",
        clauseResponses: { ...responses, hygiene: "declined" },
      }),
    ).rejects.toThrow(/required/i);
  });

  it("revokes non-destructively and authorizes only the exact evidence", async () => {
    const seeded = seededStore();
    const version = await seeded.store.publishWaiverVersion({
      academyId: "academy-1",
      actorId: "owner-1",
      now,
      publication,
    });
    const accepted = await seeded.store.acceptWaiver({
      academyId: "academy-1",
      actorId: "guardian-1",
      role: "guardian",
      now,
      studentId: "student-1",
      waiverVersionId: version.waiverVersionId,
      contentHash: version.contentHash,
      typedName: "Synthetic Guardian",
      clauseResponses: responses,
    });
    await expect(
      seeded.store.getWaiverEvidenceDownload({
        academyId: "academy-1",
        actorId: "guardian-1",
        role: "guardian",
        consentId: accepted.consentId,
        now,
      }),
    ).resolves.toMatchObject({ downloadUrl: "https://r2.example.test/download" });
    expect(seeded.audits).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "consent.evidence.downloaded" })]),
    );
    const revoked = await seeded.store.revokeWaiverConsent({
      academyId: "academy-1",
      actorId: "guardian-1",
      role: "guardian",
      consentId: accepted.consentId,
      now: "2026-08-25T13:00:00Z",
    });
    expect(revoked).toMatchObject({ status: "revoked", revokedAt: "2026-08-25T13:00:00Z" });
    expect(seeded.records.get("academies/academy-1/documents/document-1")).toMatchObject({
      status: "revoked",
    });
    await expect(
      seeded.store.getWaiverEvidenceDownload({
        academyId: "academy-1",
        actorId: "guardian-1",
        role: "guardian",
        consentId: accepted.consentId,
        now,
      }),
    ).rejects.toThrow(/available/i);
  });

  it("is idempotent and cleans a new R2 object when the Firestore commit fails", async () => {
    const seeded = seededStore();
    const version = await seeded.store.publishWaiverVersion({
      academyId: "academy-1",
      actorId: "owner-1",
      now,
      publication,
    });
    const input = {
      academyId: "academy-1",
      actorId: "guardian-1",
      role: "guardian" as const,
      now,
      studentId: "student-1",
      waiverVersionId: version.waiverVersionId,
      contentHash: version.contentHash,
      typedName: "Synthetic Guardian",
      clauseResponses: responses,
    };
    const first = await seeded.store.acceptWaiver(input);
    const second = await seeded.store.acceptWaiver(input);
    expect(second).toEqual(first);
    expect(seeded.client.putObject).toHaveBeenCalledTimes(1);

    const failing = seededStore("/consents/");
    const failingVersion = await failing.store.publishWaiverVersion({
      academyId: "academy-1",
      actorId: "owner-1",
      now,
      publication,
    });
    await expect(
      failing.store.acceptWaiver({
        ...input,
        waiverVersionId: failingVersion.waiverVersionId,
        contentHash: failingVersion.contentHash,
      }),
    ).rejects.toThrow();
    expect(failing.client.deleteObject).toHaveBeenCalledOnce();
    expect([...failing.records.keys()].some((path) => path.includes("/documents/"))).toBe(false);
  });
});
