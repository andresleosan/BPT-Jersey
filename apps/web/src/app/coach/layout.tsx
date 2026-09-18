"use client";

import type { ReactNode } from "react";
import { StaffAuthProvider, StaffAuthGate, useStaffSession } from "../../lib/staff-auth";
import { AdminShell } from "../admin/admin-shell";
import "./coach.css";

function CoachWorkspace({ children }: { children: ReactNode }) {
  const { session, signOut } = useStaffSession();
  return session ? (
    <AdminShell session={session} onSignOut={signOut}>
      {children}
    </AdminShell>
  ) : null;
}

export default function CoachLayout({ children }: { children: ReactNode }) {
  return (
    <StaffAuthProvider>
      <StaffAuthGate returnPath="/coach">
        <CoachWorkspace>{children}</CoachWorkspace>
      </StaffAuthGate>
    </StaffAuthProvider>
  );
}
