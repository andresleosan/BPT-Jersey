"use client";

import Link from "next/link";

import { ClientAuthGate, ClientAuthProvider } from "../../../lib/client-auth";

import "../account.css";

/**
 * Account settings (T044V2). Phase 0 reserves the route and the header link; the settings team
 * replaces this body with the adult form, the minor's photo change with guardian approval, and the
 * teen access grant (T009V2).
 */
function SettingsContent() {
  return (
    <main className="client-destination" aria-labelledby="settings-title">
      <p className="account-eyebrow">
        <Link href="/account">← Back to Account</Link>
      </p>
      <h1 id="settings-title">Account settings</h1>
      <p className="client-destination-intro">Coming soon.</p>
    </main>
  );
}

export default function AccountSettingsPage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate returnPath="/account/settings">
        <SettingsContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
