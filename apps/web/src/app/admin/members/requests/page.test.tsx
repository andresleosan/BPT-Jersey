import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enrolmentApi = vi.hoisted(() => ({
  listEnrolmentRequests: vi.fn(),
  returnEnrolmentRequest: vi.fn(),
  getEnrolmentRequestDetail: vi.fn(),
  approveEnrolmentRequest: vi.fn(),
}));

vi.mock("../../../../lib/enrolment-client", () => enrolmentApi);
// The Membership requests section embeds IntroApplicationsPanel, which reads through this client;
// mocked the same way its own test does, so opening the office queue never reaches Firebase.
vi.mock("../../../../lib/intro-conversion-client", () => ({
  listIntroMembershipApplications: vi.fn().mockResolvedValue([]),
  getIntroMembershipProofUrl: vi.fn(),
  reviewIntroMembershipApplication: vi.fn(),
}));
// The page also embeds PlanRequestsPanel (My plan requests); an empty queue keeps it out of the way.
vi.mock("../../../../lib/family-plan-client", () => ({
  FamilyPlanUnavailableError: class FamilyPlanUnavailableError extends Error {},
  listMemberPlanRequests: vi.fn().mockResolvedValue([]),
  decideMemberPlanRequest: vi.fn(),
}));
// A minimal slice of the real catalogue: the belts and stripes these tests need, with the same
// definition keys, names, sequences and age criteria production uses (verified against the
// bundled catalogue), so `defaultWhiteBelt` and the declared-level label resolve exactly as they
// would for a real applicant.
vi.mock("../../../../lib/levels-client", () => ({
  getLevelCatalog: vi.fn().mockResolvedValue({
    definitions: [
      {
        definitionKey: "yellow-2",
        name: "Yellow Belt 2 Stripes",
        sequence: 2,
        kind: "belt",
        parentDefinitionKey: null,
        criteria: { minAge: 0, maxAge: 200 },
      },
      {
        definitionKey: "white-belt",
        name: "WHITE BELT",
        sequence: 148,
        kind: "belt",
        parentDefinitionKey: null,
        criteria: { minAge: 16, maxAge: null },
      },
      {
        definitionKey: "white-belt-kids-7-8-and-8-10-yo",
        name: "WHITE BELT KIDS 7-8 and 8-10 YO",
        sequence: 49,
        kind: "belt",
        parentDefinitionKey: null,
        criteria: { minAge: 7, maxAge: 10 },
      },
      {
        definitionKey: "blue-belt",
        name: "BLUE BELT",
        sequence: 150,
        kind: "belt",
        parentDefinitionKey: null,
        criteria: { minAge: 16, maxAge: null },
      },
      {
        definitionKey: "blue-2nd-stripe",
        name: "Blue - 2nd Stripe",
        sequence: 151,
        kind: "stripe",
        parentDefinitionKey: "blue-belt",
        criteria: { minAge: 16, maxAge: null },
      },
    ],
  }),
}));

/** A date of birth that is exactly `age` years old on any day this suite runs. */
function dateOfBirthForAge(age: number): string {
  return `${new Date().getUTCFullYear() - age}-01-01`;
}

const gate = vi.hoisted(() => ({
  role: "owner" as "owner" | "administrator" | "headCoach" | "coach",
}));
vi.mock("../../admin-gate", () => ({
  useAdminOrStaffSession: () => ({
    uid: "u-1",
    email: "u@example.test",
    displayName: "Synthetic",
    academyId: "academy-1",
    role: gate.role,
  }),
}));

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
  planSelections: { applicant: "town-adult" as const, minors: [] },
  submittedBy: "client-1",
  submittedAt: "2026-09-06T10:00:00.000Z",
  // The server always reports the applicant account; approval needs it (and no longer its
  // verification, D8).
  applicantAccount: { email: "alex@example.test", emailVerified: false, disabled: false },
};

const allStatuses = (
  ["submitted", "returned", "approving", "approval-failed", "approved", "withdrawn"] as const
).map((status, index) => ({
  ...waiting,
  enrolmentRequestId: `enrolment-status-${index}`,
  applicantName: `Name ${status}`,
  status,
}));

/** The status label of every request card on screen. */
function badgeLabels(): string[] {
  const list = screen.queryByRole("list", { name: "Enrolment requests" });
  if (!list) return [];
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.querySelector(".admin-status-badge")?.textContent ?? "");
}

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

