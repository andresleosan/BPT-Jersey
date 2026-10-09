import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { error as logError } from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { coachBeltLabels, coachBelts, coachBeltSchema, type CoachBelt } from "@bpt-jersey/domain/staff/team-access";
import { browserOrigins } from "../auth/callable-options.js";
import { coursesAcademyId } from "../courses/course-public-http.js";
import { enrolmentStorageSecrets } from "../members/enrolment-payment-proof.js";
import { createPrivateStorageR2Client } from "../storage/r2-client.js";
import { coachWebsitePath, signCoachPhoto } from "./coach-website-profile.js";
import { profileNames } from "./profile-names.js";

/** Coaches, plus owners who teach (active coach profile). Administrators never appear. */
const websiteRoles = ["coach", "headCoach", "owner"];

export function sortPublicCoaches<T extends { name: string; belt: CoachBelt }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => coachBelts.indexOf(a.belt) - coachBelts.indexOf(b.belt) || a.name.localeCompare(b.name, "en"));
}

// ponytail: per-instance cache for the same 60 s the Cache-Control header promises. Every anonymous
// hit otherwise ran Auth and Firestore reads and signed R2 URLs; maxInstances caps the rest.
let cached: { at: number; body: unknown } | undefined;

export const coachesPublic = onRequest({ cors: browserOrigins, invoker: "public", timeoutSeconds: 15, memory: "256MiB", maxInstances: 2, secrets: enrolmentStorageSecrets }, async (request, response) => {
  response.set("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET") { response.set("Allow", "GET"); response.status(405).json({ error: "method_not_allowed" }); return; }
  if (cached && Date.now() - cached.at < 60_000) { response.set("Cache-Control", "public, max-age=60"); response.status(200).json(cached.body); return; }
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
    const db = getFirestore();
    // Members with coach access stay listed in member mode; hidden coaches never are.
    const [memberCoaches, hiddenCoaches] = await Promise.all([
      db.collection(`academies/${academyId}/coachMemberAccess`).get(),
      db.collection(`academies/${academyId}/coachWebsite`).where("hidden", "==", true).get(),
    ]);
    const dual = new Set(memberCoaches.docs.map((doc) => doc.id));
    const hidden = new Set(hiddenCoaches.docs.map((doc) => doc.id));
    const eligible = users.filter((user) => !user.disabled && user.customClaims?.academyId === academyId && !hidden.has(user.uid) && (websiteRoles.includes(String(user.customClaims?.role)) || dual.has(user.uid)));
    // Member logins often have no Auth name: the academy profile holds it.
    const names = await profileNames(db, academyId, eligible.filter((user) => !user.displayName?.trim()).map((user) => user.uid));
    const named = eligible.map((user) => ({ user, name: user.displayName?.trim() || names.get(user.uid) || "" })).filter((item) => item.name);
    const shown = named.map((item) => item.user);
    const r2 = createPrivateStorageR2Client();
    const websites = shown.length === 0 ? [] : await db.getAll(...shown.map((user) => db.doc(coachWebsitePath(academyId, user.uid))));
    const rows = await Promise.all(shown.map(async (user, index) => {
      const website = websites[index]?.data();
      const bio = typeof website?.bio === "string" ? website.bio.trim() : "";
      // A photo that cannot be signed only hides the photo, never the coach.
      const photoUrl = await signCoachPhoto(r2, website?.photoKey).catch(() => null);
      return { name: named[index]!.name, belt: belts.get(user.uid)!, ...(bio ? { bio } : {}), ...(photoUrl ? { photoUrl } : {}) };
    }));
    const coaches = sortPublicCoaches(rows).map((coach) => ({ ...coach, beltLabel: coachBeltLabels[coach.belt] }));
    cached = { at: Date.now(), body: { coaches } };
    response.set("Cache-Control", "public, max-age=60");
    response.status(200).json(cached.body);
  } catch (error) {
    logError("coachesPublic failed", error);
    response.set("Cache-Control", "no-store");
    response.status(500).json({ error: "unavailable" });
  }
});
