import type { Firestore } from "firebase-admin/firestore";

/**
 * Names from the academy profiles (users/{uid}.displayName). Member logins created through
 * enrolment often have no Auth displayName, so screens fall back to this.
 */
export async function profileNames(db: Firestore, academyId: string, userIds: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(userIds)];
  for (let start = 0; start < unique.length; start += 100) {
    const refs = unique.slice(start, start + 100).map((uid) => db.doc(`academies/${academyId}/users/${uid}`));
    if (refs.length === 0) continue;
    for (const snapshot of await db.getAll(...refs)) {
      const name = snapshot.data()?.displayName;
      if (typeof name === "string" && name.trim()) names.set(snapshot.id, name.trim());
    }
  }
  return names;
}
