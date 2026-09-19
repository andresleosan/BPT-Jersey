import {
  updateMemberDetailsInputSchema,
  type MemberDetails,
  type UpdateMemberDetailsInput,
} from "@bpt-jersey/domain/members/profile";

/**
 * T051V2: the DETAILS form edits strings; the update callable takes a strict full-replacement
 * payload. This module is the only place that converts between them.
 */
export const dialCodes = Object.freeze([
  "+44",
  "+351",
  "+353",
  "+33",
  "+34",
  "+48",
  "+49",
  "+39",
  "+55",
  "+1",
] as const);
// ponytail: ten dialling codes cover the academy's members; any other code is typed into the number.

export type DetailsDraft = Readonly<{
  fullName: string;
  shortName: string;
  membershipNumber: string;
  nickname: string;
  email: string;
  phoneCountryCode: string;
  phoneLocalNumber: string;
  emergencyContactFullName: string;
  emergencyContactRelationship: string;
  emergencyContactPhoneNumber: string;
  emergencyContactAlternatePhoneNumber: string;
  addressLine: string;
  city: string;
  postCode: string;
  country: string;
  idCardNumber: string;
  idCardExpiresOn: string;
  healthNumber: string;
  vatNumber: string;
  profession: string;
  gender: "male" | "female" | "unknown";
  dateOfBirth: string;
  weightKg: string;
  heightCm: string;
  registeredOn: string;
  recommendedByStudentId: string;
  howHeard: string;
  initialContact: string;
  internalNotes: string;
}>;

export type DetailsDraftField = keyof DetailsDraft;

export function splitPhoneNumber(value: string | undefined): {
  countryCode: string;
  localNumber: string;
} {
  if (value === undefined) return { countryCode: "", localNumber: "" };
  const match = /^(\+\d{1,4}) (.+)$/u.exec(value);
  const code = match?.[1];
  const local = match?.[2];
  if (
    code !== undefined &&
    local !== undefined &&
    (dialCodes as readonly string[]).includes(code)
  ) {
    return { countryCode: code, localNumber: local };
  }
  return { countryCode: "", localNumber: value };
}

export function joinPhoneNumber(countryCode: string, localNumber: string): string | undefined {
  const local = localNumber.trim();
  if (local.length === 0) return undefined;
  return countryCode === "" ? local : `${countryCode} ${local}`;
}

export function draftFromDetails(details: MemberDetails): DetailsDraft {
  const phone = splitPhoneNumber(details.phoneNumber);
  const extra = details.details;
  return {
    fullName: details.fullName,
    shortName: extra?.shortName ?? "",
    membershipNumber: details.membershipNumber ?? "",
    nickname: extra?.nickname ?? "",
    email: details.email ?? "",
    phoneCountryCode: phone.countryCode,
    phoneLocalNumber: phone.localNumber,
    emergencyContactFullName: details.emergencyContact?.fullName ?? "",
    emergencyContactRelationship: details.emergencyContact?.relationship ?? "",
    emergencyContactPhoneNumber: details.emergencyContact?.phoneNumber ?? "",
    emergencyContactAlternatePhoneNumber: details.emergencyContact?.alternatePhoneNumber ?? "",
    addressLine: details.postalAddress?.line ?? "",
    city: extra?.city ?? "",
    postCode: details.postalAddress?.postCode ?? "",
    country: extra?.country ?? "",
    idCardNumber: details.idCardNumber ?? "",
    idCardExpiresOn: extra?.idCardExpiresOn ?? "",
    healthNumber: extra?.healthNumber ?? "",
    vatNumber: details.vatNumber ?? "",
    profession: extra?.profession ?? "",
    gender: details.gender,
    dateOfBirth: details.dateOfBirth ?? "",
    weightKg: extra?.weightKg === undefined ? "" : String(extra.weightKg),
    heightCm: extra?.heightCm === undefined ? "" : String(extra.heightCm),
    registeredOn: extra?.registeredOn ?? "",
    recommendedByStudentId: extra?.recommendedByStudentId ?? "",
    howHeard: extra?.howHeard ?? "",
    initialContact: extra?.initialContact ?? "",
    internalNotes: extra?.internalNotes ?? "",
  };
}

export function isDraftDirty(baseline: DetailsDraft, draft: DetailsDraft): boolean {
  return (Object.keys(baseline) as DetailsDraftField[]).some((key) => baseline[key] !== draft[key]);
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Empty = absent; anything else must be a finite number, or it stays NaN and fails the schema. */
function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : Number(trimmed);
}

function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

const draftFieldNames = new Set<string>(
  Object.keys(
    draftFromDetails({
      studentId: "x",
      fullName: "x",
      dateOfBirth: "2000-01-01",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      participantType: "adult",
      active: true,
      status: "active",
      gender: "unknown",
    }),
  ),
);

