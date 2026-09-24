"use client";

import { ClientAuthGate, ClientAuthProvider, useClientSession } from "../../../lib/client-auth";
import { MemberProgress } from "./member-progress";
import { RecoveredMemberHistory } from "./recovered-history";

function ProgressContent() {
  const { session } = useClientSession();
  // Only the people this account trains as: no catalogue of every belt, no other members.
  return (
    <MemberProgress guardian={session?.role === "guardian"}>
      {session?.role === "adultStudent" ? <RecoveredMemberHistory /> : null}
    </MemberProgress>
  );
}

export default function AccountProgressPage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate returnPath="/account/progress">
        <ProgressContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