beforeEach(() => {
  gate.role = "owner";
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
    expect(await screen.findByText("Sent back to Alex Adult.")).toBeVisible();
  });

  it("drops the action once a request is resolved", async () => {
    enrolmentApi.listEnrolmentRequests.mockResolvedValue({
      requests: [{ ...waiting, status: "approved" as const }],
      truncated: false,
    });

    render(<EnrolmentRequestQueuePage />);
    await userEvent.selectOptions(screen.getByLabelText("Status"), "all");

    expect(await screen.findByText("Alex Adult")).toBeVisible();
    expect(screen.queryByRole("button", { name: /send back/i })).not.toBeInTheDocument();
  });

  it("shows only waiting and failed approvals by default", async () => {
    enrolmentApi.listEnrolmentRequests.mockResolvedValue({
      requests: allStatuses,
      truncated: false,
    });

    render(<EnrolmentRequestQueuePage />);

    await screen.findByText("Name submitted");
    expect(badgeLabels().sort()).toEqual(["Approval stopped", "Waiting"]);
    expect(screen.getByLabelText("Status")).toHaveValue("waiting");
  });

  it("keeps the history reachable from the status filter", async () => {
    enrolmentApi.listEnrolmentRequests.mockResolvedValue({
      requests: allStatuses,
      truncated: false,
    });
    render(<EnrolmentRequestQueuePage />);
    await screen.findByText("Name submitted");

    await userEvent.selectOptions(screen.getByLabelText("Status"), "all");

    expect(badgeLabels()).toHaveLength(6);
  });

  it("clears the filters back to the waiting view, not to the whole history", async () => {
    enrolmentApi.listEnrolmentRequests.mockResolvedValue({
      requests: allStatuses,
      truncated: false,
    });
    render(<EnrolmentRequestQueuePage />);
    await screen.findByText("Name submitted");

    await userEvent.selectOptions(screen.getByLabelText("Status"), "all");
    await userEvent.type(screen.getByLabelText("Search requests"), "nobody matches this");
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(screen.getByLabelText("Status")).toHaveValue("waiting");
    expect(badgeLabels().sort()).toEqual(["Approval stopped", "Waiting"]);
  });

  it("drops an approved request from the default view without a page reload", async () => {
    enrolmentApi.listEnrolmentRequests
      .mockResolvedValueOnce({ requests: [waiting], truncated: false })
      .mockResolvedValue({
        requests: [{ ...waiting, status: "approved" as const }],
        truncated: false,
      });
    render(<EnrolmentRequestQueuePage />);
    await screen.findByText("Alex Adult");
    await userEvent.click(firstButton(/review and enrol/i));
    await waitFor(() => expect(firstButton(/^approve$/i)).toBeEnabled());
    await userEvent.selectOptions(screen.getByLabelText("Initial level"), "yellow-2");

    await userEvent.click(firstButton(/^approve$/i));

    await waitFor(() => expect(screen.queryByText("Alex Adult")).not.toBeInTheDocument());
    expect(screen.queryByRole("list", { name: "Enrolment requests" })).not.toBeInTheDocument();
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

    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();

    await userEvent.click(firstButton(/review and enrol/i));

    await waitFor(() => expect(firstButton(/^approve$/i)).toBeEnabled());
    expect(enrolmentApi.getEnrolmentRequestDetail).toHaveBeenCalledWith("enrolment-1");
  });

  it("shows the confidential detail only for the request the reviewer opened", async () => {
    render(<EnrolmentRequestQueuePage />);
    await screen.findByText("Alex Adult");

    await userEvent.click(firstButton(/review and enrol/i));

    expect(await screen.findByText("1991-03-04")).toBeVisible();
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
    const toggle = () => firstButton(/review and enrol|close review/i);

    await userEvent.click(toggle());
    await screen.findByText("1991-03-04");
    await userEvent.click(toggle());
    await userEvent.click(toggle());

    await screen.findByText("1991-03-04");
    expect(enrolmentApi.getEnrolmentRequestDetail).toHaveBeenCalledTimes(1);
  });

  it("approves an applicant whose account email was never verified", async () => {
    // D8 (2026-09-23): no email verification anywhere; the office approval is enough.
    enrolmentApi.getEnrolmentRequestDetail.mockResolvedValue({
      ...detail,
      applicantAccount: { email: "alex@example.test", emailVerified: false, disabled: false },
    });
    render(<EnrolmentRequestQueuePage />);
    await screen.findByText("Alex Adult");
    await userEvent.click(firstButton(/review and enrol/i));

    await waitFor(() => expect(firstButton(/^approve$/i)).toBeEnabled());
    expect(screen.queryByText(/email verification required/i)).not.toBeInTheDocument();
  });

  it("enrols the applicant and says what happened", async () => {
    render(<EnrolmentRequestQueuePage />);
    await screen.findByText("Alex Adult");
    await userEvent.click(firstButton(/review and enrol/i));
    await waitFor(() => expect(firstButton(/^approve$/i)).toBeEnabled());

    await userEvent.selectOptions(screen.getByLabelText("Initial level"), "yellow-2");
    await userEvent.click(firstButton(/^approve$/i));

    expect(await screen.findByText(/Alex Adult is enrolled and can now sign in/i)).toBeVisible();
    expect(enrolmentApi.approveEnrolmentRequest).toHaveBeenCalledWith(
      "enrolment-1",
      expect.objectContaining({
        detailsVerified: true,
        paymentVerified: true,
        students: [expect.objectContaining({ definitionKey: "yellow-2", planId: "town-adult" })],
      }),
    );
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
    await userEvent.click(firstButton(/review and enrol/i));
    await waitFor(() => expect(firstButton(/^approve$/i)).toBeEnabled());

    await userEvent.selectOptions(screen.getByLabelText("Initial level"), "yellow-2");
    await userEvent.click(firstButton(/^approve$/i));

    expect(await screen.findByText(/applicant_account_incomplete/)).toBeVisible();
  });

  it("lets a coach see the queue and send a request back, but not open or approve it", async () => {
    gate.role = "coach";
    render(<EnrolmentRequestQueuePage />);
    await screen.findByText("Alex Adult");
    expect(screen.queryByRole("button", { name: /Review and enrol/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve$/ })).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Send back to applicant/ }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/Full details and enrolment are available to the office/i),
    ).toBeVisible();
  });
});

