"use client";

import Link from "next/link";
import { ClientAuthGate, ClientAuthProvider } from "../../../lib/client-auth";
import { LevelsBrowser } from "../../levels/levels-browser";

function ProgressContent() {
  return (
    <main className="client-destination" aria-labelledby="progress-title">
      <p className="account-eyebrow">
        <Link href="/account">← Back to Account</Link>
      </p>
      <h1 id="progress-title">IBJJF Progression & Belt Requirements</h1>
      <p className="client-destination-intro">
        Explore the official IBJJF belt graduation system, age brackets, minimum attendance, and
        technical requirements.
      </p>
      <LevelsBrowser roleContext="client" />
    </main>
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
