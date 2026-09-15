"use client";

import { useMemo } from "react";

import { createCalendarRepository, type CalendarRole } from "../../lib/calendar";
import { ClientAuthGate, ClientAuthProvider, useClientSession } from "../../lib/client-auth";
import { requireClientSession } from "../../lib/login-flow";
import { MemberCalendar } from "./calendar/member-calendar";
import { StreakPanel } from "./streak/streak-panel";

import "./account.css";

function calendarRole(role: string | undefined): CalendarRole | undefined {
  return role === "guardian" || role === "adultStudent" || role === "teenStudent"
    ? role
    : undefined;
}

function AccountContent() {
  const { session, signOut } = useClientSession();
  const role = calendarRole(session?.role);
  const displayName = session?.displayName || "Member";
  const repository = useMemo(
    () => (role ? createCalendarRepository({ role, displayName }) : undefined),
    [role, displayName],
  );

  if (!session || !role || !repository) {
    return null;
  }

  async function handleSignOut(): Promise<void> {
    await signOut();
    window.location.assign(requireClientSession("/account").loginPath);
  }

  return (
    <MemberCalendar
      onSignOut={() => void handleSignOut()}
      repository={repository}
      session={{ role, displayName }}
      topSlot={<StreakPanel />}
    />
  );
}

export default function AccountPage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate returnPath="/account">
        <AccountContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
