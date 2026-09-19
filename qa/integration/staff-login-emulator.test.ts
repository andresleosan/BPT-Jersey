import { randomUUID } from "node:crypto";
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, deleteApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  linkWithCredential,
  signInWithCredential,
  signInWithCustomToken,
  signOut,
} from "firebase/auth";
import { expect, it } from "vitest";
import {
  createStaffLoginService,
  hashStaffPassword,
} from "../../apps/functions/src/staff/staff-login-service.js";

it("preserves one coach identity when linking Google and signing in with either method", async () => {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Local emulators required");
  const projectId = "demo-bpt-jersey";
  const uid = `coach-${randomUUID()}`;
  const academyId = `academy-${randomUUID()}`;
  const admin = initializeAdmin({ projectId }, uid);
  const db = getFirestore(admin);
  const adminAuth = getAdminAuth(admin);
  const client = initializeApp({ projectId, apiKey: "demo-key" }, uid);
  const auth = getAuth(client);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {
    disableWarnings: true,
  });
  const staffNumber = String(100000 + Math.floor(Math.random() * 900000));
  const password = randomUUID();
  const refs = [
    db.doc(`staffLoginCredentials/${staffNumber}`),
    db.doc(`academies/${academyId}/users/${uid}`),
    db.doc(`academies/${academyId}/staff/${uid}`),
  ];
  try {
    await adminAuth.createUser({ uid });
    await adminAuth.setCustomUserClaims(uid, { academyId, role: "coach" });
    const common = { userId: uid, academyId, active: true, status: "active" };
    await refs[0]!.create({ ...common, staffId: uid, ...(await hashStaffPassword(password)) });
    await refs[1]!.create({ ...common, accountType: "staff" });
    await refs[2]!.create({ ...common, staffId: uid, role: "coach" });
    const service = createStaffLoginService(db, adminAuth);
    const first = await service.signIn({ staffNumber, password }, "emulator-ip");
    const signedIn = await signInWithCustomToken(auth, first.token);
    expect(signedIn.user.uid).toBe(uid);
    const google = GoogleAuthProvider.credential(
      JSON.stringify({ sub: uid, email: `${uid}@example.test`, email_verified: true }),
    );
    await linkWithCredential(signedIn.user, google);
    await signOut(auth);
    const googleSignIn = await signInWithCredential(auth, google);
    expect(googleSignIn.user.uid).toBe(uid);
    expect((await googleSignIn.user.getIdTokenResult()).claims.role).toBe("coach");
    await signOut(auth);
    const next = await service.signIn({ staffNumber, password }, "emulator-ip");
    const numeric = await signInWithCustomToken(auth, next.token);
    expect(numeric.user.uid).toBe(uid);
    expect(numeric.user.providerData.some((row) => row.providerId === "google.com")).toBe(true);
    await adminAuth.updateUser(uid, { disabled: true });
    await expect(service.signIn({ staffNumber, password }, "emulator-ip")).rejects.toMatchObject({
      code: "unauthenticated",
    });
  } finally {
    await Promise.all(refs.map((ref) => ref.delete()));
    await adminAuth.deleteUser(uid);
    await deleteApp(client);
    await deleteAdmin(admin);
  }
}, 30000);
