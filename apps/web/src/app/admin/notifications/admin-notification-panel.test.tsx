import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminInboxPage, AdminNotification } from "@bpt-jersey/domain/memberships/admin";

const api = vi.hoisted(() => ({
  getAdminNotifications: vi.fn(),
  updateNotification: vi.fn(),
  editSubscription: vi.fn(),
  getMemberSubscriptions: vi.fn(),
}));
vi.mock("../../../lib/subscription-admin-client", () => api);
vi.mock("../members/member-subscription-editor", () => ({ MemberSubscriptionAction: () => null }));

import { AdminNotificationPanel } from "./admin-notification-panel";

const unread: AdminNotification = {
  notificationId: "n-1",
  kind: "payment",
  title: "Payment received",
  message: "A payment was recorded.",
  href: "/admin/members",
  createdAt: "2026-09-20T10:00:00.000Z",
  readAt: null,
  resolvedAt: null,
  membershipId: null,
  studentId: null,
  endsAt: null,
};
const read: AdminNotification = {
  ...unread,
  notificationId: "n-2",
  title: "Class changed",
  kind: "class",
  readAt: "2026-09-21T10:00:00.000Z",
};
const page: AdminInboxPage = { notifications: [unread, read], nextCursor: null, unreadCount: 1 };
const initial = { kind: null, readState: "all", from: null, to: null, cursor: null };

function setViewport(mobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: mobile && query.includes("max-width"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}
const startOfDay = (date: string) => new Date(`${date}T00:00:00`).toISOString();
const endOfDay = (date: string) => new Date(`${date}T23:59:59.999`).toISOString();

beforeEach(() => {
  setViewport(false);
  api.getAdminNotifications.mockResolvedValue(page);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("AdminNotificationPanel", () => {
  it("keeps one loading status line in place so the table does not shift when loading ends", async () => {
    let finish: (value: AdminInboxPage) => void = () => undefined;
    api.getAdminNotifications.mockReturnValueOnce(
      new Promise<AdminInboxPage>((resolve) => (finish = resolve)),
    );
    render(<AdminNotificationPanel />);
    const line = await screen.findByText("Loading notifications…");
    expect(line).toHaveAttribute("role", "status");

    await act(async () => finish(page));
    await screen.findByText("Payment received");
    expect(line).toBeInTheDocument();
    expect(line).toHaveClass("admin-notification-loading");
    expect(line).toBeEmptyDOMElement();
  });

  it("sends the whole query with a reset cursor whenever a filter changes", async () => {
    render(<AdminNotificationPanel />);
    await screen.findByText("Payment received");
    expect(api.getAdminNotifications).toHaveBeenLastCalledWith(initial);

    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "payment" } });
    expect(api.getAdminNotifications).toHaveBeenLastCalledWith({ ...initial, kind: "payment" });

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "read" } });
    expect(api.getAdminNotifications).toHaveBeenLastCalledWith({
      ...initial,
      kind: "payment",
      readState: "read",
    });

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-10" } });
    expect(api.getAdminNotifications).toHaveBeenLastCalledWith({
      kind: "payment",
      readState: "read",
      from: startOfDay("2026-09-01"),
      to: endOfDay("2026-09-10"),
      cursor: null,
    });
    expect(screen.getByRole("option", { name: "Unread" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "All" })).toBeInTheDocument();
  });

  it("fills the date range from the shortcuts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-26T12:00:00"));
    render(<AdminNotificationPanel />);
    await screen.findByText("Payment received");

    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    expect(api.getAdminNotifications).toHaveBeenLastCalledWith({
      ...initial,
      from: startOfDay("2026-09-20"),
      to: endOfDay("2026-09-26"),
    });
    expect(screen.getByLabelText("From")).toHaveValue("2026-09-20");

    fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }));
    expect(api.getAdminNotifications).toHaveBeenLastCalledWith({
      ...initial,
      from: startOfDay("2026-08-28"),
      to: endOfDay("2026-09-26"),
    });
  });

  it("does not query an inverted range", async () => {
    render(<AdminNotificationPanel />);
    await screen.findByText("Payment received");
    const calls = api.getAdminNotifications.mock.calls.length;
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-10" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("From must be on or before To.");
    expect(api.getAdminNotifications).toHaveBeenCalledTimes(calls + 1);
  });

  it("folds the filters into a details element on small screens", async () => {
    setViewport(true);
    render(<AdminNotificationPanel />);
    await screen.findByText("Payment received");
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "payment" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "unread" } });
    const summary = screen.getByText("Filters · 2 active");
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.closest("details")).toContainElement(screen.getByLabelText("Type"));
    expect(await screen.findByRole("list", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders a table on desktop with unread shown as text and a left rule", async () => {
    const { container } = render(<AdminNotificationPanel />);
    const table = await screen.findByRole("table", { name: "Notifications" });
    expect(screen.queryByRole("list", { name: "Notifications" })).not.toBeInTheDocument();
    expect(container.querySelector("details")).toBeNull();
    const unreadRow = within(table).getByText("Payment received").closest("tr")!;
    expect(unreadRow).toHaveClass("admin-notification-unread");
    expect(within(unreadRow).getByText("Unread")).toBeInTheDocument();
    const readRow = within(table).getByText("Class changed").closest("tr")!;
    expect(readRow).not.toHaveClass("admin-notification-unread");
    expect(within(readRow).getByText("Read")).toBeInTheDocument();
    expect(container.querySelector("[class*='pill']")).toBeNull();
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("keeps the active filters when polling", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<AdminNotificationPanel />);
    await screen.findByText("Payment received");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "unread" } });
    await screen.findByText("Payment received");
    api.getAdminNotifications.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.getAdminNotifications).toHaveBeenCalledWith({ ...initial, readState: "unread" });
  });
});
