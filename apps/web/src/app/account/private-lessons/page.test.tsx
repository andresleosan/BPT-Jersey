import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  status: "signed-in" as const,
  session: { uid: "user-1", role: "adultStudent", displayName: "Synthetic Adult" },
}));
const api = vi.hoisted(() => ({
  listMyProfiles: vi.fn(),
  getClientProfile: vi.fn(),
  getFamily: vi.fn(),
  listMyPrivateLessons: vi.fn(),
  submitPrivateLessonPurchase: vi.fn(),
  uploadIntroMembershipProof: vi.fn(),
  getEnrolmentPaymentInstructions: vi.fn(),
}));

vi.mock("../../../lib/client-auth", () => ({
  ClientAuthGate: ({ children }: { children: React.ReactNode }) => children,
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useClientSession: () => authState,
}));
vi.mock("../../../lib/family-plan-client", () => ({ listMyProfiles: api.listMyProfiles }));
vi.mock("../../../lib/profile-client", () => ({ getClientProfile: api.getClientProfile }));
vi.mock("../../../lib/family-client", () => ({ getFamily: api.getFamily }));
vi.mock("../../../lib/private-lesson-client", () => ({
  listMyPrivateLessons: api.listMyPrivateLessons,
  submitPrivateLessonPurchase: api.submitPrivateLessonPurchase,
}));
vi.mock("../../../lib/intro-conversion-client", () => ({
  uploadIntroMembershipProof: api.uploadIntroMembershipProof,
}));
vi.mock("../../../lib/enrolment-client", () => ({
  getEnrolmentPaymentInstructions: api.getEnrolmentPaymentInstructions,
}));

import PrivateLessonsPage from "./page";

function isoYearsAgo(years: number, dayShift = 0): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() + dayShift);
  return date.toISOString().slice(0, 10);
}

function member(dateOfBirth: string) {
  api.listMyProfiles.mockResolvedValue([
    {
      studentId: "student-1",
      fullName: "Synthetic Adult",
      via: "self",
      trainingDetailsRequired: false,
    },
  ]);
  api.getClientProfile.mockResolvedValue({
    student: { studentId: "student-1", fullName: "Synthetic Adult", dateOfBirth },
  });
  api.getEnrolmentPaymentInstructions.mockResolvedValue(null);
  api.listMyPrivateLessons.mockResolvedValue({
    purchases: [],
    creditsAvailable: 3,
    nextExpiry: "2027-02-28T09:00:00.000Z",
  });
}

describe("member private lessons page", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("offers the three options and sends the choice without a price", async () => {
    member(isoYearsAgo(16));
    api.uploadIntroMembershipProof.mockResolvedValue("a".repeat(64));
    api.submitPrivateLessonPurchase.mockResolvedValue({ purchaseId: "p1", status: "pending" });
    render(<PrivateLessonsPage />);

    expect(await screen.findByText("£65.00")).toBeTruthy();
    expect(screen.getByText("£200.00 a month")).toBeTruthy();
    expect(screen.getByText("£500.00")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /Private lessons pack of 10/u }));
    fireEvent.change(screen.getByLabelText("Transfer reference"), { target: { value: "BPT 77" } });
    const file = new File(["png"], "proof.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Transfer screenshot"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the academy" }));

    await waitFor(() => expect(api.submitPrivateLessonPurchase).toHaveBeenCalledTimes(1));
    const payload = api.submitPrivateLessonPurchase.mock.calls[0]![0];
    expect(payload).toEqual({
      requestId: expect.any(String),
      studentId: "student-1",
      optionId: "pack-10",
      proofId: "a".repeat(64),
      bankReference: "BPT 77",
    });
    expect(payload).not.toHaveProperty("priceMinor");
    expect(api.uploadIntroMembershipProof).toHaveBeenCalledWith(payload.requestId, file);
  });

  it("explains the age limit to a member under 16 and shows no form", async () => {
    member(isoYearsAgo(16, 1));
    render(<PrivateLessonsPage />);
    expect(
      await screen.findByText("Private lessons are for members aged 16 or over."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send to the academy" })).toBeNull();
    expect(screen.queryByText("£65.00")).toBeNull();
    expect(api.listMyPrivateLessons).not.toHaveBeenCalled();
  });

  it("shows the credits left and when the next ones expire", async () => {
    member(isoYearsAgo(30));
    render(<PrivateLessonsPage />);
    expect(await screen.findByText("3 private lessons available")).toBeTruthy();
    expect(screen.getByText("Expires 28 Feb 2027")).toBeTruthy();
  });
});
