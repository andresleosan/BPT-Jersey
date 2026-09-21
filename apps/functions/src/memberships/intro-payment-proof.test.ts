import { describe, expect, it, vi } from "vitest";
import type { R2Client } from "../storage/r2-client";
import { introProofKey, uploadIntroProof, validateIntroProof } from "./intro-payment-proof";

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("synthetic")]);
const storage = () => ({ putObject: vi.fn(), readObject: vi.fn(), deleteObject: vi.fn(), createPdfUploadUrl: vi.fn(), createPdfDownloadUrl: vi.fn() }) as unknown as R2Client;
describe("intro payment proof", () => {
  it("uses an opaque owner namespace and deterministic content hash", async () => {
    const client = storage();
    const first = await uploadIntroProof({ academyId: "academy-1", userId: "user-1", requestId: "00112233-4455-6677-8899-aabbccddeeff", contentType: "image/png", base64: png.toString("base64") }, client);
    const second = await uploadIntroProof({ academyId: "academy-1", userId: "user-1", requestId: "00112233-4455-6677-8899-aabbccddeeff", contentType: "image/png", base64: png.toString("base64") }, client);
    expect(second).toEqual(first);
    expect(introProofKey("academy-1", "user-1", "request-1", first.proofId)).not.toContain("user-1");
    expect(client.putObject).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["image/png", Buffer.from("not png")],
    ["image/jpeg", Buffer.alloc(0)],
    ["image/png", Buffer.alloc(2 * 1024 * 1024 + 1)],
  ] as const)("rejects invalid %s evidence", (contentType, bytes) => {
    expect(() => validateIntroProof(contentType, bytes.toString("base64"))).toThrow(/Choose a .*PNG or JPEG/);
  });
});
