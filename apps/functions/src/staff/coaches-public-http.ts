import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { coachBeltLabels, coachBelts, coachBeltSchema, type CoachBelt } from "@bpt-jersey/domain/staff/team-access";
import { browserOrigins } from "../auth/callable-options.js";
import { coursesAcademyId } from "../courses/course-public-http.js";

/** Coaches, plus owners who teach (active coach profile). Administrators never appear. */
const websiteRoles = ["coach", "headCoach", "owner"];

export function sortPublicCoaches<T extends { name: string; belt: CoachBelt }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => coachBelts.indexOf(a.belt) - coachBelts.indexOf(b.belt) || a.name.localeCompare(b.name, "en"));
}

export const coachesPublic = onRequest({ cors: browserOrigins, invoker: "public", timeoutSeconds: 15, memory: "256MiB" }, async (request, response) => {
  response.set("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET") { response.set("Allow", "GET"); response.status(405).json({ error: "method_not_allowed" }); return; }
  const academyId = coursesAcademyId.value();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(academyId)) { response.set("Cache-Control", "no-store"); response.status(500).json({ error: "unavailable" }); return; }
  try {
    const staff = await getFirestore().collection(`academies/${academyId}/staff`).where("active", "==", true).get();
    const belts = new Map<string, CoachBelt>();
    for (const doc of staff.docs) {
      const belt = coachBeltSchema.safeParse(doc.data().belt);
      if (belt.success && typeof doc.data().userId === "string") belts.set(doc.data().userId, belt.data);
    }
    // ponytail: getUsers takes at most 100 identifiers; chunk if the team ever passes 100 coaches.
    const users = belts.size === 0 ? [] : (await getAuth().getUsers([...belts.keys()].slice(0, 100).map((uid) => ({ uid })))).users;
    const coaches = sortPublicCoaches(
      users
        .filter((user) => !user.disabled && user.customClaims?.academyId === academyId && websiteRoles.includes(String(user.customClaims?.role)) && user.displayName?.trim())
        .map((user) => ({ name: user.displayName!.trim(), belt: belts.get(user.uid)! })),
    ).map((coach) => ({ ...coach, beltLabel: coachBeltLabels[coach.belt] }));
    response.set("Cache-Control", "public, max-age=60");
    response.status(200).json({ coaches });
  } catch {
    response.set("Cache-Control", "no-store");
    response.status(500).json({ error: "unavailable" });
  }
});
