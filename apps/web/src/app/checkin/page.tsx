"use client";

import { useEffect } from "react";

import { ClientAuthGate, ClientAuthProvider } from "../../lib/client-auth";

/** The URL on the door's NFC tag and QR code: sign in if needed, then check in from /account. */
function GoToCheckIn() {
  useEffect(() => {
    window.location.replace("/account?checkin");
  }, []);
  return <div className="client-auth-loading" aria-busy="true" />;
}

export default function CheckInPage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate returnPath="/checkin">
        <GoToCheckIn />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
