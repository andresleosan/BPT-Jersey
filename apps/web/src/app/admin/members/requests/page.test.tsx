import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enrolmentApi = vi.hoisted(() => ({
  listEnrolmentRequests: vi.fn(),
  returnEnrolmentRequest: vi.fn(),
  getEnrolmentRequestDetail: vi.fn(),
  approveEnrolmentRequest: vi.fn(),
}));

vi.mock("../../../../lib/enrolment-client", () => enrolmentApi);

import EnrolmentRequestQueuePage from "./page";

const waiting = {
  enrolmentRequestId: "enrolment-1",
  applicantName: "Alex Adult",
  applicantIsStudent: true,
  minorCount: 0,
  trainingCenter: "Town" as const,
  status: "submitted" as const,
  submittedAt: "2026-09-06T10:00:00.000Z",
};
const guardian = {
  ...waiting,
  enrolmentRequestId: "enrolment-2",
  applicantName: "Robin Guardian",
  applicantIsStudent: false,
  minorCount: 2,
  trainingCenter: "West" as const,
};

const detail = {
  enrolmentRequestId: "enrolment-1",
  status: "submitted" as const,
  applicantIsStudent: true,
  applicant: {
    fullName: "Alex Adult",
    dateOfBirth: "1991-03-04",
    phoneNumber: "+441534000122",
    trainingCenter: "Town" as const,
    trainingTimePreferences: ["evening"] as const,
    emergencyContact: {
      fullName: "Sam Contact",
      relationship: "Sister",
      phoneNumber: "+441534000999",
    },
    postalAddress: { line: "2 Synthetic Lane", postCode: "JE2 4XY" },
  },
  minors: [],
  submittedBy: "client-1",
  submittedAt: "2026-09-06T10:00:00.000Z",
};

/** The first matching button, asserted to exist so the queries stay readable under strict index checks. */
function firstButton(name: RegExp): HTMLElement {
  const [button] = screen.getAllByRole("button", { name });
  if (!button) throw new Error(`No button matched ${String(name)}`);
  return button;
}

