import type { CallableRequest } from "firebase-functions/v2/https";
import { describe, expect, it, vi } from "vitest";
import {
  listTeamDirectoryHandler,
  createStaffInvitationHandler,
  acceptStaffInvitationHandler,
  changeTeamRoleHandler,
  type TeamAccessServices,
} from "./team-access.js";

function request(data: unknown = {}, role = "owner") {
  return {
    data,
    app: { appId: "synthetic" },
    auth: {
      uid: "actor",
      token: {
        academyId: "academy-1",
        role,
        email: "actor@example.test",
        email_verified: true,
        firebase: { sign_in_provider: "google.com" },
      },
    },
  } as unknown as CallableRequest;
}
function services() {
  const current = {
    uid: "actor",
    email: "actor@example.test",
    emailVerified: true,
    displayName: "Academy owner",
    disabled: false,
    customClaims: { academyId: "academy-1", role: "owner" },
    providerData: [{ providerId: "google.com" }],
  };
  const invite = {
    id: "invite",
    version: "v1",
    academyId: "academy-1",
    email: current.email,
    role: "administrator" as const,
    invitedBy: "issuer",
    createdAt: "2026-09-20T10:00:00.000Z",
    expiresAt: "2026-09-27T10:00:00.000Z",
    status: "pending" as const,
    claimedBy: null,
  };
  return {
    current,
    invite,
    auth: {
      getUser: vi.fn(async (uid: string) => ({ ...current, uid })),
      listUsers: vi.fn(async () => ({ users: [current] })),
    },
    invitations: {
      list: vi.fn(async () => [invite]),
      save: vi.fn(async () => invite),
      cancel: vi.fn(async () => undefined),
      claim: vi.fn(async () => invite),
      finish: vi.fn(async () => undefined),
    },
    grant: vi.fn(async () => undefined),
    now: () => new Date("2026-09-20T12:00:00.000Z"),
  } satisfies TeamAccessServices & { current: unknown; invite: unknown };
}

