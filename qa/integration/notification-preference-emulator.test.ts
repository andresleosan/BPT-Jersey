import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import { createSaveNotificationPreferenceHandler } from "../../apps/functions/src/delivery/notification-preference-callables.js";
import {
  createFirestoreNotificationPreferenceStore,
  type GenericNotificationPreferenceFirestore,
} from "../../apps/functions/src/delivery/notification-preference-service.js";

const runId = `notification-preferences-${process.pid}-${randomUUID().slice(0, 8)}`;
const academyA = `${runId}-academy-a`;
const academyB = `${runId}-academy-b`;
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();

function isLocalEmulatorHost(host: string | undefined): boolean {
  if (host === undefined || host === "") return false;
  try {
    const url = new URL(`http://${host}`);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]") &&
      url.pathname === "/" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

const useLocalEmulator = isLocalEmulatorHost(firestoreEmulatorHost);
if (!useLocalEmulator) {
  console.warn(
    "SKIP notification preference emulator integration: FIRESTORE_EMULATOR_HOST must be a local emulator host",
  );
}

const app = useLocalEmulator ? initializeApp({ projectId: "demo-bpt-jersey" }, runId) : undefined;
const firestore = app === undefined ? undefined : getFirestore(app);
const store =
  firestore === undefined
    ? undefined
    : createFirestoreNotificationPreferenceStore({
        firestore: firestore as unknown as GenericNotificationPreferenceFirestore,
      });

function request(
  data: unknown,
  academyId: string,
  role: string,
): Parameters<ReturnType<typeof createSaveNotificationPreferenceHandler>>[0] {
  return {
    data,
    rawRequest: {},
    auth: { uid: `${role}-synthetic`, token: { academyId, role } },
  } as unknown as Parameters<ReturnType<typeof createSaveNotificationPreferenceHandler>>[0];
}

function requireStore() {
  if (store === undefined || firestore === undefined) {
    throw new Error("Local Firestore emulator is unavailable");
  }
  return { store, firestore };
}

afterAll(async () => {
  if (app !== undefined) await deleteApp(app);
});

describe("notification preferences against the Firestore emulator", () => {
  it("persists an authenticated owner preference, upserts it, and isolates tenants", async () => {
    if (!useLocalEmulator) return;
    const current = requireStore();
    const save = createSaveNotificationPreferenceHandler({
      store: current.store,
      now: () => "2026-09-01T12:00:00.000Z",
    });

    const first = await save(
      request(
        {
          audienceId: "audience-family-a",
          purpose: "class_reminder",
          channel: "email",
          enabled: true,
          consentState: "granted",
        },
        academyA,
        "owner",
      ),
    );
    expect(first).toMatchObject({
      preference: {
        academyId: academyA,
        audienceId: "audience-family-a",
        purpose: "class_reminder",
        channel: "email",
        enabled: true,
        consentState: "granted",
        updatedAt: "2026-09-01T12:00:00.000Z",
      },
    });

    const preference = (first as { preference: { preferenceId: string } }).preference;
    const persisted = await current.firestore
      .doc(`academies/${academyA}/notificationPreferences/${preference.preferenceId}`)
      .get();
    expect(persisted.data()).toEqual((first as { preference: unknown }).preference);
    const firstAudit = await current.firestore
      .collection(`academies/${academyA}/auditEvents`)
      .get();
    expect(firstAudit.docs).toHaveLength(1);
    expect(firstAudit.docs[0]?.data()).toMatchObject({
      academyId: academyA,
      actorId: "owner-synthetic",
      action: "notification.preference.updated",
      targetRef: `academies/${academyA}/notificationPreferences/${preference.preferenceId}`,
      purpose: "notification preference administration",
      correlationId: `notification-preference:${preference.preferenceId}`,
      result: "completed",
      schemaVersion: 1,
      auditEventId: expect.any(String),
      occurredAt: expect.anything(),
    });

    const update = await createSaveNotificationPreferenceHandler({
      store: current.store,
      now: () => "2026-09-01T13:00:00.000Z",
    })(
      request(
        {
          audienceId: "audience-family-a",
          purpose: "class_reminder",
          channel: "email",
          enabled: false,
          consentState: "withdrawn",
        },
        academyA,
        "administrator",
      ),
    );
    expect(update).toMatchObject({
      preference: {
        preferenceId: preference.preferenceId,
        enabled: false,
        consentState: "withdrawn",
        updatedAt: "2026-09-01T13:00:00.000Z",
      },
    });

    const listed = await current.store.listPreferences(academyA, "audience-family-a");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      preferenceId: preference.preferenceId,
      enabled: false,
      consentState: "withdrawn",
    });
    expect(await current.store.listPreferences(academyB, "audience-family-a")).toEqual([]);
    const allAudits = await current.firestore.collection(`academies/${academyA}/auditEvents`).get();
    expect(allAudits.docs).toHaveLength(2);
    expect(allAudits.docs.map((document) => document.data())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: "administrator-synthetic",
          action: "notification.preference.updated",
          targetRef: `academies/${academyA}/notificationPreferences/${preference.preferenceId}`,
          result: "completed",
          schemaVersion: 1,
        }),
      ]),
    );
  });
});
