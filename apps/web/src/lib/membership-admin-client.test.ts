import { describe, expect, it, vi } from "vitest";

const callable = vi.hoisted(() => vi.fn());
vi.mock("firebase/functions", () => ({ httpsCallable: () => callable }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import { getRegistrationChoice } from "./membership-admin-client";

describe("getRegistrationChoice", () => {
  it("asks about one student and one class and returns the server's choice", async () => {
    callable.mockResolvedValueOnce({
      data: { studentId: "st1", choice: { kind: "intro" }, reason: null },
    });

    await expect(getRegistrationChoice("s1", "st1")).resolves.toEqual({
      studentId: "st1",
      choice: { kind: "intro" },
      reason: null,
    });
    expect(callable).toHaveBeenCalledWith({ sessionId: "s1", studentId: "st1" });
  });

  it("turns a refused office session into safe copy, never the server's own text", async () => {
    callable.mockRejectedValueOnce(
      Object.assign(new Error("Administrator access is required."), {
        code: "functions/permission-denied",
      }),
    );

    await expect(getRegistrationChoice("s1", "st1")).rejects.toThrow(
      "An active administrator session is required. Sign in again and reopen this class.",
    );
  });

  it("refuses an answer that both books and refuses", async () => {
    callable.mockResolvedValueOnce({
      data: { studentId: "st1", choice: { kind: "intro" }, reason: "no-plan" },
    });

    await expect(getRegistrationChoice("s1", "st1")).rejects.toThrow(
      "Unable to check this member's membership. Please try again.",
    );
  });
});
