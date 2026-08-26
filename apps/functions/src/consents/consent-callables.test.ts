import { describe, expect, it, vi } from "vitest";

import {
  acceptWaiverHandler,
  getCurrentWaiverAdminHandler,
  getWaiverEvidenceDownloadHandler,
  getWaiverRegistrationHandler,
  publishWaiverVersionHandler,
  revokeWaiverConsentHandler,
  withdrawCurrentWaiverHandler,
  type ConsentCallableServices,
} from "./consent-callables.js";

const publication = {
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
  effectiveAt: "2026-08-25T12:00:00Z",
  confirmReviewed: true,
} as const;
const acceptance = {
  studentId: "student-1",
  waiverVersionId: "waiver-1",
  contentHash: "a".repeat(64),
  typedName: "Synthetic Guardian",
  clauseResponses: {
    photoVideo: "declined",
    medicalTreatment: "accepted",
    hygiene: "accepted",
    dataProtection: "accepted",
  },
} as const;
const versionRecord = {
  waiverVersionId: "waiver-1",
  academyId: "academy-1",
  ...publication,
  contentHash: "a".repeat(64),
  status: "published",
  supersededAt: null,
  schemaVersion: "1",
  createdAt: "2026-08-25T12:00:00Z",
  createdBy: "owner-1",
  updatedAt: "2026-08-25T12:00:00Z",
  updatedBy: "owner-1",
} as const;

function request(data: unknown, role = "owner", uid = "owner-1") {
  return { data, auth: { uid, token: { academyId: "academy-1", role } } } as never;
}
function services(pilotEnabled = true): ConsentCallableServices {
  return {
    pilotEnabled,
    now: () => "2026-08-25T12:10:00Z",
    store: {
      publishWaiverVersion: vi.fn(async () => versionRecord),
      getCurrentWaiverAdmin: vi.fn(async () => null),
      withdrawCurrentWaiver: vi.fn(async () => ({
        ...versionRecord,
        status: "withdrawn",
        supersededAt: "2026-08-25T12:10:00Z",
      })),
      getWaiverRegistration: vi.fn(async () => ({ currentVersion: null, subjects: [] })),
      acceptWaiver: vi.fn(async () => ({ consentId: "consent-1", status: "accepted" })),
      revokeWaiverConsent: vi.fn(async () => ({ consentId: "consent-1", status: "revoked" })),
      getWaiverEvidenceDownload: vi.fn(async () => ({
        downloadUrl: "https://r2.example.test/download",
      })),
    } as never,
  };
}

describe("consent callables", () => {
  it("fails closed before any store call outside the synthetic pilot", async () => {
    const current = services(false);
    await expect(
      getWaiverRegistrationHandler(request(null, "guardian", "guardian-1"), current),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    expect(current.store.getWaiverRegistration).not.toHaveBeenCalled();
  });

  it("allows only owner or administrator to publish, inspect and withdraw", async () => {
    const current = services();
    await publishWaiverVersionHandler(request(publication), current);
    await getCurrentWaiverAdminHandler(request(null, "administrator", "admin-1"), current);
    await withdrawCurrentWaiverHandler(request({ waiverVersionId: "waiver-1" }), current);
    expect(current.store.publishWaiverVersion).toHaveBeenCalledWith(
      expect.objectContaining({ academyId: "academy-1", actorId: "owner-1", publication }),
    );
    await expect(
      publishWaiverVersionHandler(request(publication, "guardian", "guardian-1"), current),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("allows guardian and adultStudent registration operations with exact derived scope", async () => {
    const current = services();
    await getWaiverRegistrationHandler(request(null, "guardian", "guardian-1"), current);
    await acceptWaiverHandler(request(acceptance, "guardian", "guardian-1"), current);
    await revokeWaiverConsentHandler(
      request({ consentId: "consent-1" }, "adultStudent", "adult-1"),
      current,
    );
    await getWaiverEvidenceDownloadHandler(
      request({ consentId: "consent-1" }, "guardian", "guardian-1"),
      current,
    );
    expect(current.store.acceptWaiver).toHaveBeenCalledWith({
      academyId: "academy-1",
      actorId: "guardian-1",
      role: "guardian",
      now: "2026-08-25T12:10:00Z",
      ...acceptance,
    });
    await expect(
      acceptWaiverHandler(request(acceptance, "coach", "coach-1"), current),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("rejects unknown fields, malformed hashes and non-null empty payloads", async () => {
    const current = services();
    await expect(
      publishWaiverVersionHandler(request({ ...publication, secret: "unexpected" }), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      acceptWaiverHandler(
        request({ ...acceptance, contentHash: "bad" }, "guardian", "guardian-1"),
        current,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      getWaiverRegistrationHandler(request({}, "guardian", "guardian-1"), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
