import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ context: vi.fn(), upload: vi.fn(), submit: vi.fn() }));
vi.mock("../../../lib/intro-conversion-client", () => ({ getIntroMembershipContext: api.context, uploadIntroMembershipProof: api.upload, submitIntroMembershipApplication: api.submit }));
import { IntroApplicationForm } from "./intro-application-form";
const conversion = { conversionId: "intro-student-1", academyId: "academy-1", studentId: "student-1", attendanceId: "attendance-1", sessionId: "session-1", recipientUid: "user-1", status: "ready", createdAt: "2026-09-21T12:00:00.000Z", updatedAt: "2026-09-21T12:00:00.000Z", schemaVersion: "1" };
const plan = (planId: "town-adult"|"west-adult", site: "Town"|"West") => ({ planId, displayName: `${site} Adult`, priceMinor: 8500, currency: "GBP", billingPeriod: "monthly", eligibleParticipantTypes: ["adult"], classSites: [site] });
describe("IntroApplicationForm", () => {
  beforeEach(() => { api.context.mockResolvedValue({ conversions: [conversion], applications: [], plans: [plan("town-adult", "Town"), plan("west-adult", "West")], instructions: { accountName: "BPT Jersey", sortCode: "00-00-00", accountNumber: "00000000", bankName: "Synthetic Bank", referenceHint: "MEMBER" } }); api.upload.mockResolvedValue("a".repeat(64)); api.submit.mockResolvedValue({}); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  it("lets the member choose venue and matching subscription", async () => {
    render(<IntroApplicationForm />);
    expect(await screen.findByLabelText("Training centre")).toHaveValue("Town");
    expect(screen.getByLabelText("Membership plan")).toHaveValue("town-adult");
    fireEvent.change(screen.getByLabelText("Training centre"), { target: { value: "West" } });
    await waitFor(() => expect(screen.getByLabelText("Membership plan")).toHaveValue("west-adult"));
  });
  it("uploads the receipt before sending a pending application", async () => {
    render(<IntroApplicationForm />); await screen.findByLabelText("Training centre");
    const file = new File([new Uint8Array([137,80,78,71,13,10,26,10])], "receipt.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Bank transfer reference"), { target: { value: "INTRO-33" } });
    fireEvent.change(screen.getByLabelText("Payment screenshot or receipt"), { target: { files: [file] } });
    fireEvent.submit(screen.getByRole("button", { name: "Send for approval" }).closest("form")!);
    await waitFor(() => expect(api.upload).toHaveBeenCalledWith(expect.any(String), file));
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith(expect.objectContaining({ site: "Town", planId: "town-adult", bankReference: "INTRO-33" })));
    expect(await screen.findByText("Membership pending office approval.")).toBeVisible();
  });
});
