import { beforeEach, describe, expect, it, vi } from "vitest";

const callable = vi.hoisted(() => vi.fn());
const named = vi.hoisted(() => vi.fn(() => callable));
vi.mock("firebase/functions", () => ({ httpsCallable: named }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import { listMemberNotifications, markMemberNotificationRead } from "./intro-notifications-client";

const notice = { notificationId: "intro-abc", academyId: "academy-1", recipientUid: "user-1", kind: "intro_membership_ready", title: "Choose your membership", body: "Intro complete.", href: "/account/membership?from=intro", readAt: null, createdAt: "2026-09-21T12:00:00.000Z", schemaVersion: "1" } as const;

describe("intro notifications client", () => {
  beforeEach(() => { callable.mockReset(); named.mockClear(); });
  it("validates and returns notices from the in-app callable", async () => {
    callable.mockResolvedValue({ data: { notifications: [notice] } });
    await expect(listMemberNotifications()).resolves.toEqual([notice]);
    expect(named).toHaveBeenCalledWith({}, "listMemberNotifications");
    expect(callable).toHaveBeenCalledWith(null);
  });
  it("fails closed for hostile responses and invalid identifiers", async () => {
    callable.mockResolvedValueOnce({ data: { notifications: [{ ...notice, href: "https://evil.test" }] } });
    await expect(listMemberNotifications()).rejects.toThrow("Unable to load membership notices");
    await expect(markMemberNotificationRead("../escape")).rejects.toThrow("Unable to update this notice");
  });
  it("marks one validated notice as read", async () => {
    callable.mockResolvedValue({ data: { ok: true } });
    await markMemberNotificationRead("intro-abc");
    expect(named).toHaveBeenCalledWith({}, "markMemberNotificationRead");
    expect(callable).toHaveBeenCalledWith({ notificationId: "intro-abc" });
  });
});
