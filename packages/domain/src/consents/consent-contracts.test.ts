import { describe, expect, it } from "vitest";

import {
  canonicalizeWaiverContent,
  parseConsentRecord,
  parseWaiverPublicationInput,
  parseWaiverRegistrationProjection,
  parseWaiverVersion,
  waiverClauseKeys,
} from "./consent-contracts.js";

const clauses = [
  {
    key: "photoVideo",
    heading: "Photo and video",
    body: "Synthetic pilot wording for media decisions.",
    required: false,
  },
  {
    key: "medicalTreatment",
    heading: "Medical treatment",
    body: "Synthetic pilot wording for emergency support.",
    required: true,
  },
  {
    key: "hygiene",
    heading: "Hygiene",
    body: "Synthetic pilot wording for hygiene expectations.",
    required: true,
  },
  {
    key: "dataProtection",
    heading: "Data protection",
    body: "Synthetic pilot wording for data handling acknowledgement.",
    required: true,
  },
] as const;

const version = {
  waiverVersionId: "waiver-version-1",
  academyId: "academy-1",
  versionLabel: "pilot-2026-08",
  title: "Synthetic pilot waiver",
  introduction: "This is synthetic content and is not approved legal wording.",
  clauses,
  contentHash: "a".repeat(64),
  effectiveAt: "2026-08-25T12:00:00Z",
  status: "published",
  supersededAt: null,
  schemaVersion: "1",
  createdAt: "2026-08-25T12:00:00Z",
  createdBy: "owner-1",
  updatedAt: "2026-08-25T12:00:00Z",
  updatedBy: "owner-1",
} as const;

const consent = {
  consentId: "consent-1",
  academyId: "academy-1",
  subjectType: "minor",
  subjectId: "student-1",
  waiverVersionId: "waiver-version-1",
  versionLabel: "pilot-2026-08",
  waiverContentHash: "a".repeat(64),
  signedBy: "guardian-1",
  signatureMethod: "authenticated_typed_name",
  clauseResponses: {
    photoVideo: "declined",
    medicalTreatment: "accepted",
    hygiene: "accepted",
    dataProtection: "accepted",
  },
  signedAt: "2026-08-25T12:10:00Z",
  revokedAt: null,
  evidenceDocumentId: "document-1",
  status: "accepted",
  schemaVersion: "1",
  createdAt: "2026-08-25T12:10:00Z",
  createdBy: "guardian-1",
  updatedAt: "2026-08-25T12:10:00Z",
  updatedBy: "guardian-1",
} as const;

