import type { Metadata } from "next";
import Image from "next/image";

import { LoginForm } from "../../login/login-form";

import "../../admin/admin.css";

// The staff entrance is reached by URL only: nothing on the public site links here and search
// engines are told not to index it. Access itself is still decided by the account's claims.
export const metadata: Metadata = {
  title: "Staff sign-in",
  description: "Sign in for BPT Jersey coaches and office staff.",
  robots: { index: false, follow: false, nocache: true },
};

export default function StaffLoginPage() {
  return (
    <main className="login-page login-page-staff" id="main-content">
      <a className="skip-link login-skip-link" href="#login-form">
        Skip to login form
      </a>
      <div className="login-layout">
        <div className="login-intro">
          <div className="login-brand">
            <Image
              alt="BPT Jersey logo"
              className="login-logo"
              height={280}
              src="/bpt-jersey-logo.png"
              width={420}
            />
            <p className="login-mark">BPT / Jersey</p>
          </div>
          <p className="login-intro-label">Academy team workspace</p>
          <p className="login-intro-note">
            For BPT Jersey coaches and office staff. Members sign in from the home page.
          </p>
        </div>
        <div className="login-panel">
          <a className="login-home-link" href="/">
            Home
          </a>
          <LoginForm audience="staff" />
        </div>
      </div>
    </main>
  );
}
