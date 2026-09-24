"use client";

import { useMemo } from "react";

import { createCalendarRepository, type CalendarRole } from "../../lib/calendar";
import { ClientAuthGate, ClientAuthProvider, useClientSession } from "../../lib/client-auth";
import { requireClientSession } from "../../lib/login-flow";
import { AdultClaimGate } from "./adult-claim";
import { MemberCalendar } from "./calendar/member-calendar";
import { IntroNotices } from "./intro-notices";
import { StreakPanel } from "./streak/streak-panel";
import { PendingTermsBanner, WaiverGate } from "./waiver-acceptance";
import { clearCalendarCache } from "../../lib/calendar/calendar-cache";

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
    clearCalendarCache(session!.uid);
    await signOut();
    window.location.assign(requireClientSession("/account").loginPath);
  }

  return (
    <AdultClaimGate>
      <WaiverGate>
        {(gate, track) => (
          <MemberCalendar
            cacheKey={session.uid}
            onSignOut={() => void handleSignOut()}
            repository={repository}
            session={{ role, displayName }}
            gate={gate}
            onParticipants={track}
            topSlot={(studentId) => (
              <>
                <IntroNotices />
                <PendingTermsBanner studentId={studentId} />
                <StreakPanel key={studentId} studentId={studentId} />
              </>
            )}
          />
        )}
      </WaiverGate>
    </AdultClaimGate>
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
