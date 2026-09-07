import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  enrolmentWaiverTermsAcknowledgement,
  enrolmentWaiverTermsCanonicalText,
  enrolmentWaiverTermsContentHash,
  enrolmentWaiverTermsSections,
  enrolmentWaiverTermsVersion,
} from "./enrolment-waiver-terms";

describe("enrolment waiver terms", () => {
  /**
   * The point of the stored hash is that an acceptance can name the exact words accepted. If the
   * text can drift without the hash moving, every acceptance already stored starts lying about
   * what it covered, so this test is the whole mechanism rather than a formality.
   */
  it("pins the content hash to the text actually shown", () => {
    const computed = createHash("sha256")
      .update(enrolmentWaiverTermsCanonicalText(), "utf8")
      .digest("hex");

    expect(computed).toBe(enrolmentWaiverTermsContentHash);
  });

  it("keeps every clause of the club's document", () => {
    const headings = enrolmentWaiverTermsSections.map((section) => section.heading);

    expect(headings).toHaveLength(10);
    expect(headings[0]).toContain("Acknowledgment of Risks");
    expect(headings[6]).toContain("Minors");
    expect(headings[9]).toContain("Hygiene");
  });

  /**
   * The paper form collects medical conditions, injuries and allergies. Health data is prohibited
   * in the MVP without an approved use case, so the clause promising to declare them to the
   * instructor is shown while no field asks for them here.
   */
  it("asks for no health data of its own", () => {
    const text = enrolmentWaiverTermsCanonicalText();

    expect(text).toContain("inform the instructor of any existing medical conditions");
    expect(enrolmentWaiverTermsSections.some((section) => "fields" in section)).toBe(false);
  });

  it("names a version and an acknowledgement", () => {
    expect(enrolmentWaiverTermsVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(enrolmentWaiverTermsAcknowledgement).toContain("parent or legal guardian");
  });
});
