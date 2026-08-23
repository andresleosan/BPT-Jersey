"use client";

import type { ReactNode } from "react";
import { StaffAuthProvider, StaffAuthGate, useStaffSession } from "../../lib/staff-auth";
import "../admin/admin.css";

function CoachHeader() {
  const { session, signOut } = useStaffSession();

  if (!session) return null;

  return (
    <header className="admin-header" role="banner">
      <div className="admin-brand">
        <span className="admin-brand-title">BPT Jersey / Coach Portal</span>
      </div>
      <div className="admin-user-nav">
        <span className="admin-user-name">
          {session.displayName || session.email} ({session.role})
        </span>
        <button
          type="button"
          className="button button-secondary text-sm"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

export default function CoachLayout({ children }: { children: ReactNode }) {
  return (
    <StaffAuthProvider>
      <StaffAuthGate returnPath="/coach/levels">
        <div className="admin-shell">
          <CoachHeader />
          <main className="admin-content" role="main">
            {children}
          </main>
        </div>
      </StaffAuthGate>
    </StaffAuthProvider>
  );
}
