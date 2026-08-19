import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  GoogleAuthProvider,
  inMemoryPersistence,
  setPersistence,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runId = `${process.pid}-${randomUUID()}`;
const app = initializeApp(
  {
    apiKey: "demo-api-key",
    authDomain: "demo-bpt-jersey.firebaseapp.com",
    projectId: "demo-bpt-jersey",
  },
  `auth-emulator-${runId}`,
);
const auth = getAuth(app);

connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });

async function removeCurrentUser(): Promise<void> {
  if (auth.currentUser) {
    await deleteUser(auth.currentUser);
  }
}

beforeAll(async () => {
  await setPersistence(auth, inMemoryPersistence);
});

afterAll(async () => {
  await removeCurrentUser();
  await deleteApp(app);
});

describe("Firebase Auth contracts against the local emulator", () => {
  it("creates and signs in an email/password identity", async () => {
    const email = `email-${runId}@example.test`;
    const password = "synthetic-password-014";

    try {
      const created = await createUserWithEmailAndPassword(auth, email, password);
      const createdUid = created.user.uid;

      await signOut(auth);
      const signedIn = await signInWithEmailAndPassword(auth, email, password);

      expect(signedIn.user.uid).toBe(createdUid);
      expect(signedIn.user.email).toBe(email);
      expect(signedIn.user.providerData.map(({ providerId }) => providerId)).toEqual(["password"]);
    } finally {
      await removeCurrentUser();
    }
  });

  it("creates and signs in a Google identity from a synthetic emulator token", async () => {
    const email = `google-${runId}@example.test`;
    const idToken = JSON.stringify({
      sub: `google-${runId}`,
      email,
      email_verified: true,
    });

    try {
      const signedIn = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));

      expect(signedIn.user.email).toBe(email);
      expect(signedIn.user.providerData.map(({ providerId }) => providerId)).toEqual([
        "google.com",
      ]);
    } finally {
      await removeCurrentUser();
    }
  });
});