function fieldForIssuePath(path: readonly PropertyKey[]): DetailsDraftField {
  const [head, sub] = path;
  if (head === "details" && typeof sub === "string" && draftFieldNames.has(sub)) {
    return sub as DetailsDraftField;
  }
  if (head === "phoneNumber") return "phoneLocalNumber";
  if (head === "emergencyContact") return "emergencyContactFullName";
  if (head === "postalAddress") return "addressLine";
  if (typeof head === "string" && draftFieldNames.has(head)) return head as DetailsDraftField;
  return "fullName";
}

export function payloadFromDraft(
  details: MemberDetails,
  draft: DetailsDraft,
  requestId: string,
):
  | Readonly<{ ok: true; payload: UpdateMemberDetailsInput }>
  | Readonly<{ ok: false; fields: readonly DetailsDraftField[] }> {
  const missing: DetailsDraftField[] = [];

  const contact = {
    fullName: optionalText(draft.emergencyContactFullName),
    relationship: optionalText(draft.emergencyContactRelationship),
    phoneNumber: optionalText(draft.emergencyContactPhoneNumber),
    alternatePhoneNumber: optionalText(draft.emergencyContactAlternatePhoneNumber),
  };
  const contactStarted = Object.values(contact).some((value) => value !== undefined);
  if (contactStarted) {
    if (contact.fullName === undefined) missing.push("emergencyContactFullName");
    if (contact.relationship === undefined) missing.push("emergencyContactRelationship");
    if (contact.phoneNumber === undefined) missing.push("emergencyContactPhoneNumber");
  }

  const line = optionalText(draft.addressLine);
  const postCode = optionalText(draft.postCode);
  if (line !== undefined && postCode === undefined) missing.push("postCode");
  if (line === undefined && postCode !== undefined) missing.push("addressLine");

  if (missing.length > 0) return { ok: false, fields: missing };

  const candidate = {
    studentId: details.studentId,
    requestId,
    fullName: draft.fullName.trim(),
    dateOfBirth: draft.dateOfBirth,
    ...defined({
      phoneNumber: joinPhoneNumber(draft.phoneCountryCode, draft.phoneLocalNumber),
      email: optionalText(draft.email),
    }),
    trainingCenter: details.trainingCenter,
    trainingTimePreferences: [...details.trainingTimePreferences],
    ...defined({
      membershipNumber: optionalText(draft.membershipNumber),
      idCardNumber: optionalText(draft.idCardNumber),
      vatNumber: optionalText(draft.vatNumber),
    }),
    gender: draft.gender,
    ...defined({ frequencyNote: details.frequencyNote }),
    ...(contactStarted ? { emergencyContact: defined(contact) } : {}),
    ...(line !== undefined && postCode !== undefined ? { postalAddress: { line, postCode } } : {}),
    details: defined({
      shortName: optionalText(draft.shortName),
      nickname: optionalText(draft.nickname),
      city: optionalText(draft.city),
      country: optionalText(draft.country),
      idCardExpiresOn: optionalText(draft.idCardExpiresOn),
      healthNumber: optionalText(draft.healthNumber),
      profession: optionalText(draft.profession),
      weightKg: optionalNumber(draft.weightKg),
      heightCm: optionalNumber(draft.heightCm),
      registeredOn: optionalText(draft.registeredOn),
      recommendedByStudentId: optionalText(draft.recommendedByStudentId),
      howHeard: optionalText(draft.howHeard),
      initialContact: optionalText(draft.initialContact),
      internalNotes: optionalText(draft.internalNotes),
    }),
  };

  const parsed = updateMemberDetailsInputSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, payload: parsed.data };
  const fields = [...new Set(parsed.error.issues.map((issue) => fieldForIssuePath(issue.path)))];
  return { ok: false, fields };
}

const excludedRegionCodes = new Set(["EU", "EZ", "QO", "UN", "XA", "XB", "ZZ"]);
let cachedCountries: readonly { code: string; name: string }[] | undefined;

/**
 * ISO 3166 alpha-2 codes named by the browser's own region names, so no country list ships in the
 * bundle. ponytail: a few withdrawn codes that ICU still names (for example "AN") may appear; the
 * stored value is only ever a two-letter code.
 */
export function countryOptions(): readonly { code: string; name: string }[] {
  if (cachedCountries !== undefined) return cachedCountries;
  const names = new Intl.DisplayNames(["en-GB"], { type: "region" });
  const options: { code: string; name: string }[] = [];
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      if (excludedRegionCodes.has(code)) continue;
      let name: string | undefined;
      try {
        name = names.of(code);
      } catch {
        name = undefined;
      }
      if (name !== undefined && name !== code) options.push({ code, name });
    }
  }
  cachedCountries = Object.freeze(
    options.sort((left, right) => left.name.localeCompare(right.name, "en-GB")),
  );
  return cachedCountries;
}

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) / 86_400_000;
}

export function idExpiryNotice(
  expiresOn: string,
  today: string,
): Readonly<{ kind: "expired" }> | Readonly<{ kind: "soon"; days: number }> | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(expiresOn)) return null;
  const days = dayNumber(expiresOn) - dayNumber(today);
  if (Number.isNaN(days)) return null;
  if (days < 0) return { kind: "expired" };
  return days <= 30 ? { kind: "soon", days } : null;
}
