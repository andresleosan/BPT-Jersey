import type { Metadata } from "next";
import { RecoveryForm } from "./recovery-form";
import "../../admin/admin.css";
import "./recovery.css";
export const metadata: Metadata = {
  title: "Recover member access",
  description: "Recover access to your existing BPT Jersey membership.",
};
export default function MemberRecoveryPage() {
  return (
    <main className="login-page" id="main-content">
      <div className="recovery-layout">
        <div className="login-panel">
          <a className="login-home-link" href="/">
            BPT Jersey / Home
          </a>
          <RecoveryForm />
        </div>
      </div>
    </main>
  );
}