beforeEach(() => {
  enrolmentApi.listEnrolmentRequests.mockResolvedValue({
    requests: [waiting, guardian],
    truncated: false,
  });
  enrolmentApi.returnEnrolmentRequest.mockResolvedValue({ ...waiting, status: "returned" });
  enrolmentApi.getEnrolmentRequestDetail.mockResolvedValue(detail);
  enrolmentApi.approveEnrolmentRequest.mockResolvedValue({
    enrolmentRequestId: "enrolment-1",
    role: "adultStudent",
    studentIds: ["student-1"],
    alreadyApproved: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("enrolment request queue", () => {
  it("lists who is waiting without exposing their confidential detail", async () => {
    render(<EnrolmentRequestQueuePage />);

    expect(await screen.findByText("Alex Adult")).toBeVisible();
    expect(screen.getByText(/Adult student · Town · sent 06\/09\/2026/)).toBeVisible();
    expect(screen.getByText(/Parent or guardian · 2 children · West/)).toBeVisible();
    const queue = screen.getByRole("list", { name: /enrolment requests/i });
    expect(queue.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("refuses to send a request back with an empty note", async () => {
    const user = userEvent.setup();
    render(<EnrolmentRequestQueuePage />);

    await user.click((await screen.findAllByRole("button", { name: /send back/i }))[0]!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Write what the applicant needs to change.",
    );
    expect(enrolmentApi.returnEnrolmentRequest).not.toHaveBeenCalled();
  });

  it("sends a request back with the note office wrote", async () => {
    const user = userEvent.setup();
    render(<EnrolmentRequestQueuePage />);

    const note = (await screen.findAllByLabelText(/what needs to change/i))[0]!;
    await user.type(note, "Add a phone number.");
    await user.click(firstButton(/send back/i)!);

    await waitFor(() =>
      expect(enrolmentApi.returnEnrolmentRequest).toHaveBeenCalledWith(
        "enrolment-1",
        "Add a phone number.",
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Sent back to Alex Adult.");
  });

  it("drops the action once a request is resolved", async () => {
    enrolmentApi.listEnrolmentRequests.mockResolvedValue({
      requests: [{ ...waiting, status: "approved" as const }],
      truncated: false,
    });

    render(<EnrolmentRequestQueuePage />);

    expect(await screen.findByText("Alex Adult")).toBeVisible();
    expect(screen.queryByRole("button", { name: /send back/i })).not.toBeInTheDocument();
  });

  it("offers a retry when the queue cannot be read", async () => {
    enrolmentApi.listEnrolmentRequests.mockRejectedValueOnce(new Error("offline"));

    render(<EnrolmentRequestQueuePage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /retry/i }));

    await waitFor(() => expect(enrolmentApi.listEnrolmentRequests).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Alex Adult")).toBeVisible();
  });

  it("says when the page is full instead of implying it is the whole queue", async () => {
    enrolmentApi.listEnrolmentRequests.mockResolvedValue({
      requests: [waiting],
      truncated: true,
    });

    render(<EnrolmentRequestQueuePage />);

    // The loading panel also carries role="status", so match the sentence, not the role.
    expect(await screen.findByText(/older requests are not shown/i)).toBeVisible();
  });

  it("says so when nobody has applied yet", async () => {
    enrolmentApi.listEnrolmentRequests.mockResolvedValue({ requests: [], truncated: false });

    render(<EnrolmentRequestQueuePage />);

    expect(await screen.findByText(/No enrolment requests yet/i)).toBeVisible();
  });

  it("keeps enrolling out of reach until the reviewer has actually read the request", async () => {
    // The gap this slice closes: office could approve somebody while looking at a name and a
    // centre, without ever seeing the date of birth or the emergency contact it was approving.
    render(<EnrolmentRequestQueuePage />);
    await screen.findByText("Alex Adult");

    const approve = firstButton(/approve and enrol/i);
    expect(approve).toBeDisabled();

    await userEvent.click(firstButton(/read the full request/i));

    await waitFor(() => expect(approve).toBeEnabled());
    expect(enrolmentApi.getEnrolmentRequestDetail).toHaveBeenCalledWith("enrolment-1");
  });

  it("shows the confidential detail only for the request the reviewer opened", async () => {
    render(<EnrolmentRequestQueuePage />);
    await screen.findByText("Alex Adult");

    await userEvent.click(firstButton(/read the full request/i));

    expect(await screen.findByText(/1991-03-04/)).toBeVisible();
    expect(screen.getByText(/Sam Contact/)).toBeVisible();
    expect(screen.getByText(/2 Synthetic Lane/)).toBeVisible();
    // Only one request was opened, so only one detail was ever fetched.
    expect(enrolmentApi.getEnrolmentRequestDetail).toHaveBeenCalledTimes(1);
  });

  it("does not spend a second audited read when a panel is reopened", async () => {
    // Every detail read is audited and counted against the reviewer's restricted budget, so
    // toggling a panel twice must not cost twice.
    render(<EnrolmentRequestQueuePage />);
    await screen.findByText("Alex Adult");
    const toggle = () => firstButton(/read the full request|hide detail/i);

    await userEvent.click(toggle());
    await screen.findByText(/1991-03-04/);
    await userEvent.click(toggle());
    await userEvent.click(toggle());

    await screen.findByText(/1991-03-04/);
    expect(enrolmentApi.getEnrolmentRequestDetail).toHaveBeenCalledTimes(1);
  });

  it("enrols the applicant and says what happened", async () => {
    render(<EnrolmentRequestQueuePage />);
    await screen.findByText("Alex Adult");
    await userEvent.click(firstButton(/read the full request/i));
    await waitFor(() => expect(firstButton(/approve and enrol/i)).toBeEnabled());

    await userEvent.click(firstButton(/approve and enrol/i));

    expect(await screen.findByText(/Alex Adult is enrolled and can now sign in/i)).toBeVisible();
    expect(enrolmentApi.approveEnrolmentRequest).toHaveBeenCalledWith("enrolment-1");
    // The approval touched the directory and the account, so the queue is re-read rather than
    // patched from what was asked for.
    expect(enrolmentApi.listEnrolmentRequests).toHaveBeenCalledTimes(2);
  });

  it("tells the reviewer why an approval stopped instead of a generic failure", async () => {
    enrolmentApi.approveEnrolmentRequest.mockRejectedValue(
      new Error("applicant_account_incomplete: The applicant account has no name or no email"),
    );
    render(<EnrolmentRequestQueuePage />);
    await screen.findByText("Alex Adult");
    await userEvent.click(firstButton(/read the full request/i));
    await waitFor(() => expect(firstButton(/approve and enrol/i)).toBeEnabled());

    await userEvent.click(firstButton(/approve and enrol/i));

    expect(await screen.findByText(/applicant_account_incomplete/)).toBeVisible();
  });
});
