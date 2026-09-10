import { describe, expect, it } from "vitest";

import {
  appliesToParticipant,
  canonicalizeDisclaimerContent,
  deriveOutstandingDisclaimers,
  disclaimerAcceptanceId,
  disclaimerId,
  isDisclaimerLive,
  parseDisclaimerAcceptance,
  parseDisclaimerAcceptanceInput,
  parseDisclaimerPublicationInput,
  toDisclaimerProjection,
  type Disclaimer,
  type DisclaimerAcceptance,
} from "./disclaimer-contracts";

const now = "2026-09-05T12:00:00.000Z";
const academyId = "academy-1";
const hash = "a".repeat(64);
const otherHash = "b".repeat(64);

function publication(overrides: Record<string, unknown> = {}) {
  return {
    key: "photo-consent",
    versionLabel: "v1",
    title: "Photography at open mat",
    body: "Synthetic placeholder body for the pilot. No legal wording ships in this repository.",
    audience: "all" as const,
    required: true,
    effectiveAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function disclaimer(overrides: Partial<Disclaimer> = {}): Disclaimer {
  return {
    disclaimerId: "photo-consent__v1",
    academyId,
    key: "photo-consent",
    versionLabel: "v1",
    title: "Photography at open mat",
    body: "Synthetic placeholder body for the pilot.",
    audience: "all",
    required: true,
    contentHash: hash,
    status: "published",
    effectiveAt: "2026-09-01T00:00:00.000Z",
    publishedAt: "2026-09-01T00:00:00.000Z",
    publishedBy: "owner-1",
    supersededBy: null,
    withdrawnAt: null,
    schemaVersion: "1",
    ...overrides,
  };
}

function acceptance(overrides: Partial<DisclaimerAcceptance> = {}): DisclaimerAcceptance {
  return {
    acceptanceId: "photo-consent__v1__student-1",
    academyId,
    disclaimerId: "photo-consent__v1",
    key: "photo-consent",
    versionLabel: "v1",
    contentHash: hash,
    studentId: "student-1",
    acceptedBy: "adult-1",
    acceptedAt: "2026-09-02T00:00:00.000Z",
    withdrawnAt: null,
    status: "accepted",
    schemaVersion: "1",
    ...overrides,
  };
}

describe("disclaimer publication input (T117)", () => {
  it("accepts a well-formed publication and rejects an extra field", () => {
    expect(parseDisclaimerPublicationInput(publication()).ok).toBe(true);
    expect(parseDisclaimerPublicationInput({ ...publication(), contentHash: hash }).ok).toBe(false);
    // The identity and the hash are derived by the store; office never supplies them.
    expect(parseDisclaimerPublicationInput({ ...publication(), disclaimerId: "x" }).ok).toBe(false);
  });

  it("constrains the key to a slug a URL and a Firestore id can both carry", () => {
    for (const key of ["Photo", "ph", "photo consent", "photo_consent", "-photo", "a".repeat(49)]) {
      expect(parseDisclaimerPublicationInput(publication({ key })).ok, key).toBe(false);
    }
    for (const key of ["photo-consent", "abc", "a-1", "a".repeat(48)]) {
      expect(parseDisclaimerPublicationInput(publication({ key })).ok, key).toBe(true);
    }
  });

  it("refuses untrimmed text, control characters and an over-long body", () => {
    expect(parseDisclaimerPublicationInput(publication({ title: " Photography " })).ok).toBe(false);
    expect(
      parseDisclaimerPublicationInput(
        publication({ title: `Photo${String.fromCharCode(9)}graphy` }),
      ).ok,
    ).toBe(false);
    expect(parseDisclaimerPublicationInput(publication({ body: "" })).ok).toBe(false);
    expect(parseDisclaimerPublicationInput(publication({ body: "x".repeat(20_001) })).ok).toBe(
      false,
    );
    expect(parseDisclaimerPublicationInput(publication({ body: "x".repeat(20_000) })).ok).toBe(
      true,
    );
  });

  it("refuses an audience and an effective date it does not understand", () => {
    expect(parseDisclaimerPublicationInput(publication({ audience: "coaches" })).ok).toBe(false);
    expect(parseDisclaimerPublicationInput(publication({ effectiveAt: "2026-09-01" })).ok).toBe(
      false,
    );
    for (const audience of ["all", "adult", "minor"]) {
      expect(parseDisclaimerPublicationInput(publication({ audience })).ok, audience).toBe(true);
    }
  });
});

describe("content hash (T117)", () => {
  it("changes when a reader would notice, and not when they would not", () => {
    const base = canonicalizeDisclaimerContent(publication());
    expect(canonicalizeDisclaimerContent(publication())).toBe(base);
    // The effective date and the required flag do not ask anybody to read anything again.
    expect(
      canonicalizeDisclaimerContent(publication({ effectiveAt: "2027-01-01T00:00:00.000Z" })),
    ).toBe(base);
    expect(canonicalizeDisclaimerContent(publication({ required: false }))).toBe(base);
    // The title, the body and the audience do.
    expect(canonicalizeDisclaimerContent(publication({ title: "Photography" }))).not.toBe(base);
    expect(canonicalizeDisclaimerContent(publication({ body: "Different text." }))).not.toBe(base);
    expect(canonicalizeDisclaimerContent(publication({ audience: "minor" }))).not.toBe(base);
  });

  it("builds deterministic identities", () => {
    expect(disclaimerId("photo-consent", "v2")).toBe("photo-consent__v2");
    expect(disclaimerAcceptanceId("photo-consent__v2", "student-1")).toBe(
      "photo-consent__v2__student-1",
    );
  });
});

describe("acceptance record (T117)", () => {
  it("requires a timestamp for a withdrawal and forbids one otherwise", () => {
    expect(parseDisclaimerAcceptance(acceptance()).ok).toBe(true);
    expect(parseDisclaimerAcceptance(acceptance({ status: "withdrawn" })).ok).toBe(false);
    expect(
      parseDisclaimerAcceptance(
        acceptance({ status: "withdrawn", withdrawnAt: "2026-09-03T00:00:00.000Z" }),
      ).ok,
    ).toBe(true);
    expect(
      parseDisclaimerAcceptance(acceptance({ withdrawnAt: "2026-09-03T00:00:00.000Z" })).ok,
    ).toBe(false);
  });

  it("takes exactly the three fields the participant's action carries", () => {
    const input = { disclaimerId: "photo-consent__v1", studentId: "student-1", contentHash: hash };
    expect(parseDisclaimerAcceptanceInput(input).ok).toBe(true);
    expect(parseDisclaimerAcceptanceInput({ ...input, acceptedBy: "adult-1" }).ok).toBe(false);
    expect(parseDisclaimerAcceptanceInput({ ...input, contentHash: "short" }).ok).toBe(false);
    expect(parseDisclaimerAcceptanceInput({ disclaimerId: "x", studentId: "y" }).ok).toBe(false);
  });
});

describe("isDisclaimerLive (T117)", () => {
  it("is live only once published and in effect", () => {
    expect(isDisclaimerLive(disclaimer(), now)).toBe(true);
    expect(isDisclaimerLive(disclaimer({ status: "superseded" }), now)).toBe(false);
    expect(isDisclaimerLive(disclaimer({ status: "withdrawn" }), now)).toBe(false);
    expect(isDisclaimerLive(disclaimer({ effectiveAt: "2027-01-01T00:00:00.000Z" }), now)).toBe(
      false,
    );
  });

  it("fails closed on an unreadable date rather than asking for an undated acceptance", () => {
    expect(isDisclaimerLive(disclaimer({ effectiveAt: "not-a-date" }), now)).toBe(false);
    expect(isDisclaimerLive(disclaimer(), "not-a-date")).toBe(false);
  });
});

describe("appliesToParticipant (T117)", () => {
  it("sends a minor disclaimer only to minors", () => {
    expect(appliesToParticipant({ audience: "all" }, "adult")).toBe(true);
    expect(appliesToParticipant({ audience: "all" }, "minor")).toBe(true);
    expect(appliesToParticipant({ audience: "minor" }, "adult")).toBe(false);
    expect(appliesToParticipant({ audience: "minor" }, "minor")).toBe(true);
    expect(appliesToParticipant({ audience: "adult" }, "minor")).toBe(false);
  });
});

describe("deriveOutstandingDisclaimers (T117)", () => {
  const base = {
    studentId: "student-1",
    participantType: "adult" as const,
    now,
  };

  it("lists a live disclaimer nobody has accepted", () => {
    const outstanding = deriveOutstandingDisclaimers({
      ...base,
      disclaimers: [disclaimer()],
      acceptances: [],
    });
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]).toMatchObject({
      studentId: "student-1",
      previouslyAcceptedVersionLabel: null,
    });
    expect(outstanding[0]?.disclaimer.disclaimerId).toBe("photo-consent__v1");
  });

  it("drops it once this exact version is accepted", () => {
    expect(
      deriveOutstandingDisclaimers({
        ...base,
        disclaimers: [disclaimer()],
        acceptances: [acceptance()],
      }),
    ).toEqual([]);
  });

  /** The property the whole row exists for. */
  it("asks again when a new version is published, and says it is a re-consent", () => {
    const v2 = disclaimer({
      disclaimerId: "photo-consent__v2",
      versionLabel: "v2",
      body: "Reworded body.",
      contentHash: otherHash,
    });
    const outstanding = deriveOutstandingDisclaimers({
      ...base,
      // v1 is superseded, v2 is live; the participant accepted v1.
      disclaimers: [disclaimer({ status: "superseded", supersededBy: "photo-consent__v2" }), v2],
      acceptances: [acceptance()],
    });
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]).toMatchObject({ previouslyAcceptedVersionLabel: "v1" });
    expect(outstanding[0]?.disclaimer.versionLabel).toBe("v2");
  });

  it("asks again once an acceptance is withdrawn", () => {
    const outstanding = deriveOutstandingDisclaimers({
      ...base,
      disclaimers: [disclaimer()],
      acceptances: [acceptance({ status: "withdrawn", withdrawnAt: "2026-09-03T00:00:00.000Z" })],
    });
    expect(outstanding).toHaveLength(1);
    // A withdrawn acceptance is not a previous acceptance to point at: it was taken back.
    expect(outstanding[0]?.previouslyAcceptedVersionLabel).toBeNull();
  });

  it("never uses one participant's acceptance for another", () => {
    const outstanding = deriveOutstandingDisclaimers({
      ...base,
      disclaimers: [disclaimer()],
      acceptances: [acceptance({ studentId: "student-2", acceptanceId: "other" })],
    });
    expect(outstanding).toHaveLength(1);
  });

  it("respects the audience of each disclaimer", () => {
    const disclaimers = [
      disclaimer({ disclaimerId: "a__v1", key: "adults-only", audience: "adult" }),
      disclaimer({ disclaimerId: "m__v1", key: "minors-only", audience: "minor" }),
    ];
    expect(
      deriveOutstandingDisclaimers({ ...base, disclaimers, acceptances: [] }).map(
        (entry) => entry.disclaimer.key,
      ),
    ).toEqual(["adults-only"]);
    expect(
      deriveOutstandingDisclaimers({
        ...base,
        participantType: "minor",
        disclaimers,
        acceptances: [],
      }).map((entry) => entry.disclaimer.key),
    ).toEqual(["minors-only"]);
  });

  it("puts what is required first, then the oldest", () => {
    const disclaimers = [
      disclaimer({
        disclaimerId: "opt__v1",
        key: "optional-one",
        required: false,
        effectiveAt: "2026-08-01T00:00:00.000Z",
      }),
      disclaimer({
        disclaimerId: "req-b__v1",
        key: "required-b",
        effectiveAt: "2026-08-20T00:00:00.000Z",
      }),
      disclaimer({
        disclaimerId: "req-a__v1",
        key: "required-a",
        effectiveAt: "2026-08-10T00:00:00.000Z",
      }),
    ];
    expect(
      deriveOutstandingDisclaimers({ ...base, disclaimers, acceptances: [] }).map(
        (entry) => entry.disclaimer.key,
      ),
    ).toEqual(["required-a", "required-b", "optional-one"]);
  });

  it("returns an honest empty list when the academy has published nothing", () => {
    expect(deriveOutstandingDisclaimers({ ...base, disclaimers: [], acceptances: [] })).toEqual([]);
  });
});

describe("toDisclaimerProjection (T117)", () => {
  it("shows the participant the text and its hash, and nothing administrative", () => {
    const projection = toDisclaimerProjection(disclaimer());
    expect(Object.keys(projection).sort()).toEqual([
      "body",
      "contentHash",
      "disclaimerId",
      "effectiveAt",
      "key",
      "required",
      "title",
      "versionLabel",
    ]);
    expect(JSON.stringify(projection)).not.toContain("owner-1");
    expect(JSON.stringify(projection)).not.toContain(academyId);
  });
});
