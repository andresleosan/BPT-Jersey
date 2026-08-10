import type { Metadata } from "next";
import Image from "next/image";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Account access",
  description: "Sign in to your BPT Jersey client or administrator account.",
};

export default function LoginPage() {
  return (
    <main className="login-page" id="main-content">
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
          <p className="login-intro-label">One academy. One clear system.</p>
          <p className="login-intro-note">Choose the place you need to go, then sign in.</p>
        </div>
        <div className="login-panel">
          <a className="login-home-link" href="/">
            Home
          </a>
          <LoginForm initialRole="client" />
        </div>
      </div>
    </main>
  );
}