describe("consent contracts", () => {
  it("keeps the four clause keys fixed and parses valid publication input", () => {
    expect(waiverClauseKeys).toEqual([
      "photoVideo",
      "medicalTreatment",
      "hygiene",
      "dataProtection",
    ]);
    expect(
      parseWaiverPublicationInput({
        versionLabel: version.versionLabel,
        title: version.title,
        introduction: version.introduction,
        clauses,
        effectiveAt: version.effectiveAt,
        confirmReviewed: true,
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects missing, duplicate, reordered and unknown clauses", () => {
    const input = {
      versionLabel: version.versionLabel,
      title: version.title,
      introduction: version.introduction,
      effectiveAt: version.effectiveAt,
      confirmReviewed: true as const,
    };
    expect(parseWaiverPublicationInput({ ...input, clauses: clauses.slice(0, 3) }).ok).toBe(false);
    expect(
      parseWaiverPublicationInput({
        ...input,
        clauses: [clauses[0], clauses[0], ...clauses.slice(2)],
      }).ok,
    ).toBe(false);
    expect(parseWaiverPublicationInput({ ...input, clauses, confirmReviewed: false }).ok).toBe(
      false,
    );
    expect(parseWaiverPublicationInput({ ...input, clauses: [...clauses].reverse() }).ok).toBe(
      false,
    );
    expect(
      parseWaiverPublicationInput({
        ...input,
        clauses: [{ ...clauses[0], key: "marketing" }, ...clauses.slice(1)],
      }).ok,
    ).toBe(false);
  });

  it("rejects unknown, inherited, accessor, symbol and sparse input properties", () => {
    expect(
      parseWaiverPublicationInput({
        versionLabel: version.versionLabel,
        title: version.title,
        introduction: version.introduction,
        clauses,
        effectiveAt: version.effectiveAt,
        confirmReviewed: true,
        secret: "unexpected",
      }).ok,
    ).toBe(false);
    const inherited = Object.create({ secret: "inherited" }) as Record<string, unknown>;
    Object.assign(inherited, {
      versionLabel: version.versionLabel,
      title: version.title,
      introduction: version.introduction,
      clauses,
      effectiveAt: version.effectiveAt,
      confirmReviewed: true,
    });
    expect(parseWaiverPublicationInput(inherited).ok).toBe(false);
    const accessor = { ...version } as Record<string, unknown>;
    Object.defineProperty(accessor, "title", { enumerable: true, get: () => "unsafe" });
    expect(parseWaiverVersion(accessor).ok).toBe(false);
    expect(parseWaiverVersion({ ...version, [Symbol("secret")]: "unexpected" }).ok).toBe(false);
    const sparseClauses = [...clauses] as unknown[];
    delete sparseClauses[1];
    expect(
      parseWaiverPublicationInput({
        versionLabel: version.versionLabel,
        title: version.title,
        introduction: version.introduction,
        clauses: sparseClauses,
        effectiveAt: version.effectiveAt,
        confirmReviewed: true,
      }).ok,
    ).toBe(false);
  });

  it("parses lifecycle states only with consistent timestamps", () => {
    expect(parseWaiverVersion(version)).toMatchObject({ ok: true });
    expect(parseConsentRecord(consent)).toMatchObject({ ok: true });
    expect(parseConsentRecord({ ...consent, status: "revoked", revokedAt: null }).ok).toBe(false);
    expect(parseWaiverVersion({ ...version, status: "superseded", supersededAt: null }).ok).toBe(
      false,
    );
  });

  it("rejects inconsistent evidence and clause response identities", () => {
    expect(parseConsentRecord({ ...consent, waiverContentHash: "bad" }).ok).toBe(false);
    expect(parseConsentRecord({ ...consent, evidenceDocumentId: "../document" }).ok).toBe(false);
    expect(
      parseConsentRecord({
        ...consent,
        clauseResponses: { ...consent.clauseResponses, extra: "accepted" },
      }).ok,
    ).toBe(false);
  });

  it("canonicalizes only legal content fields deterministically", () => {
    const input = {
      versionLabel: version.versionLabel,
      title: version.title,
      introduction: version.introduction,
      clauses,
      effectiveAt: version.effectiveAt,
      confirmReviewed: true as const,
    };
    expect(canonicalizeWaiverContent(input)).toBe(
      canonicalizeWaiverContent({ ...input, clauses: clauses.map((clause) => ({ ...clause })) }),
    );
    expect(canonicalizeWaiverContent(input)).not.toContain("academy-1");
  });

  it("allows only minimal client registration projections", () => {
    const projection = {
      currentVersion: {
        waiverVersionId: version.waiverVersionId,
        versionLabel: version.versionLabel,
        title: version.title,
        introduction: version.introduction,
        clauses,
        contentHash: version.contentHash,
        effectiveAt: version.effectiveAt,
        schemaVersion: "1",
      },
      subjects: [
        {
          studentId: "student-1",
          displayName: "Synthetic Student",
          participantType: "minor",
          consent: {
            consentId: consent.consentId,
            studentId: consent.subjectId,
            waiverVersionId: consent.waiverVersionId,
            versionLabel: consent.versionLabel,
            clauseResponses: consent.clauseResponses,
            signedAt: consent.signedAt,
            revokedAt: consent.revokedAt,
            evidenceDocumentId: consent.evidenceDocumentId,
            status: consent.status,
            schemaVersion: "1",
          },
        },
      ],
    };
    expect(parseWaiverRegistrationProjection(projection)).toMatchObject({ ok: true });
    expect(
      parseWaiverRegistrationProjection({
        ...projection,
        subjects: [{ ...projection.subjects[0], signedBy: "guardian-1" }],
      }).ok,
    ).toBe(false);
  });
});