describe("team directory and administrative invitations", () => {
  it.each(["coach", "headCoach", "guardian", "adultStudent", "teenStudent", "shopper"])(
    "denies directory access to %s before reading accounts",
    async (role) => {
      const s = services();
      await expect(listTeamDirectoryHandler(request({}, role), s)).rejects.toMatchObject({
        code: "permission-denied",
      });
      expect(s.auth.listUsers).not.toHaveBeenCalled();
    },
  );
  it("projects only team identity from the caller's academy and propagates pagination", async () => {
    const s = services();
    s.auth.listUsers.mockResolvedValue({
      users: [
        s.current,
        { ...s.current, uid: "coach", customClaims: { academyId: "academy-1", role: "coach" } },
        { ...s.current, uid: "foreign", customClaims: { academyId: "academy-2", role: "owner" } },
        {
          ...s.current,
          uid: "student",
          customClaims: { academyId: "academy-1", role: "adultStudent" },
        },
      ],
      pageToken: "next",
    } as never);
    const result = await listTeamDirectoryHandler(request({ pageToken: "first" }), s);
    expect(s.auth.listUsers).toHaveBeenCalledWith(1000, "first");
    expect(result).toEqual({
      people: [
        { userId: "actor", name: "Academy owner", email: "actor@example.test", role: "owner" },
        { userId: "coach", name: "Academy owner", email: "actor@example.test", role: "coach" },
      ],
      nextPageToken: "next",
    });
  });
  it("rejects a stale owner token and unverified application", async () => {
    const s = services();
    s.current.customClaims.role = "coach";
    await expect(listTeamDirectoryHandler(request(), s)).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(
      listTeamDirectoryHandler({ ...request(), app: undefined } as never, s),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(s.auth.listUsers).not.toHaveBeenCalled();
  });
  it("creates an invitation without granting a role or sending email", async () => {
    const s = services();
    await createStaffInvitationHandler(
      request({ email: " TEAM@Example.test ", role: "administrator" }),
      s,
    );
    expect(s.invitations.save).toHaveBeenCalledWith(
      expect.objectContaining({
        academyId: "academy-1",
        email: "team@example.test",
        invitedBy: "actor",
        role: "administrator",
        status: "pending",
        expiresAt: "2026-09-27T12:00:00.000Z",
      }),
    );
    expect(s.grant).not.toHaveBeenCalled();
  });
  it("does not let administrators invite or promote themselves", async () => {
    const s = services();
    s.current.customClaims.role = "administrator";
    await expect(
      createStaffInvitationHandler(
        request({ email: "team@example.test", role: "owner" }, "administrator"),
        s,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      changeTeamRoleHandler(
        request({ userId: "actor", email: "actor@example.test", role: "owner" }, "administrator"),
        s,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(s.grant).not.toHaveBeenCalled();
    expect(s.invitations.save).not.toHaveBeenCalled();
  });
  it("promotes an existing team member through the locked provisioning service", async () => {
    const s = services();
    await changeTeamRoleHandler(
      request({ userId: "coach", email: "coach@example.test", role: "administrator" }),
      s,
    );
    expect(s.grant).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "actor", academyId: "academy-1" }),
      { uid: "coach", email: "coach@example.test", role: "administrator" },
      "team",
    );
  });
  it("accepts only an invitation for the verified Google email and consumes it once", async () => {
    const s = services();
    await expect(acceptStaffInvitationHandler(request(), s)).resolves.toEqual({ activated: true });
    expect(s.invitations.claim).toHaveBeenCalledWith(
      "actor@example.test",
      "actor",
      "2026-09-20T12:00:00.000Z",
    );
    expect(s.grant).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "issuer", role: "owner" }),
      { uid: "actor", email: "actor@example.test", role: "administrator" },
      "invitation",
    );
    expect(s.invitations.finish).toHaveBeenCalledWith(s.invite, "actor", "accepted");
  });
  it("rejects password sign-in even if Google is linked", async () => {
    const s = services();
    const r = request() as unknown as {
      auth: { token: { firebase: { sign_in_provider: string } } };
    };
    r.auth.token.firebase.sign_in_provider = "password";
    await expect(acceptStaffInvitationHandler(r as never, s)).rejects.toMatchObject({
      code: "failed-precondition",
    });
    expect(s.invitations.claim).not.toHaveBeenCalled();
  });
  it("rejects an unverified or disabled account before claiming an invitation", async () => {
    for (const patch of [{ emailVerified: false }, { disabled: true }]) {
      const s = services();
      Object.assign(s.current, patch);
      await expect(acceptStaffInvitationHandler(request(), s)).rejects.toMatchObject({
        code: "failed-precondition",
      });
      expect(s.invitations.claim).not.toHaveBeenCalled();
    }
  });
  it("does not grant when the inviter is no longer an active owner", async () => {
    const s = services();
    s.auth.getUser.mockImplementation(async (uid) => ({
      ...s.current,
      uid,
      customClaims: { academyId: "academy-1", role: uid === "issuer" ? "administrator" : "owner" },
    }));
    await expect(acceptStaffInvitationHandler(request(), s)).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(s.grant).not.toHaveBeenCalled();
    expect(s.invitations.finish).toHaveBeenCalledWith(s.invite, "actor", "failed");
  });
  it("leaves no role change for missing invitations and records failed grants without retry", async () => {
    const s = services();
    s.invitations.claim.mockResolvedValueOnce(null as never);
    await expect(acceptStaffInvitationHandler(request(), s)).resolves.toEqual({ activated: false });
    expect(s.grant).not.toHaveBeenCalled();
    s.grant.mockRejectedValueOnce(new Error("unavailable"));
    await expect(acceptStaffInvitationHandler(request(), s)).rejects.toThrow();
    expect(s.invitations.finish).toHaveBeenCalledWith(s.invite, "actor", "failed");
  });
});