describe("requested enrolment plans", () => {
  it("keeps requests submitted before plan selection reviewable", async () => {
    const { planSelections, ...legacyDetail } = detail;
    expect(planSelections).toBeDefined();
    enrolmentApi.getEnrolmentRequestDetail.mockResolvedValueOnce(legacyDetail);
    const user = userEvent.setup();
    render(<EnrolmentRequestQueuePage />);
    await user.click((await screen.findAllByRole("button", { name: /review and enrol/i }))[0]!);
    expect(await screen.findByText("Not recorded on this request")).toBeVisible();
    expect(firstButton(/^approve$/i)).toBeEnabled();
  });

  it("shows the adult preference before approval", async () => {
    enrolmentApi.getEnrolmentRequestDetail.mockResolvedValueOnce({
      ...detail,
      planSelections: { applicant: "town-adult", minors: [] },
    });
    const user = userEvent.setup();
    render(<EnrolmentRequestQueuePage />);
    await user.click((await screen.findAllByRole("button", { name: /review and enrol/i }))[0]!);
    expect(await screen.findByText(/Town Adult · £85 per month/)).toBeVisible();
    expect(enrolmentApi.approveEnrolmentRequest).not.toHaveBeenCalled();
  });

  it("shows each child's selected plan alongside that child", async () => {
    enrolmentApi.getEnrolmentRequestDetail.mockResolvedValueOnce({
      ...detail,
      applicantIsStudent: false,
      minors: [
        {
          fullName: "Town Child",
          dateOfBirth: "2018-05-10",
          trainingCenter: "Town",
          trainingTimePreferences: ["afternoon"],
        },
        {
          fullName: "West Teen",
          dateOfBirth: "2011-05-10",
          trainingCenter: "West",
          trainingTimePreferences: ["evening"],
        },
      ],
      planSelections: { minors: ["town-kids-1x", "west-teens"] },
    });
    const user = userEvent.setup();
    render(<EnrolmentRequestQueuePage />);
    await user.click((await screen.findAllByRole("button", { name: /review and enrol/i }))[0]!);
    const whoWillTrain = await screen.findByRole("list", { name: "Who will train" });
    expect(within(whoWillTrain).getByText("Town Child").closest("li")).toHaveTextContent(
      "Town Kids & Teens 1x · £95 per term",
    );
    expect(within(whoWillTrain).getByText("West Teen").closest("li")).toHaveTextContent(
      "West Teens · £45 per month",
    );
  });
});

