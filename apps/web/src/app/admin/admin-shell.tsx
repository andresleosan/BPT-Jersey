import type { ReactNode } from "react";
import Image from "next/image";

import type { AdminSession } from "../../lib/admin-auth";

import "./admin.css";

const navigationItems = [
  { label: "Overview", href: "#overview" },
  { label: "Members", href: "#members" },
  { label: "Attendance", href: "#attendance" },
  { label: "Reports", href: "#reports" },
  { label: "CRM", href: "#crm" },
  { label: "Finance", href: "#finance" },
  { label: "Regyfit Access Records", href: "#regyfit-access-records" },
] as const;

export function AdminShell({
  children,
  onSignOut,
  session,
}: {
  children: ReactNode;
  onSignOut?: () => Promise<void>;
  session: AdminSession;
}) {
  const roleLabel = session.role === "owner" ? "Owner access" : "Administrator access";

  return (
    <>
      <a className="skip-link" href="#admin-main-content">
        Skip to main content
      </a>

      <div className="admin-shell" data-testid="admin-shell">
        <aside className="admin-sidebar" aria-label="Administrative navigation">
          <a className="admin-brand" href="/" aria-label="BPT Jersey home">
            <Image
              alt="BPT Jersey logo"
              className="admin-logo"
              height={112}
              src="/bpt-jersey-logo.png"
              width={168}
            />
            <span className="admin-brand-mark">BPT</span>
            <span className="admin-brand-name">Jersey</span>
          </a>

          <div className="admin-sidebar-heading">
            <p className="admin-sidebar-kicker">Private workspace</p>
            <p className="admin-sidebar-title">Run the day clearly.</p>
          </div>

          <nav aria-label="Admin navigation">
            <ul className="admin-nav-list">
              {navigationItems.map((item) => (
                <li key={item.label}>
                  <a href={item.href} aria-current={item.label === "Overview" ? "page" : undefined}>
                    <span aria-hidden="true">-&gt;</span>
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="admin-sidebar-footer">
            <p className="admin-sidebar-kicker">Current access</p>
            <p className="admin-role">{roleLabel}</p>
            <p className="admin-sidebar-note">Data surfaces remain empty until imported.</p>
          </div>
        </aside>

        <div className="admin-workspace">
          <header className="admin-header">
            <div>
              <p className="admin-header-kicker">BPT Jersey / Admin</p>
              <h1>Academy control room</h1>
            </div>
            <div className="admin-header-actions">
              <p className="admin-header-status">
                <span className="admin-status-dot" aria-hidden="true" />
                Authenticated shell
              </p>
              <a className="admin-home-link" href="/">
                Home
              </a>
              {onSignOut ? (
                <button className="admin-signout" onClick={() => void onSignOut()} type="button">
                  Sign out
                </button>
              ) : null}
            </div>
          </header>

          <main className="admin-main admin-main-content" id="admin-main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
