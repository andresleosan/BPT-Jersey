import { describe, expect, it } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";
import { createEmulatorR2Client } from "../storage/r2-client.js";
import {
  enrolmentProofKey,
  uploadEnrolmentPaymentProofHandler,
} from "./enrolment-payment-proof.js";
const requestId = "6f1d2f66-6f4f-4a2e-9a0e-2b6f0a4a1c11";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
function request(data: unknown, role = "shopper", app = true): CallableRequest {
  return {
    data,
    auth: { uid: "applicant", token: { academyId: "academy-1", role } },
    ...(app ? { app: { appId: "test" } } : {}),
  } as unknown as CallableRequest;
}
const payload = { requestId, contentType: "image/png", base64: png.toString("base64") };
describe("private enrolment screenshots", () => {
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
