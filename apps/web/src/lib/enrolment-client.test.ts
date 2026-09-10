import { afterEach, describe, expect, it, vi } from "vitest";

const functionsBoundary = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: (...args: readonly unknown[]) => {
    functionsBoundary.httpsCallable(...args);
    return functionsBoundary.callable;
  },
}));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import { approveEnrolmentRequest, getEnrolmentRequestDetail } from "./enrolment-client";

/** A rejection shaped like the one the Firebase SDK raises for a callable that answered 403. */
function callableError(code: string, message = "") {
  return Object.assign(new Error(message), { code, message });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("the office half of the enrolment client", () => {
  it("says a reviewer is not provisioned instead of hiding it behind 'unable to open'", async () => {
    // Production, 2026-09-08: the queue loaded and every row refused with permission-denied,
    // because the administrator's account carried the claim but no provisioned staff document.
    // Collapsing that into one blank sentence is what made a 403 look like three dead buttons.
    functionsBoundary.callable.mockRejectedValue(
      callableError("functions/permission-denied", "An active administrative account is required"),
    );

    await expect(getEnrolmentRequestDetail("enrolment-1")).rejects.toThrow(/not fully provisioned/);
    await expect(approveEnrolmentRequest("enrolment-1")).rejects.toThrow(/ask an owner/i);
  });

  it("tells a reviewer they have spent the restricted read budget, not that the page is broken", async () => {
    functionsBoundary.callable.mockRejectedValue(
      callableError("functions/resource-exhausted", "Restricted read rate limit exceeded"),
    );

    await expect(getEnrolmentRequestDetail("enrolment-1")).rejects.toThrow(/too many confidential/i);
  });

  it("keeps the safe sentence for a failure the reviewer can do nothing with", async () => {
    functionsBoundary.callable.mockRejectedValue(callableError("functions/internal", "boom"));

    await expect(getEnrolmentRequestDetail("enrolment-1")).rejects.toThrow(
      "Unable to open this request.",
    );
    await expect(approveEnrolmentRequest("enrolment-1")).rejects.toThrow(
      "Unable to approve this request.",
    );
  });

  it("still lets an approval that stopped carry its own reason to the reviewer", async () => {
    functionsBoundary.callable.mockRejectedValue(
      callableError("functions/failed-precondition", "waiver-missing: the waiver was not accepted"),
    );

    await expect(approveEnrolmentRequest("enrolment-1")).rejects.toThrow("waiver-missing");
  });

  it("does not leak a malformed payload as if it were a permission problem", async () => {
    functionsBoundary.callable.mockResolvedValue({ data: { enrolmentRequestId: 7 } });

    await expect(getEnrolmentRequestDetail("enrolment-1")).rejects.toThrow(
      "Unable to open this request.",
    );
  });
});
