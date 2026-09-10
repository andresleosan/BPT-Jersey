import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { WaiverVersion } from "@bpt-jersey/domain/consents";
import { createWaiverEvidencePdf } from "./waiver-evidence-pdf.js";

const assetPath = new URL(
  "./assets/Brazilian Power Team Jersey Waiver and Release of Liability.pdf",
  import.meta.url,
);
const version: WaiverVersion = {
  waiverVersionId: "waiver-official-1",
  academyId: "academy-1",
  versionLabel: "official-2026-09",
  title: "Brazilian Power Team Jersey Waiver and Release of Liability",
  introduction: "Official source document.",
  clauses: [
    {
      key: "photoVideo",
      heading: "Photo and video",
      body: "Review the official document.",
      required: true,
    },
    {
      key: "medicalTreatment",
      heading: "Medical treatment",
      body: "Review the official document.",
      required: true,
    },
    { key: "hygiene", heading: "Hygiene", body: "Review the official document.", required: true },
    {
      key: "dataProtection",
      heading: "Data protection",
      body: "Review the official document.",
      required: true,
    },
  ],
  contentHash: "a".repeat(64),
  effectiveAt: "2026-09-01T12:00:00Z",
  status: "published",
  supersededAt: null,
  schemaVersion: "1",
  createdAt: "2026-09-01T12:00:00Z",
  createdBy: "owner-1",
  updatedAt: "2026-09-01T12:00:00Z",
  updatedBy: "owner-1",
};

describe("official waiver asset", () => {
  it("matches the approved source hash", () => {
    const bytes = readFileSync(assetPath);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "5ff6add6f1cc59b8cd23b73fb0c29371e1cb85c66829ab63e8642db7c3c10ad1",
    );
  });

  it("keeps the two original PDF pages before the private signature record", async () => {
    const bytes = await createWaiverEvidencePdf({
      consentId: "consent-official-1",
      version,
      student: { studentId: "student-1", fullName: "Synthetic Adult", participantType: "adult" },
      signer: { userId: "adult-1", displayName: "Synthetic Adult" },
      clauseResponses: {
        photoVideo: "accepted",
        medicalTreatment: "accepted",
        hygiene: "accepted",
        dataProtection: "accepted",
      },
      signedAt: "2026-09-01T12:10:00Z",
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });
});
