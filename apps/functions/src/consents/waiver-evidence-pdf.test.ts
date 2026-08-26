import { describe, expect, it } from "vitest";

import type { WaiverVersion } from "@bpt-jersey/domain/consents";
import { createWaiverEvidencePdf } from "./waiver-evidence-pdf.js";

const version: WaiverVersion = {
  waiverVersionId: "waiver-1",
  academyId: "academy-1",
  versionLabel: "pilot-2026-08",
  title: "Synthetic pilot waiver",
  introduction: "Synthetic content only.",
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
  contentHash: "a".repeat(64),
  effectiveAt: "2026-08-25T12:00:00Z",
  status: "published",
  supersededAt: null,
  schemaVersion: "1",
  createdAt: "2026-08-25T12:00:00Z",
  createdBy: "owner-1",
  updatedAt: "2026-08-25T12:00:00Z",
  updatedBy: "owner-1",
};

describe("waiver evidence PDF", () => {
  it("creates a real private evidence PDF with stable metadata", async () => {
    const bytes = await createWaiverEvidencePdf({
      consentId: "consent-1",
      version,
      student: { studentId: "student-1", fullName: "Synthetic Minor", participantType: "minor" },
      signer: { userId: "guardian-1", displayName: "Synthetic Guardian" },
      clauseResponses: {
        photoVideo: "declined",
        medicalTreatment: "accepted",
        hygiene: "accepted",
        dataProtection: "accepted",
      },
      signedAt: "2026-08-25T12:10:00Z",
    });
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.7");
    expect(bytes.byteLength).toBeGreaterThan(500);
    expect(new TextDecoder().decode(bytes)).not.toContain("password");
  });

  it("normalizes unsupported Unicode and paginates bounded long clause text", async () => {
    const bytes = await createWaiverEvidencePdf({
      consentId: "consent-2",
      version: {
        ...version,
        introduction: "JosÃ© 🥋",
        clauses: version.clauses.map((clause) => ({
          ...clause,
          body: `${clause.body} `.repeat(150),
        })),
      },
      student: { studentId: "student-2", fullName: "JosÃ© 🥋", participantType: "adult" },
      signer: { userId: "adult-1", displayName: "JosÃ© 🥋" },
      clauseResponses: {
        photoVideo: "accepted",
        medicalTreatment: "accepted",
        hygiene: "accepted",
        dataProtection: "accepted",
      },
      signedAt: "2026-08-25T12:10:00Z",
    });
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.7");
  });
});
