import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const waitlistState = vi.hoisted(() => ({
  listGroups: vi.fn(),
  issue: vi.fn(),
}));

vi.mock("../../../lib/admin-waitlist-client", () => ({
  listAdminWaitlistGroups: waitlistState.listGroups,
  issueNextAdminWaitlistOffer: waitlistState.issue,
}));

import { AdminWaitlistsPage } from "./page";

function waiting(sessionId: string, studentReference: string, position: number) {
  return {
    sessionId,
    studentReference,
    position,
    status: "waiting",
    requestedAt: "2026-09-20T09:00:00.000Z",
    offeredAt: null,
    offerExpiresAt: null,
    acceptedAt: null,
    cancelledAt: null,
  } as const;
}

function offered(sessionId: string, studentReference: string, position: number) {
  return {
    ...waiting(sessionId, studentReference, position),
    status: "offered",
    offeredAt: "2026-09-26T07:50:00.000Z",
    offerExpiresAt: "2026-09-26T08:20:00.000Z",
  } as const;
}

const adultGroup = {
  groupId: "class-adult",
  title: "Adult Fundamentals",
  location: "town",
  count: 3,
  sessions: [
    {
      sessionId: "session-private-a",
      startAt: "2026-09-27T17:30:00.000Z",
      entries: [
        waiting("session-private-a", "student-private-1", 1),
        waiting("session-private-a", "student-private-2", 2),
      ],
    },
    {
      sessionId: "session-private-b",
      startAt: "2026-09-29T17:30:00.000Z",
      entries: [waiting("session-private-b", "student-private-3", 1)],
    },
  ],
} as const;

const kidsGroup = {
  groupId: "class-kids",
  title: "Kids BJJ",
  location: "west",
  count: 1,
  sessions: [
    {
      sessionId: "session-private-k",
      startAt: "2026-09-28T16:00:00.000Z",
      entries: [waiting("session-private-k", "student-private-4", 1)],
    },
  ],
} as const;

describe("admin class waitlists by group", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-26T08:00:00.000Z"));
    window.history.replaceState(null, "", "/admin/waitlists");
    waitlistState.listGroups.mockResolvedValue({
      groups: [adultGroup, kidsGroup],
      truncated: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows every group by default with its waiting count and no internal identifiers", async () => {
    render(<AdminWaitlistsPage />);

    expect(await screen.findByRole("heading", { name: "Adult Fundamentals" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Kids BJJ" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Group" })).toHaveValue("all");
    expect(screen.getByText("3 waiting")).toBeVisible();
    expect(screen.getByText("1 waiting")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Offer next place" })).toHaveLength(3);
    expect(document.body).not.toHaveTextContent(/student-private|session-private|class-adult/iu);
  });

  it("filters to one group and records it in the URL", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AdminWaitlistsPage />);

    await user.selectOptions(await screen.findByRole("combobox", { name: "Group" }), "class-kids");

    expect(screen.getByRole("heading", { name: "Kids BJJ" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Adult Fundamentals" })).toBeNull();
    expect(replaceState).toHaveBeenCalled();
    expect(window.location.search).toBe("?group=class-kids");

    await user.selectOptions(screen.getByRole("combobox", { name: "Group" }), "all");
    expect(window.location.search).toBe("");
    expect(screen.getByRole("heading", { name: "Adult Fundamentals" })).toBeVisible();
  });

  it("preselects the group named in the URL", async () => {
    window.history.replaceState(null, "", "/admin/waitlists?group=class-adult");
    render(<AdminWaitlistsPage />);

    expect(await screen.findByRole("heading", { name: "Adult Fundamentals" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Group" })).toHaveValue("class-adult");
    expect(screen.queryByRole("heading", { name: "Kids BJJ" })).toBeNull();
  });

  it("offers the next place for the chosen date and refreshes the groups", async () => {
    waitlistState.issue.mockResolvedValue(offered("session-private-b", "student-private-3", 1));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AdminWaitlistsPage />);

    const date = await screen.findByRole("region", { name: /Adult Fundamentals, Tue 29 Sept/iu });
    await user.click(within(date).getByRole("button", { name: "Offer next place" }));

    expect(waitlistState.issue).toHaveBeenCalledOnce();
    expect(waitlistState.issue).toHaveBeenCalledWith("session-private-b");
    expect(await screen.findByText("Offer sent to the next eligible participant.")).toBeVisible();
    await waitFor(() => expect(waitlistState.listGroups).toHaveBeenCalledTimes(2));
  });

  it("disables the offer on a date that already has an active offer", async () => {
    waitlistState.listGroups.mockResolvedValue({
      truncated: false,
      groups: [
        {
          ...kidsGroup,
          sessions: [
            {
              ...kidsGroup.sessions[0],
              entries: [
                offered("session-private-k", "student-private-4", 1),
                waiting("session-private-k", "student-private-5", 2),
              ],
            },
          ],
        },
      ],
    });
    render(<AdminWaitlistsPage />);

    const date = await screen.findByRole("region", { name: /Kids BJJ/iu });
    expect(within(date).getByText("An offer is already active for this date.")).toBeVisible();
    expect(within(date).getByRole("button", { name: "Offer next place" })).toBeDisabled();
  });

  it("shows the queues read-only without the offer action", async () => {
    render(<AdminWaitlistsPage canIssue={false} />);

    expect(await screen.findByRole("heading", { name: "Adult Fundamentals" })).toBeVisible();
    expect(screen.getByText("Read-only staff access.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Offer next place" })).toBeNull();
  });

  it("shows a safe empty state when nobody is waiting", async () => {
    waitlistState.listGroups.mockResolvedValue({ groups: [], truncated: false });
    render(<AdminWaitlistsPage />);

    expect(await screen.findByText("Nobody is waiting for a future class.")).toBeVisible();
    expect(screen.queryByText(/Showing the first/iu)).toBeNull();
  });

  it("says when the list was cut short", async () => {
    waitlistState.listGroups.mockResolvedValue({ groups: [adultGroup], truncated: true });
    render(<AdminWaitlistsPage />);

    expect(await screen.findByRole("heading", { name: "Adult Fundamentals" })).toBeVisible();
    expect(
      screen.getByText(
        "Showing the first waitlists only. Some queues in the next 45 days are not listed.",
      ),
    ).toBeVisible();
  });

  it("shows a safe error when the groups cannot be loaded", async () => {
    waitlistState.listGroups.mockRejectedValue(new Error("raw"));
    render(<AdminWaitlistsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Class waitlists could not be loaded. Please try again later.",
    );
  });
});
