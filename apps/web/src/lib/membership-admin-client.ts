import { httpsCallable } from "firebase/functions";
import { z } from "zod";

import {
  billingPeriods,
  participantTypes,
  planIds,
  siteValues,
  type PlanDraft,
  type PlanId,
} from "@bpt-jersey/domain/memberships";
import {
  membershipStatuses,
  type MembershipStatus,
} from "@bpt-jersey/domain/memberships/lifecycle";

import { getFirebaseFunctions } from "./firebase-client";

export type ManagedMembershipPlan = PlanDraft & Readonly<{ active: boolean }>;
export type AdminMembership = Readonly<{
  membershipId: string;
  familyId: string;
  studentId: string;
  planId: PlanId;
  status: MembershipStatus;
  startsAt: string;
  endsAt: string | null;
  nextBillingAt: string | null;
}>;
export type CreateMembershipInput = Readonly<{
  familyId: string;
  studentId: string;
  planId: PlanId;
  status: "trial" | "active";
}>;
export type TransitionMembershipInput = Readonly<{
  membershipId: string;
  targetStatus: MembershipStatus;
}>;

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

function isValidDateTime(value: string): boolean {
  if (!dateTimePattern.test(value) || Number.isNaN(Date.parse(value))) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (!match) return false;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

const dateTimeSchema = z.string().refine(isValidDateTime);
const planIdSchema = z.enum(planIds);
const participantTypeSchema = z.enum(participantTypes);
const siteSchema = z.enum(siteValues);
const uniqueNonEmptyParticipantTypes = z
  .array(participantTypeSchema)
  .min(1)
  .refine((values) => new Set(values).size === values.length);
const uniqueNonEmptySites = z
  .array(siteSchema)
  .min(1)
  .refine((values) => new Set(values).size === values.length);

const planDraftSchema = z
  .object({
    planId: planIdSchema,
    displayName: z
      .string()
      .min(1)
      .max(160)
      .refine((value) => value === value.trim() && !controlCharacterPattern.test(value)),
    priceMinor: z.number().int().nonnegative().safe(),
    currency: z.literal("GBP"),
    billingPeriod: z.enum(billingPeriods),
    eligibleParticipantTypes: uniqueNonEmptyParticipantTypes,
    classSites: uniqueNonEmptySites,
    weeklyClassLimit: z.union([z.literal(1), z.literal(2), z.null()]),
    openMatSites: uniqueNonEmptySites,
    openMatFeeMinor: z.number().int().nonnegative().safe().nullable(),
  })
  .strict();

const managedPlanSchema = planDraftSchema.extend({ active: z.boolean() }).strict();
const membershipSchema = z
  .object({
    membershipId: identifierSchema,
    familyId: identifierSchema,
    studentId: identifierSchema,
    planId: planIdSchema,
    status: z.enum(membershipStatuses),
    startsAt: dateTimeSchema,
    endsAt: dateTimeSchema.nullable(),
    nextBillingAt: dateTimeSchema.nullable(),
  })
  .strict();
const createMembershipSchema = z
  .object({
    familyId: identifierSchema,
    studentId: identifierSchema,
    planId: planIdSchema,
    status: z.enum(["trial", "active"]),
  })
  .strict();
const transitionMembershipSchema = z
  .object({
    membershipId: identifierSchema,
    targetStatus: z.enum(membershipStatuses),
  })
  .strict();

const listPlansError = "Unable to load membership plans. Please try again.";
const savePlanError = "Unable to save membership plan. Please try again.";
const planStatusError = "Unable to change membership plan status. Please try again.";
const listMembershipsError = "Unable to load memberships. Please try again.";
const createMembershipError = "Unable to create membership. Refresh before trying again.";
const transitionMembershipError = "Unable to change membership status. Please try again.";
const cancelMembershipError = "Unable to cancel membership. Please try again.";

function parsePlan(value: unknown, safeMessage: string): ManagedMembershipPlan {
  const parsed = managedPlanSchema.safeParse(value);
  if (!parsed.success) throw new Error(safeMessage);
  return Object.freeze({
    ...parsed.data,
    eligibleParticipantTypes: Object.freeze([...parsed.data.eligibleParticipantTypes]),
    classSites: Object.freeze([...parsed.data.classSites]),
    openMatSites: Object.freeze([...parsed.data.openMatSites]),
  });
}

function parseMembership(value: unknown, safeMessage: string): AdminMembership {
  const parsed = membershipSchema.safeParse(value);
  if (!parsed.success) throw new Error(safeMessage);
  return Object.freeze(parsed.data);
}

export async function listManagedPlans(): Promise<readonly ManagedMembershipPlan[]> {
  try {
    const callable = httpsCallable<null, unknown>(getFirebaseFunctions(), "listManagedPlans");
    const result = await callable(null);
    if (!Array.isArray(result.data)) throw new Error(listPlansError);
    return Object.freeze(result.data.map((plan) => parsePlan(plan, listPlansError)));
  } catch {
    throw new Error(listPlansError);
  }
}

export async function saveMembershipPlan(input: PlanDraft): Promise<ManagedMembershipPlan> {
  try {
    const draft = planDraftSchema.parse(input);
    const callable = httpsCallable<PlanDraft, unknown>(getFirebaseFunctions(), "savePlan");
    const result = await callable(draft);
    return parsePlan(result.data, savePlanError);
  } catch {
    throw new Error(savePlanError);
  }
}

export async function setMembershipPlanActive(
  planId: PlanId,
  active: boolean,
): Promise<ManagedMembershipPlan> {
  try {
    const safePlanId = planIdSchema.parse(planId);
    if (typeof active !== "boolean") throw new Error(planStatusError);
    const callable = httpsCallable<Readonly<{ planId: PlanId }>, unknown>(
      getFirebaseFunctions(),
      active ? "activatePlan" : "deactivatePlan",
    );
    const result = await callable({ planId: safePlanId });
    const plan = parsePlan(result.data, planStatusError);
    if (plan.planId !== safePlanId || plan.active !== active) throw new Error(planStatusError);
    return plan;
  } catch {
    throw new Error(planStatusError);
  }
}

export async function listMemberships(): Promise<readonly AdminMembership[]> {
  try {
    const callable = httpsCallable<null, unknown>(getFirebaseFunctions(), "listMemberships");
    const result = await callable(null);
    if (!Array.isArray(result.data)) throw new Error(listMembershipsError);
    return Object.freeze(
      result.data.map((membership) => parseMembership(membership, listMembershipsError)),
    );
  } catch {
    throw new Error(listMembershipsError);
  }
}

export async function createMembership(
  input: CreateMembershipInput,
): Promise<AdminMembership> {
  try {
    const payload = createMembershipSchema.parse(input);
    const callable = httpsCallable<CreateMembershipInput, unknown>(
      getFirebaseFunctions(),
      "createMembership",
    );
    const result = await callable(payload);
    const membership = parseMembership(result.data, createMembershipError);
    if (
      membership.familyId !== payload.familyId ||
      membership.studentId !== payload.studentId ||
      membership.planId !== payload.planId ||
      membership.status !== payload.status
    ) {
      throw new Error(createMembershipError);
    }
    return membership;
  } catch {
    throw new Error(createMembershipError);
  }
}

export async function transitionMembership(
  input: TransitionMembershipInput,
): Promise<AdminMembership> {
  try {
    const payload = transitionMembershipSchema.parse(input);
    const callable = httpsCallable<TransitionMembershipInput, unknown>(
      getFirebaseFunctions(),
      "transitionMembership",
    );
    const result = await callable(payload);
    const membership = parseMembership(result.data, transitionMembershipError);
    if (
      membership.membershipId !== payload.membershipId ||
      membership.status !== payload.targetStatus
    ) {
      throw new Error(transitionMembershipError);
    }
    return membership;
  } catch {
    throw new Error(transitionMembershipError);
  }
}

export async function cancelMembership(membershipId: string): Promise<AdminMembership> {
  try {
    const safeMembershipId = identifierSchema.parse(membershipId);
    const callable = httpsCallable<Readonly<{ membershipId: string }>, unknown>(
      getFirebaseFunctions(),
      "cancelMembership",
    );
    const result = await callable({ membershipId: safeMembershipId });
    const membership = parseMembership(result.data, cancelMembershipError);
    if (membership.membershipId !== safeMembershipId || membership.status !== "cancelled") {
      throw new Error(cancelMembershipError);
    }
    return membership;
  } catch {
    throw new Error(cancelMembershipError);
  }
}
