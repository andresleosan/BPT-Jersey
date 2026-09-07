/**
 * The waiver an applicant accepts when they ask the academy for a place.
 *
 * The source of truth is the club's own document, `Brazilian Power Team Jersey Waiver and Release
 * of Liability`. This module carries its text so the acceptance can name exactly what was accepted:
 * a stored acceptance that only says "accepted" proves nothing later, because nobody can show which
 * words were on screen that day.
 *
 * Three things this deliberately does not do:
 *
 * - It does not collect medical conditions, injuries or allergies. The paper form asks for them and
 *   the MVP prohibits health data without an approved use case (DPIA §2, act decision 4), so that
 *   part stays on paper at reception. The clause that mentions them is still shown, because the
 *   applicant is agreeing to declare them to the instructor.
 * - It does not replace a signature. Section 5 of the act says the legal wording belongs to the
 *   club; this is an acceptance of terms, and the academy still handles signatures its own way.
 * - It is not a waiver version record in `waiverVersions`. That collection belongs to T117 and its
 *   callables are not deployed. When they are, this becomes their first version rather than a
 *   parallel one.
 *
 * Editing the text means minting a new version: change `enrolmentWaiverTermsVersion`, update
 * `enrolmentWaiverTermsContentHash`, and let the test in this folder fail until both agree. An
 * acceptance already stored keeps naming the version the applicant actually read.
 */

export const enrolmentWaiverTermsVersion = "2026-09-07";

export type EnrolmentWaiverSection = Readonly<{
  heading: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
}>;

export const enrolmentWaiverTermsTitle =
  "Brazilian Power Team Jersey Waiver and Release of Liability";

