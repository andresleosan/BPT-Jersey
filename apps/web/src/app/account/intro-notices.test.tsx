import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ list: vi.fn(), mark: vi.fn() }));
vi.mock("../../lib/intro-notifications-client", () => ({ listMemberNotifications: api.list, markMemberNotificationRead: api.mark }));
import { IntroNotices } from "./intro-notices";

const notice = { notificationId: "intro-abc", academyId: "academy-1", recipientUid: "user-1", kind: "intro_membership_ready", title: "Choose your membership", body: "Your Intro Class is complete.", href: "/account/membership?from=intro", readAt: null, createdAt: "2026-09-21T12:00:00.000Z", schemaVersion: "1" } as const;

describe("IntroNotices", () => {
  beforeEach(() => { api.list.mockResolvedValue([notice]); api.mark.mockResolvedValue(undefined); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  it("shows only an internal plan action after an attended intro", async () => {
    render(<IntroNotices />);
    expect(await screen.findByRole("heading", { name: "Your next step" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose membership" })).toHaveAttribute("href", "/account/membership?from=intro");
  });
  it("dismisses the notice only after the server accepts the read", async () => {
    render(<IntroNotices />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(api.mark).toHaveBeenCalledWith("intro-abc"));
    await waitFor(() => expect(screen.queryByText("Your Intro Class is complete.")).not.toBeInTheDocument());
  });
  it("does not expose backend failures", async () => {
    api.list.mockRejectedValue(new Error("token and stack"));
    render(<IntroNotices />);
    expect(await screen.findByRole("status")).toHaveTextContent("Notices could not be updated");
    expect(screen.queryByText("token and stack")).not.toBeInTheDocument();
  });
});
