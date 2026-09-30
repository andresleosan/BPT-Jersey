import { z } from "zod";
import { accountMemberProfileSchema, type AccountMemberProfile } from "@bpt-jersey/domain/members/access";
import type { TrainingCenter } from "@bpt-jersey/domain/profiles";

import { httpsCallable } from "./callable";
import { getFamily } from "./family-client";
import { getFirebaseAuth, getFirebaseFunctions } from "./firebase-client";
import { getClientProfile } from "./profile-client";

/**
 * Who trains on this account (spec 2026-09-30 D14): the holder when they have a `self` profile,
 * then each child they are guardian of. Never derived from the role claim: a parent who trains and
 * has children who train is both, and a claim changed by an approval reaches the browser late.
 */
export type AccountPerson = Readonly<{
  studentId: string;
  fullName: string;
  via: "self" | "guardian";
  dateOfBirth?: string;
  trainingCenter: TrainingCenter;
}>;

const profilesSchema = z.object({ profiles: z.array(accountMemberProfileSchema) });

export async function listMyProfiles(): Promise<readonly AccountMemberProfile[]> {
  try {
    const response = await httpsCallable<unknown, unknown>(
      getFirebaseFunctions(),
      "listMyMemberProfiles",
    )({});
    return profilesSchema.parse(response.data).profiles;
  } catch {
    throw new Error("We couldn't load your account right now. Try again.");
  }
}

export async function loadAccountPeople(): Promise<readonly AccountPerson[]> {
  const profiles = await listMyProfiles();
  const hasSelf = profiles.some((profile) => profile.via === "self");
  const hasChildren = profiles.some((profile) => profile.via === "guardian");
  const [own, family] = await Promise.all([
    hasSelf ? getClientProfile() : undefined,
    hasChildren ? getFamily() : undefined,
  ]);
  // An approval may have made this account a guardian after its token was issued; refresh it once
  // so pages that still read the role catch up. ponytail: fire-and-forget, the list never needs it.
  if (hasChildren) void getFirebaseAuth().currentUser?.getIdToken(true).catch(() => undefined);
  return profiles.flatMap((profile): AccountPerson[] => {
    const student =
      profile.via === "self"
        ? own?.student.studentId === profile.studentId
          ? own.student
          : undefined
        : family?.students.find(
            (candidate) =>
              candidate.studentId === profile.studentId &&
              candidate.active &&
              candidate.status === "active",
          );
    return student
      ? [
          {
            studentId: student.studentId,
            fullName: student.fullName,
            via: profile.via,
            ...(student.dateOfBirth ? { dateOfBirth: student.dateOfBirth } : {}),
            trainingCenter: student.trainingCenter,
          },
        ]
      : [];
  });
}
