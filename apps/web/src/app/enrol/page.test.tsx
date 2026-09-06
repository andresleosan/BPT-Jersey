import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  status: "signed-in" as "signed-in" | "signed-out" | "loading",
  session: undefined as
    | {
        uid: string;
        email: string;
        displayName: string;
        role?: "guardian" | "adultStudent" | "shopper";
      }
    | undefined,
  signOut: vi.fn(),
}));

const enrolmentApi = vi.hoisted(() => ({
  createEnrolmentRequestId: vi.fn(() => "6f1d2f66-6f4f-4a2e-9a0e-2b6f0a4a1c11"),
  listMyEnrolmentRequests: vi.fn(),
  submitEnrolmentRequest: vi.fn(),
  withdrawEnrolmentRequest: vi.fn(),
}));

vi.mock("../../lib/client-auth", () => ({
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useClientSession: () => authState,
}));
vi.mock("../../lib/enrolment-client", () => enrolmentApi);

import EnrolPage from "./page";

const buyer = {
  uid: "buyer-1",
  email: "alex@example.test",
  displayName: "Alex Adult",
  role: "shopper" as const,
};

beforeEach(() => {
  authState.status = "signed-in";
  authState.session = buyer;
  enrolmentApi.listMyEnrolmentRequests.mockResolvedValue([]);
  enrolmentApi.submitEnrolmentRequest.mockResolvedValue({
    enrolmentRequestId: "enrolment-1",
    status: "submitted",
    submittedAt: "2026-09-06T10:00:00.000Z",
  });
  enrolmentApi.withdrawEnrolmentRequest.mockResolvedValue({
    enrolmentRequestId: "enrolment-1",
    status: "withdrawn",
    submittedAt: "2026-09-06T10:00:00.000Z",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("enrolment request page", () => {
  it("asks a visitor to sign in before applying", async () => {
    authState.status = "signed-out";
    authState.session = undefined;

    render(<EnrolPage />);

    expect(screen.getByRole("link", { name: /sign in to apply/i })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fenrol",
    );
    expect(enrolmentApi.listMyEnrolmentRequests).not.toHaveBeenCalled();
  });

  it("sends an existing student to their account instead of a second enrolment", async () => {
    authState.session = { ...buyer, role: "adultStudent" };

    render(<EnrolPage />);

    expect(screen.getByRole("heading", { name: /already enrolled/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /send request/i })).not.toBeInTheDocument();
    expect(enrolmentApi.listMyEnrolmentRequests).not.toHaveBeenCalled();
  });

  it("submits an adult applying for themselves without empty optional fields", async () => {
    const user = userEvent.setup();
    render(<EnrolPage />);

    await waitFor(() => expect(screen.getByLabelText("Full name")).toBeVisible());
    await user.type(screen.getByLabelText("Date of birth"), "1994-04-02");
    await user.click(screen.getByLabelText("Evening"));
    await user.click(screen.getByRole("button", { name: /send request to the academy/i }));

    await waitFor(() => expect(enrolmentApi.submitEnrolmentRequest).toHaveBeenCalledOnce());
    const submission = enrolmentApi.submitEnrolmentRequest.mock.calls[0]?.[0];
    expect(submission).toMatchObject({
      requestId: "6f1d2f66-6f4f-4a2e-9a0e-2b6f0a4a1c11",
      applicantIsStudent: true,
      applicant: {
        fullName: "Alex Adult",
        dateOfBirth: "1994-04-02",
        email: "alex@example.test",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
      },
      minors: [],
    });
    expect(submission.applicant).not.toHaveProperty("phoneNumber");
    expect(submission.applicant).not.toHaveProperty("emergencyContact");
    expect(submission.applicant).not.toHaveProperty("postalAddress");
    expect(submission.applicant).not.toHaveProperty("membershipNumber");
  });

  it("refuses to send a guardian request with no child on it", async () => {
    const user = userEvent.setup();
    render(<EnrolPage />);

    await waitFor(() => expect(screen.getByLabelText("Full name")).toBeVisible());
    await user.type(screen.getByLabelText("Date of birth"), "1994-04-02");
    await user.click(screen.getByLabelText(/parent or guardian/i));
    await user.click(screen.getByRole("button", { name: /send request to the academy/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Add the child you are enrolling.");
    expect(enrolmentApi.submitEnrolmentRequest).not.toHaveBeenCalled();
  });

  it("carries a guardian and their child in one request", async () => {
    const user = userEvent.setup();
    render(<EnrolPage />);

    await waitFor(() => expect(screen.getByLabelText("Full name")).toBeVisible());
    await user.type(screen.getByLabelText("Date of birth"), "1990-01-01");
    await user.click(screen.getByLabelText(/parent or guardian/i));
    await user.click(screen.getByRole("button", { name: /add a child/i }));
    await user.type(
      screen.getByLabelText("Full name", { selector: "#enrol-minor-0-name" }),
      "Robin Minor",
    );
    await user.type(
      screen.getByLabelText("Date of birth", { selector: "#enrol-minor-0-dob" }),
      "2016-05-10",
    );
    await user.click(screen.getByLabelText("Afternoon", { selector: "#enrol-minor-0-afternoon" }));
    await user.click(screen.getByRole("button", { name: /send request to the academy/i }));

    await waitFor(() => expect(enrolmentApi.submitEnrolmentRequest).toHaveBeenCalledOnce());
    expect(enrolmentApi.submitEnrolmentRequest.mock.calls[0]?.[0]).toMatchObject({
      applicantIsStudent: false,
      minors: [
        {
          fullName: "Robin Minor",
          dateOfBirth: "2016-05-10",
          trainingCenter: "Town",
          trainingTimePreferences: ["afternoon"],
        },
      ],
    });
  });

  it("shows an open request instead of the form, with what office asked for", async () => {
    enrolmentApi.listMyEnrolmentRequests.mockResolvedValue([
      {
        enrolmentRequestId: "enrolment-1",
        status: "returned",
        submittedAt: "2026-09-06T10:00:00.000Z",
        reviewNote: "Add a phone number we can reach you on.",
      },
    ]);

    render(<EnrolPage />);

    expect(await screen.findByRole("heading", { name: /sent back to you/i })).toBeVisible();
    expect(screen.getByText(/Add a phone number we can reach you on\./)).toBeVisible();
    expect(screen.queryByRole("button", { name: /send request/i })).not.toBeInTheDocument();
  });

  it("lets the applicant withdraw an open request", async () => {
    const user = userEvent.setup();
    enrolmentApi.listMyEnrolmentRequests.mockResolvedValue([
      {
        enrolmentRequestId: "enrolment-1",
        status: "submitted",
        submittedAt: "2026-09-06T10:00:00.000Z",
      },
    ]);

    render(<EnrolPage />);

    await user.click(await screen.findByRole("button", { name: /withdraw this request/i }));

    await waitFor(() =>
      expect(enrolmentApi.withdrawEnrolmentRequest).toHaveBeenCalledWith("enrolment-1"),
    );
    // A withdrawn request is no longer open, so the form comes back: withdrawing is how somebody
    // corrects a request they sent by mistake, not a dead end.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /send request to the academy/i })).toBeVisible(),
    );
  });

  it("shows the academy's own message when a second request is refused", async () => {
    const user = userEvent.setup();
    enrolmentApi.submitEnrolmentRequest.mockRejectedValueOnce(
      new Error("You already have a request waiting for the academy to review"),
    );
    render(<EnrolPage />);

    await waitFor(() => expect(screen.getByLabelText("Full name")).toBeVisible());
    await user.type(screen.getByLabelText("Date of birth"), "1994-04-02");
    await user.click(screen.getByLabelText("Evening"));
    await user.click(screen.getByRole("button", { name: /send request to the academy/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You already have a request waiting for the academy to review",
    );
  });

  it("still offers the form when the request list cannot be read", async () => {
    enrolmentApi.listMyEnrolmentRequests.mockRejectedValue(new Error("offline"));

    render(<EnrolPage />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      /could not check whether you already have a request open/i,
    );
    expect(screen.getByRole("button", { name: /send request to the academy/i })).toBeVisible();
  });
});
