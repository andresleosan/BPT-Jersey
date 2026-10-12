import type { Metadata } from "next";
import Image from "next/image";

import { AuthAction } from "./auth-action";

import "../../admin/admin.css";

// The links in Firebase Auth emails land here with a one-time code in the address: keep the page
// out of search results and keep the code out of Referer headers.
export const metadata: Metadata = {
  title: "Account link",
  description: "Finish a password reset or an email change for your BPT Jersey account.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function AuthActionPage() {
  return (
    <main className="login-page" id="main-content">
      <a className="skip-link login-skip-link" href="#auth-action">
        Skip to account link
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
          <p className="login-intro-label">Brazilian Jiu-Jitsu Academy</p>
          <p className="login-intro-note">Finish the step from the email we sent you.</p>
        </div>
        <div className="login-panel">
          <a className="login-home-link" href="/">
            Home
          </a>
          <AuthAction />
        </div>
      </div>
    </main>
  );
}
