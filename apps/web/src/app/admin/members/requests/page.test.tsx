import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enrolmentApi = vi.hoisted(() => ({
  listEnrolmentRequests: vi.fn(),
  returnEnrolmentRequest: vi.fn(),
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

beforeEach(() => {
  enrolmentApi.listEnrolmentRequests.mockResolvedValue({
    requests: [waiting, guardian],
    truncated: false,
  });
  enrolmentApi.returnEnrolmentRequest.mockResolvedValue({ ...waiting, status: "returned" });
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
    await user.click(screen.getAllByRole("button", { name: /send back/i })[0]!);

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
});
