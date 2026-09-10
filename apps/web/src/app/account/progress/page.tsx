"use client";

import Link from "next/link";
import { ClientAuthGate, ClientAuthProvider, useClientSession } from "../../../lib/client-auth";
import { LevelsBrowser } from "../../levels/levels-browser";
import { FamilyProgressPanel } from "./family-progress";
import { OwnProgressPanel } from "./own-progress";

function ProgressContent() {
  const { session } = useClientSession();

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

      {/*
        Connected progress; no synthetic peers, no minor comparison. A guardian account has no
        student record of its own, so it sees each linked child instead of an own-progress panel.
      */}
      <div style={{ marginBottom: "2rem" }}>
        {session?.role === "guardian" ? <FamilyProgressPanel /> : <OwnProgressPanel />}
      </div>

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
