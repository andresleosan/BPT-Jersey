import { beforeEach, describe, expect, it, vi } from "vitest";

const callable = vi.hoisted(() => vi.fn());
vi.mock("firebase/functions", () => ({ httpsCallable: vi.fn(() => callable) }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: vi.fn(() => ({})) }));

import {
  acceptWaiver,
  getCurrentWaiverAdmin,
  getWaiverEvidenceDownload,
  getWaiverRegistration,
  publishWaiverVersion,
  revokeWaiverConsent,
  withdrawCurrentWaiver,
} from "./waiver-client";

const clauses = [
  { key: "photoVideo", heading: "Photo and video", body: "Synthetic media clause.", required: false },
  { key: "medicalTreatment", heading: "Medical treatment", body: "Synthetic medical clause.", required: true },
  { key: "hygiene", heading: "Hygiene", body: "Synthetic hygiene clause.", required: true },
  { key: "dataProtection", heading: "Data protection", body: "Synthetic data clause.", required: true },
] as const;
const version = {
  waiverVersionId: "waiver-1", versionLabel: "pilot-2026-08", title: "Synthetic pilot waiver",
  introduction: "Synthetic content only.", clauses, contentHash: "a".repeat(64),
  effectiveAt: "2026-08-25T12:00:00Z", schemaVersion: "1",
} as const;
const consent = {
  consentId: "consent-1", studentId: "student-1", waiverVersionId: "waiver-1",
  versionLabel: "pilot-2026-08",
  clauseResponses: { photoVideo: "declined", medicalTreatment: "accepted", hygiene: "accepted", dataProtection: "accepted" },
  signedAt: "2026-08-25T12:10:00Z", revokedAt: null, evidenceDocumentId: "document-1",
  status: "accepted", schemaVersion: "1",
} as const;

describe("waiver client", () => {
  beforeEach(() => callable.mockReset());

  it("loads only the strict registration projection", async () => {
    callable.mockResolvedValue({ data: { currentVersion: version, subjects: [{ studentId: "student-1", displayName: "Synthetic Minor", participantType: "minor", consent }] } });
    await expect(getWaiverRegistration()).resolves.toMatchObject({ currentVersion: { waiverVersionId: "waiver-1" } });
    expect(callable).toHaveBeenCalledWith(null);
    callable.mockResolvedValueOnce({ data: { currentVersion: version, subjects: [], signedBy: "guardian-1" } });
    await expect(getWaiverRegistration()).rejects.toThrow("Unable to load waiver registration.");
  });

  it("sends exact acceptance and revocation payloads", async () => {
    callable.mockResolvedValueOnce({ data: consent });
    await acceptWaiver({ studentId: "student-1", waiverVersionId: "waiver-1", contentHash: "a".repeat(64), typedName: "Synthetic Guardian", clauseResponses: consent.clauseResponses });
    expect(callable).toHaveBeenLastCalledWith({ studentId: "student-1", waiverVersionId: "waiver-1", contentHash: "a".repeat(64), typedName: "Synthetic Guardian", clauseResponses: consent.clauseResponses });
    callable.mockResolvedValueOnce({ data: { ...consent, status: "revoked", revokedAt: "2026-08-25T13:00:00Z" } });
    await revokeWaiverConsent("consent-1");
    expect(callable).toHaveBeenLastCalledWith({ consentId: "consent-1" });
  });

  it("accepts only a current HTTPS evidence download", async () => {
    callable.mockResolvedValue({ data: { consent, downloadUrl: "https://r2.example.test/evidence.pdf", expiresAt: "2999-08-25T12:20:00Z" } });
    await expect(getWaiverEvidenceDownload("consent-1")).resolves.toMatchObject({ downloadUrl: "https://r2.example.test/evidence.pdf" });
    callable.mockResolvedValueOnce({ data: { consent, downloadUrl: "http://r2.example.test/evidence.pdf", expiresAt: "2999-08-25T12:20:00Z" } });
    await expect(getWaiverEvidenceDownload("consent-1")).rejects.toThrow("Unable to open waiver evidence.");
  });

  it("publishes, reads and withdraws only strict admin versions", async () => {
    callable.mockResolvedValue({ data: version });
    await publishWaiverVersion({ versionLabel: version.versionLabel, title: version.title, introduction: version.introduction, clauses, effectiveAt: version.effectiveAt, confirmReviewed: true });
    await getCurrentWaiverAdmin();
    await withdrawCurrentWaiver("waiver-1");
    expect(callable).toHaveBeenLastCalledWith({ waiverVersionId: "waiver-1" });
  });
});
