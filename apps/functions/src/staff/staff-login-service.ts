import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

export const staffNumberPattern = /^[1-9]\d{5}$/u;
const credentialCollection = "staffLoginCredentials";

export async function hashStaffPassword(password: string, salt = randomBytes(32).toString("hex")) {
  const hash = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, derived) => {
        if (error) reject(error);
        else resolve(derived);
      },
    );
  });
  return { salt, passwordHash: hash.toString("hex") };
}

export async function verifyStaffPassword(password: string, salt: string, expected: string) {
  const actual = await hashStaffPassword(password, salt);
  const target = Buffer.from(expected, "hex");
  const supplied = Buffer.from(actual.passwordHash, "hex");
  return target.length === supplied.length && timingSafeEqual(target, supplied);
}

export function createStaffLoginService(firestore: Firestore, auth: Auth) {
  async function consumeLimit(key: string, maximum: number) {
    const ref = firestore.doc(`staffLoginLimits/${createHash("sha256").update(key).digest("hex")}`);
    await firestore.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const now = Date.now();
      const prior = snapshot.data();
      const fresh = typeof prior?.until !== "number" || prior.until <= now;
      const count = fresh ? 0 : Number(prior.count);
      if (!Number.isSafeInteger(count) || count >= maximum)
        throw new HttpsError("resource-exhausted", "Too many attempts. Try again in 15 minutes.");
      tx.set(ref, { count: count + 1, until: fresh ? now + 15 * 60_000 : prior!.until });
    });
  }

  async function authenticate(input: unknown, ip: string) {
    if (typeof input !== "object" || input === null || Array.isArray(input))
      throw new HttpsError("invalid-argument", "Staff ID and password are required.");
    const { staffNumber, password } = input as Record<string, unknown>;
    if (
      typeof staffNumber !== "string" ||
      !staffNumberPattern.test(staffNumber) ||
      typeof password !== "string" ||
      password.length === 0 ||
      password.length > 128
    )
      throw new HttpsError("invalid-argument", "Staff ID and password are required.");
    await consumeLimit(`ip:${ip}`, 50);
    await consumeLimit(`id:${staffNumber}`, 10);
    const ref = firestore.doc(`${credentialCollection}/${staffNumber}`);
    const record = (await ref.get()).data();
    // Missing IDs perform the same password derivation and return the same public error.
    const matches = await verifyStaffPassword(
      password,
      typeof record?.salt === "string" ? record.salt : "0".repeat(64),
      typeof record?.passwordHash === "string" ? record.passwordHash : "0".repeat(128),
    );
    const denied = () => new HttpsError("unauthenticated", "Staff ID or password is incorrect.");
    if (!matches || !record || record.active !== true) throw denied();
    if (
      ![record.academyId, record.staffId, record.userId].every(
        (value) => typeof value === "string" && /^[A-Za-z0-9._:-]+$/u.test(value),
      )
    )
      throw denied();
    const user = await auth.getUser(record.userId).catch(() => null);
    const [canonical, staff] = await Promise.all([
      firestore.doc(`academies/${record.academyId}/users/${record.userId}`).get(),
      firestore.doc(`academies/${record.academyId}/staff/${record.staffId}`).get(),
    ]);
    const profile = canonical.data(),
      role = staff.data();
    if (
      !user ||
      user.disabled ||
      user.customClaims?.academyId !== record.academyId ||
      !["coach", "administrator", "owner"].includes(String(user.customClaims?.role)) ||
      (user.customClaims?.role !== "coach" && profile?.adminRole !== user.customClaims?.role) ||
      profile?.accountType !== "staff" ||
      profile.active !== true ||
      profile.status !== "active" ||
      profile.userId !== record.userId ||
      profile.academyId !== record.academyId ||
      role?.active !== true ||
      role.status !== "active" ||
      role.role !== "coach" ||
      role.staffId !== record.staffId ||
      role.userId !== record.userId ||
      role.academyId !== record.academyId
    )
      throw denied();
    return { ref, record, userId: user.uid };
  }

  return {
    async signIn(input: unknown, ip: string) {
      const { userId } = await authenticate(input, ip);
      return { token: await auth.createCustomToken(userId) };
    },
    async changePassword(input: unknown, ip: string, authenticatedUserId: string) {
      const next = (input as Record<string, unknown> | null)?.newPassword;
      if (typeof next !== "string" || next.length < 12 || next.length > 128)
        throw new HttpsError("invalid-argument", "Use a password of 12 to 128 characters.");
      const { ref, record, userId } = await authenticate(input, ip);
      if (authenticatedUserId !== userId)
        throw new HttpsError("permission-denied", "Account mismatch.");
      const hashed = await hashStaffPassword(next);
      await firestore.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data();
        if (!current || current.passwordHash !== record.passwordHash || current.active !== true)
          throw new HttpsError("aborted", "Account changed. Sign in again.");
        tx.update(ref, { ...hashed, updatedAt: new Date().toISOString() });
      });
      return { changed: true };
    },
  };
}
