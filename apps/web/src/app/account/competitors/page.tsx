"use client";

import Link from "next/link";

import { ClientAuthGate, ClientAuthProvider } from "../../../lib/client-auth";

import "../account.css";

/**
 * Competitors (T043V2). Phase 0 reserves the route and the header link; the competitors team
 * replaces this body with the two tables (attendance, belt progression) served by their callable.
 */
function CompetitorsContent() {
  return (
    <main className="client-destination" aria-labelledby="competitors-title">
      <p className="account-eyebrow">
        <Link href="/account">← Back to Account</Link>
      </p>
      <h1 className="member-title-compact" id="competitors-title">
        Competitors
      </h1>
      <p className="client-destination-intro">Coming soon.</p>
    </main>
  );
}

export default function AccountCompetitorsPage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate returnPath="/account/competitors">
        <CompetitorsContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
