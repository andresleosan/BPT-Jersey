"use client";

import { ClientAuthGate, ClientAuthProvider } from "../../../lib/client-auth";
import { MemberProgress } from "./member-progress";

function ProgressContent() {
  // Only the people this account trains as: no catalogue of every belt, no other members.
  return <MemberProgress />;
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
