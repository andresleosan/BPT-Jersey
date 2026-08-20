"use client";

import { ClientAuthGate, ClientAuthProvider, useClientSession } from "../../lib/client-auth";
import { requireClientSession } from "../../lib/login-flow";

function AccountContent() {
  const { session, signOut } = useClientSession();

  if (!session) {
    return null;
  }

  async function handleSignOut(): Promise<void> {
    await signOut();
    window.location.assign(requireClientSession("/account").loginPath);
  }

  return (
    <main className="client-destination" aria-labelledby="account-title">
      <p className="account-eyebrow">BPT Jersey / Client</p>
      <h1 id="account-title">Your account</h1>
      <p className="client-destination-intro">
        Your authenticated client area is ready for account and progress features as they are added.
      </p>
      <a className="button button-primary profile-account-link" href="/account/profile">
        Complete your profile
      </a>
      <a className="button button-secondary profile-account-link" href="/account/family">
        View your family
      </a>
      <dl className="client-identity">
        <div>
          <dt>Name</dt>
          <dd>{session.displayName || "Client account"}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{session.email}</dd>
        </div>
      </dl>
      <button
        className="button button-secondary client-signout"
        onClick={() => void handleSignOut()}
        type="button"
      >
        Sign out
      </button>
    </main>
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
