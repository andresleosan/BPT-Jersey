import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";
import { createEmulatorR2Client } from "../storage/r2-client.js";
import {
  enrolmentProofKey,
  uploadEnrolmentPaymentProofHandler,
} from "./enrolment-payment-proof.js";
type Doc = Record<string, unknown>;
// The upload checks the live Auth session and reserves the proof in Firestore before writing R2.
const live = vi.hoisted(() => ({
  users: new Map<string, Record<string, unknown>>(),
  docs: new Map<string, Record<string, unknown>>(),
}));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUser: async (uid: string) => live.users.get(uid) }),
}));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    doc: (path: string) => ({ path }),
    // Like Firestore: reads see committed documents, writes land together when the callback resolves.
    runTransaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => {
      const staged = new Map<string, Doc>();
      const result = await run({
        get: async ({ path }: { path: string }) => {
          const data = live.docs.get(path);
          return { exists: data !== undefined, data: () => structuredClone(data) };
        },
        set: ({ path }: { path: string }, data: Doc) => staged.set(path, structuredClone(data)),
        // Updates need an existing document; dotted keys are nested field paths.
        update: ({ path }: { path: string }, fields: Doc) => {
          const doc = structuredClone(staged.get(path) ?? live.docs.get(path));
          if (!doc) throw new Error(`No document to update: ${path}`);
          for (const [fieldPath, value] of Object.entries(fields)) {
            const keys = fieldPath.split(".");
            const leaf = keys.pop()!;
            let target = doc;
            for (const key of keys) target = (target[key] ??= {}) as Doc;
            target[leaf] = value;
          }
          staged.set(path, doc);
        },
      });
      for (const [path, data] of staged) live.docs.set(path, data);
      return result;
    },
  }),
}));
const requestId = "6f1d2f66-6f4f-4a2e-9a0e-2b6f0a4a1c11";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
function request(data: unknown, role = "shopper", app = true): CallableRequest {
  // The upload re-reads the caller from Auth; register the matching live account.
  live.users.set("applicant", {
    uid: "applicant",
    disabled: false,
    customClaims: { academyId: "academy-1", role },
    tokensValidAfterTime: "2020-01-01T00:00:00.000Z",
  });
  return {
    data,
    auth: { uid: "applicant", token: { academyId: "academy-1", role, auth_time: 1_700_000_000 } },
    ...(app ? { app: { appId: "test" } } : {}),
  } as unknown as CallableRequest;
}
const payload = { requestId, contentType: "image/png", base64: png.toString("base64") };
describe("private enrolment screenshots", () => {
  beforeEach(() => live.docs.clear());
  it("stores identical retries under one immutable account/request-bound key", async () => {
    const objects = new Map<string, Uint8Array>();
    const storage = createEmulatorR2Client(objects);
    const result = await uploadEnrolmentPaymentProofHandler(request(payload), storage);
    expect(await uploadEnrolmentPaymentProofHandler(request(payload), storage)).toEqual(result);
    expect(objects.size).toBe(1);
    expect(
      await storage.readObject(
        enrolmentProofKey("academy-1", "applicant", requestId, result.proofId),
      ),
    ).toEqual(new Uint8Array(png));
    await expect(
      storage.readObject(enrolmentProofKey("academy-1", "other", requestId, result.proofId)),
    ).rejects.toThrow();
  });
  it.each([
    { ...payload, contentType: "text/html" },
    { ...payload, base64: Buffer.from("<script>alert(1)</script>").toString("base64") },
    { ...payload, base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64") },
    { ...payload, requestId: "../outside" },
  ])("rejects invalid content or paths", async (data) => {
    await expect(
      uploadEnrolmentPaymentProofHandler(request(data), createEmulatorR2Client()),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
  it("rejects unverified applications and staff", async () => {
    await expect(
      uploadEnrolmentPaymentProofHandler(
        request(payload, "shopper", false),
        createEmulatorR2Client(),
      ),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(
      uploadEnrolmentPaymentProofHandler(request(payload, "coach"), createEmulatorR2Client()),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});
