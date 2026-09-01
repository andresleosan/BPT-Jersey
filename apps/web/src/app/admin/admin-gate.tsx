"use client";

import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { AdminRole } from "@bpt-jersey/domain";
import { usePathname } from "next/navigation";

import { AdminAuthProvider, useAdminSession, type AdminSession } from "../../lib/admin-auth";
import { adminSessionForTestRole, isAdminE2EEnabled } from "../../lib/admin-test-bootstrap";
import { StaffAuthProvider, useStaffSession, type StaffSession } from "../../lib/staff-auth";
import { AdminShell } from "./admin-shell";

type AdminTestRole = AdminRole | "coach" | "guardian" | "adultStudent";
type GateStatus = "loading" | "signed-out" | "denied" | "authorized";

const AdminGateSessionContext = createContext<AdminSession | undefined>(undefined);
const AdminGateAnySessionContext = createContext<AdminSession | StaffSession | undefined>(
  undefined,
);
const WaitlistIssuePermissionContext = createContext<boolean | undefined>(undefined);

export function AdminGateSessionProvider({
  children,
  session,
}: {
  children: ReactNode;
  session: AdminSession;
}) {
  return (
    <AdminGateSessionContext.Provider value={session}>{children}</AdminGateSessionContext.Provider>
  );
}

function AuthorizedAdminContent({
  children,
  onSignOut,
  session,
}: {
  children: ReactNode;
  onSignOut?: () => Promise<void>;
  session: AdminSession;
}) {
  return (
    <WaitlistIssuePermissionContext.Provider value={true}>
      <AdminGateSessionProvider session={session}>
        <AdminGateAnySessionContext.Provider value={session}>
          <AdminShell {...(onSignOut ? { onSignOut } : {})} session={session}>
            {children}
          </AdminShell>
        </AdminGateAnySessionContext.Provider>
      </AdminGateSessionProvider>
    </WaitlistIssuePermissionContext.Provider>
  );
}

function AuthorizedStaffWaitlistContent({
  children,
  onSignOut,
  session,
}: {
  children: ReactNode;
  onSignOut: () => Promise<void>;
  session: StaffSession;
}) {
  return (
    <WaitlistIssuePermissionContext.Provider value={false}>
      <AdminGateAnySessionContext.Provider value={session}>
        <AdminShell onSignOut={onSignOut} session={session}>
          {children}
        </AdminShell>
      </AdminGateAnySessionContext.Provider>
    </WaitlistIssuePermissionContext.Provider>
  );
}

function isLessonPlanningRoute(pathname: string): boolean {
  return pathname === "/admin/lesson-plans" || pathname.startsWith("/admin/lesson-plans/");
}
function isWaitlistRoute(pathname: string): boolean {
  return pathname === "/admin/waitlists" || pathname.startsWith("/admin/waitlists/");
}

function isAdminTestRole(value: string | null): value is AdminTestRole {
  return (
    value === "owner" ||
    value === "administrator" ||
    value === "coach" ||
    value === "guardian" ||
    value === "adultStudent"
  );
}

function AccessState({ status }: { status: Exclude<GateStatus, "loading" | "authorized"> }) {
  const signedOut = status === "signed-out";

  return (
    <main className="admin-auth-state" aria-labelledby="admin-auth-state-title">
      <p className="admin-eyebrow">BPT Jersey / Admin</p>
      <h1 id="admin-auth-state-title">
        {signedOut ? "Admin access required" : "Administrative access not authorized"}
      </h1>
      <p>
        {signedOut
          ? "Sign in with an approved administrative account to continue."
          : "This account is not authorized to access the administrative workspace."}
      </p>
      {signedOut ? (
        <div className="admin-auth-actions">
          <a className="admin-auth-button" href="/login?role=administrator">
            Sign in
          </a>
          <a className="admin-auth-home" href="/">
            Home
          </a>
        </div>
      ) : null}
    </main>
  );
}

function FirebaseAdminGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const admin = useAdminSession();
  const staff = useStaffSession();

  if (admin.status === "authorized" && admin.session) {
    return (
      <AuthorizedAdminContent onSignOut={admin.signOut} session={admin.session}>
        {children}
      </AuthorizedAdminContent>
    );
  }

  if (
    (isWaitlistRoute(pathname) || isLessonPlanningRoute(pathname)) &&
    staff.status === "signed-in" &&
    staff.session
  ) {
    return (
      <AuthorizedStaffWaitlistContent onSignOut={staff.signOut} session={staff.session}>
        {children}
      </AuthorizedStaffWaitlistContent>
    );
  }

  if (admin.status === "loading" || staff.status === "loading") {
    return <div className="admin-auth-loading" aria-busy="true" />;
  }

  if (admin.status === "signed-out" && staff.status === "signed-out") {
    return <AccessState status="signed-out" />;
  }

  return <AccessState status="denied" />;
}

function E2EAdminGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "signed-out" }
    | { status: "denied" }
    | { status: "authorized"; role: Extract<AdminRole, "owner" | "administrator"> }
  >({ status: "loading" });

  useEffect(() => {
    const role = new URLSearchParams(window.location.search).get("adminTestRole");

    if (!isAdminTestRole(role)) {
      startTransition(() => setState({ status: "signed-out" }));
      return;
    }

    if (role !== "owner" && role !== "administrator") {
      startTransition(() => setState({ status: "denied" }));
      return;
    }

    startTransition(() => setState({ status: "authorized", role }));
  }, []);

  if (state.status === "authorized") {
    return (
      <AuthorizedAdminContent session={adminSessionForTestRole(state.role)}>
        {children}
      </AuthorizedAdminContent>
    );
  }

  if (state.status === "signed-out" || state.status === "denied") {
    return <AccessState status={state.status} />;
  }

  return <div className="admin-auth-loading" aria-busy="true" />;
}

export function AdminGate({ children }: { children: ReactNode }) {
  if (isAdminE2EEnabled()) {
    return <E2EAdminGate>{children}</E2EAdminGate>;
  }

  return (
    <AdminAuthProvider>
      <StaffAuthProvider>
        <FirebaseAdminGate>{children}</FirebaseAdminGate>
      </StaffAuthProvider>
    </AdminAuthProvider>
  );
}

export function useAdminGateSession(): AdminSession {
  const session = useContext(AdminGateSessionContext);

  if (!session) {
    throw new Error("useAdminGateSession must be used inside an authorized AdminGate.");
  }

  return session;
}

export function useAdminOrStaffSession(): AdminSession | StaffSession {
  const session = useContext(AdminGateAnySessionContext);

  if (!session) {
    throw new Error("useAdminOrStaffSession must be used inside an authorized AdminGate.");
  }

  return session;
}
export function useWaitlistIssuePermission(): boolean {
  const canIssue = useContext(WaitlistIssuePermissionContext);
  if (canIssue === undefined) {
    throw new Error("useWaitlistIssuePermission must be used inside an authorized AdminGate.");
  }
  return canIssue;
}