describe("trial declarations and preselected level", () => {
  it("shows the trial plan and preselects the declared belt and stripes", async () => {
    enrolmentApi.getEnrolmentRequestDetail.mockResolvedValueOnce({
      ...detail,
      applicant: { ...detail.applicant, dateOfBirth: dateOfBirthForAge(30) },
      planSelections: { applicant: "trial" as const, minors: [] },
      levelDeclarations: {
        applicant: { experience: "experienced" as const, declaredLevelKey: "blue-2nd-stripe" },
        minors: [],
      },
    });
    const user = userEvent.setup();
    render(<EnrolmentRequestQueuePage />);
    await user.click((await screen.findAllByRole("button", { name: /review and enrol/i }))[0]!);

    // Introduction Classes are for adult beginners only; a declared belt spends its one free class
    // on a regular class of their age.
    expect(await screen.findByText("Trial (1 free class)")).toBeVisible();
    expect(screen.getByText("Level: Blue belt · 2 stripes (declared)")).toBeVisible();
    expect(screen.getByLabelText("Initial level")).toHaveValue("blue-2nd-stripe");
    expect(
      screen.getByText(
        /Trial — no plan, dates or payment: 2 free classes for a beginner, 1 for a declared belt, within 30 days\. .*Confirm the initial level\./,
      ),
    ).toBeVisible();
    // The booking rule since 2026-10-22: adults on a trial book Free Trial classes; children also
    // book the classes of their age. The old «Introduction Class» wording is gone.
    expect(
      screen.getByText(
        /Adults book Free Trial classes; children also book the classes of their age\./,
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Introduction Class/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Subscription start")).not.toBeInTheDocument();
    // The trial has no plan to name, so the setup fieldset's "Plan: …" line must not render a bare
    // "Plan:" for it (the catalogue has no "trial" entry).
    expect(screen.queryByText(/^Plan:/)).not.toBeInTheDocument();
  });

  it("preselects the age's white belt for a paid plan with a beginner declaration, and the guard still fires once the level is cleared", async () => {
    // The public enrolment form sends a `beginner` declaration by default for every student, paid
    // or trial (apps/web/src/app/enrol/page.tsx builds one for every selected plan) — so a paid
    // enrolment arrives WITH `levelDeclarations`, not without it. A beginner starts on the white
    // belt of their age whatever the plan (Luis, 2026-10-01), but office can still change it, so
    // the approve guard has to keep firing when no level is chosen.
    enrolmentApi.getEnrolmentRequestDetail.mockResolvedValueOnce({
      ...detail,
      levelDeclarations: {
        applicant: { experience: "beginner" as const, declaredLevelKey: null },
        minors: [],
      },
    });
    render(<EnrolmentRequestQueuePage />);
    await screen.findByText("Alex Adult");
    await userEvent.click(firstButton(/review and enrol/i));
    await waitFor(() => expect(firstButton(/^approve$/i)).toBeEnabled());

    expect(screen.getByLabelText("Initial level")).toHaveValue("white-belt");

    await userEvent.selectOptions(screen.getByLabelText("Initial level"), "");
    await userEvent.click(firstButton(/^approve$/i));

    expect(
      await screen.findByText(
        "Choose every student's level and subscription dates before approving.",
      ),
    ).toBeVisible();
    expect(enrolmentApi.approveEnrolmentRequest).not.toHaveBeenCalled();
  });

  it("preselects the adult white belt for a beginner trial applicant", async () => {
    enrolmentApi.getEnrolmentRequestDetail.mockResolvedValueOnce({
      ...detail,
      applicant: { ...detail.applicant, dateOfBirth: dateOfBirthForAge(30) },
      planSelections: { applicant: "trial" as const, minors: [] },
      levelDeclarations: {
        applicant: { experience: "beginner" as const, declaredLevelKey: null },
        minors: [],
      },
    });
    const user = userEvent.setup();
    render(<EnrolmentRequestQueuePage />);
    await user.click((await screen.findAllByRole("button", { name: /review and enrol/i }))[0]!);

    expect(await screen.findByText("Trial (2 free classes)")).toBeVisible();
    expect(screen.getByText("Level: Beginner")).toBeVisible();
    expect(screen.getByLabelText("Initial level")).toHaveValue("white-belt");
  });

  it("preselects the kids white belt for a 9-year-old beginner trial applicant", async () => {
    enrolmentApi.getEnrolmentRequestDetail.mockResolvedValueOnce({
      ...detail,
      applicantIsStudent: false,
      applicant: { ...detail.applicant, trainingTimePreferences: [] },
      minors: [
        {
          fullName: "Nine YearOld",
          dateOfBirth: dateOfBirthForAge(9),
          trainingCenter: "Town" as const,
          trainingTimePreferences: ["afternoon"] as const,
        },
      ],
      planSelections: { minors: ["trial" as const] },
      levelDeclarations: {
        minors: [{ experience: "beginner" as const, declaredLevelKey: null }],
      },
    });
    const user = userEvent.setup();
    render(<EnrolmentRequestQueuePage />);
    await user.click((await screen.findAllByRole("button", { name: /review and enrol/i }))[0]!);

    const whoWillTrain = await screen.findByRole("list", { name: "Who will train" });
    expect(within(whoWillTrain).getByText("Nine YearOld")).toBeVisible();
    expect(screen.getByLabelText("Initial level")).toHaveValue("white-belt-kids-7-8-and-8-10-yo");
  });

  it("approves a trial student with no plan, dates or payment", async () => {
    enrolmentApi.getEnrolmentRequestDetail.mockResolvedValueOnce({
      ...detail,
      applicant: { ...detail.applicant, dateOfBirth: dateOfBirthForAge(30) },
      planSelections: { applicant: "trial" as const, minors: [] },
      levelDeclarations: {
        applicant: { experience: "beginner" as const, declaredLevelKey: null },
        minors: [],
      },
    });
    render(<EnrolmentRequestQueuePage />);
    await screen.findByText("Alex Adult");
    await userEvent.click(firstButton(/review and enrol/i));
    await waitFor(() => expect(firstButton(/^approve$/i)).toBeEnabled());

    await userEvent.click(firstButton(/^approve$/i));

    await waitFor(() =>
      expect(enrolmentApi.approveEnrolmentRequest).toHaveBeenCalledWith(
        "enrolment-1",
        expect.objectContaining({
          students: [
            expect.objectContaining({
              planId: "trial",
              definitionKey: "white-belt",
              endsOn: null,
            }),
          ],
        }),
      ),
    );
  });
});

describe("membership requests", () => {
  it("renders the Membership requests section for an administrator", async () => {
    gate.role = "administrator";
    render(<EnrolmentRequestQueuePage />);

    expect(
      await screen.findByRole("heading", { name: "Membership requests", level: 3 }),
    ).toBeVisible();
  });

  it("hides the Membership requests section from a coach", async () => {
    gate.role = "coach";
    render(<EnrolmentRequestQueuePage />);
    await screen.findByText("Alex Adult");

    expect(screen.queryByRole("heading", { name: "Membership requests" })).not.toBeInTheDocument();
  });
});

describe("opened from a notification link", () => {
  beforeEach(() => {
    // jsdom has no scrollIntoView; the page scrolls the linked request into view.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("brings the linked request into view and focuses its Review button", async () => {
    window.history.replaceState({}, "", "/admin/members/requests?request=enrolment-2");
    render(<EnrolmentRequestQueuePage />);

    const card = (await screen.findByText("Robin Guardian")).closest("li");
    await waitFor(() => expect(card).toHaveAttribute("data-linked"));
    expect(card).toHaveAttribute("id", "enrolment-request-enrolment-2");
    expect(screen.getByText("Alex Adult").closest("li")).not.toHaveAttribute("data-linked");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(card as HTMLElement).getByRole("button", { name: "Review and enrol" }),
      ),
    );
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts).toContain(card);
    expect(enrolmentApi.getEnrolmentRequestDetail).not.toHaveBeenCalled();
  });

  it("shows a linked request that is no longer waiting", async () => {
    enrolmentApi.listEnrolmentRequests.mockResolvedValue({
      requests: allStatuses,
      truncated: false,
    });
    window.history.replaceState({}, "", "/admin/members/requests?request=enrolment-status-4");
    render(<EnrolmentRequestQueuePage />);

    const card = (await screen.findByText("Name approved")).closest("li");
    await waitFor(() => expect(card).toHaveAttribute("data-linked"));
    expect(screen.getByLabelText("Status")).toHaveValue("all");
    expect(enrolmentApi.getEnrolmentRequestDetail).not.toHaveBeenCalled();
  });

  it("explains a request that is no longer in the queue", async () => {
    window.history.replaceState({}, "", "/admin/members/requests?request=enrolment-missing");
    render(<EnrolmentRequestQueuePage />);

    expect(
      await screen.findByText(
        "That registration has already been decided or is no longer in the queue.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Status")).toHaveValue("waiting");
    expect(document.querySelector("[data-linked]")).toBeNull();
    expect(enrolmentApi.getEnrolmentRequestDetail).not.toHaveBeenCalled();
  });
});