export const enrolmentWaiverTermsSections: readonly EnrolmentWaiverSection[] = Object.freeze([
  Object.freeze({
    heading: "1. Acknowledgment of Risks",
    paragraphs: Object.freeze([
      "I understand that participation in Brazilian Jiu-Jitsu (BJJ) involves inherent risks of injury, including but not limited to sprains, fractures, joint injuries, and even more severe injuries such as concussions or paralysis. I voluntarily assume all risks associated with my participation in BJJ activities. This waiver does not exclude liability for death or personal injury caused by the gross negligence or wilful misconduct of Brazilian Power Team Jersey.",
    ]),
  }),
  Object.freeze({
    heading: "2. Medical Condition",
    paragraphs: Object.freeze([
      "I confirm that I am in good physical health and do not have any medical conditions that would prevent me from safely participating in BJJ activities. I agree to inform the instructor of any existing medical conditions or pre-existing injuries prior to participation, together with any medication that could be needed in the event of an emergency.",
    ]),
  }),
  Object.freeze({
    heading: "3. Release of Liability",
    paragraphs: Object.freeze([
      "I, for myself, my heirs, executors, administrators, and assigns, hereby release and forever discharge Brazilian Power Team Jersey, its instructors, volunteers, and independent contractors from any and all claims, demands, actions, or causes of action arising out of or in any way related to my participation in BJJ activities.",
    ]),
  }),
  Object.freeze({
    heading: "4. Indemnification",
    paragraphs: Object.freeze([
      "I agree to indemnify and hold harmless Brazilian Power Team Jersey, its instructors, volunteers, and independent contractors from any claims, demands, lawsuits, or liabilities arising out of my actions or negligence during participation in any BJJ activity.",
    ]),
  }),
  Object.freeze({
    heading: "5. Consent to Medical Treatment",
    paragraphs: Object.freeze([
      "In case of injury or medical emergency, I consent to emergency medical treatment and agree to be responsible for all costs associated with such treatment. Participants are solely responsible for ensuring they have adequate insurance coverage (if needed) for injuries or medical expenses incurred during participation in BJJ activities.",
    ]),
  }),
  Object.freeze({
    heading: "6. Photograph and Video Release",
    paragraphs: Object.freeze([
      "I consent to the use of photographs or video footage taken during BJJ classes or events in which I participate, for promotional purposes including on social media, websites, or printed materials.",
    ]),
  }),
  Object.freeze({
    heading: "7. Minors (Participants Under 18)",
    paragraphs: Object.freeze([
      "If the participant is under 18, I, as the parent or legal guardian, consent to the terms of this waiver and agree to be bound by its conditions on behalf of the minor participant. I also acknowledge that minors may train with other participants who are over the age of 18.",
    ]),
  }),
  Object.freeze({
    heading: "8. Governing Law",
    paragraphs: Object.freeze([
      "This waiver shall be governed by and construed in accordance with the laws of Jersey.",
    ]),
  }),
  Object.freeze({
    heading: "9. Data Protection",
    paragraphs: Object.freeze([
      "Participant information will be stored securely and used only for purposes related to BJJ activities and emergencies, in compliance with the Data Protection (Jersey) Law 2018.",
    ]),
  }),
  Object.freeze({
    heading: "10. Hygiene",
    paragraphs: Object.freeze([
      "I acknowledge the importance of maintaining proper hygiene and cleanliness to ensure the safety, health, and comfort of all participants. I agree to abide by the following hygiene and cleanliness rules:",
    ]),
    bullets: Object.freeze([
      "Personal hygiene: I will maintain a high standard of personal hygiene by showering regularly and ensuring I am clean before each training session, and I will keep my fingernails and toenails trimmed to prevent accidental injury to myself and others.",
      "Training attire: I will wear clean, properly fitting Gi or No-Gi attire to each session, I will not train in clothing that is torn, overly worn, or unsanitary, and I will ensure that my training gear, including belts and rash guards, is washed after every session.",
      "Health and wellness: I will not participate in training if I am feeling unwell, have a fever, or exhibit symptoms of illness; I will avoid training if I have any open wounds, cuts, or skin infections such as ringworm or staph until cleared by a medical professional; and I will immediately report any health concerns to my instructor.",
      "Mat rules: I will not wear shoes or any footwear on the mats, and I must remove all jewellery before training. Any earrings that cannot be removed must be taped.",
      "Responsibility to training partners: I will respect the hygiene and cleanliness of my training partners by always adhering to these rules. I understand that failure to comply may result in being asked to leave the mat or the training facility.",
    ]),
  }),
]);

export const enrolmentWaiverTermsAcknowledgement =
  "By accepting, I acknowledge that I have read and understand this waiver and voluntarily agree to its terms. Where the participant is under 18, I accept on their behalf as their parent or legal guardian.";

/**
 * The paper form ends with a line the academy fills in by hand. It is recorded on approval instead:
 * the reviewer who approves the request is the instructor named against it, so the name comes from
 * an authenticated account rather than from handwriting.
 */
export const enrolmentWaiverInstructorNameLabel = "Instructor Name";

/**
 * SHA-256 of `enrolmentWaiverTermsCanonicalText()`, in lowercase hex. Stored as a constant rather
 * than computed here so nothing in the browser bundle needs a hash implementation; the test in this
 * folder recomputes it and fails when the text and this value drift apart.
 */
export const enrolmentWaiverTermsContentHash =
  "02a64886d0ac8a75b39a029a9ea473c955453570f4b968ef5e63c6afda351e29";

/**
 * The exact bytes the hash covers. Kept deterministic - version, title, headings, paragraphs,
 * bullets and the acknowledgement, joined by newlines - so the same text always produces the same
 * hash regardless of how it is laid out on screen.
 */
export function enrolmentWaiverTermsCanonicalText(): string {
  const lines: string[] = [enrolmentWaiverTermsVersion, enrolmentWaiverTermsTitle];
  for (const section of enrolmentWaiverTermsSections) {
    lines.push(section.heading, ...section.paragraphs, ...(section.bullets ?? []));
  }
  lines.push(enrolmentWaiverTermsAcknowledgement);
  return lines.join("\n");
}
