"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { AdminSession } from "../../lib/admin-auth";
import type { StaffSession } from "../../lib/staff-auth";
import { AdminIcon } from "./admin-icons";
import { staffRoutes } from "./admin-routes";

import "./admin.css";

type NavigationItem = Readonly<{
  label: string;
  href: string;
  ownerOnly?: boolean;
  /** Shown to the mat only: the office reaches the same task from the unified Members page. */
  staffOnly?: boolean;
}>;
type NavigationGroup = Readonly<{ label: string; items: readonly NavigationItem[] }>;

/** Owners can reach every implemented administrative module without a member subscription.
 * Other roles retain their existing navigation and server-side restrictions.
 */
const navigationGroups: readonly NavigationGroup[] = [
  {
    label: "Today",
    items: [
      { label: "Overview", href: "/admin" },
      { label: "Attendance", href: "/admin/attendance" },
    ],
  },
  {
    label: "People",
    items: [
      { label: "Members", href: "/admin/members" },
      { label: "Member search", href: "/admin/members/search", staffOnly: true },
      { label: "Memberships", href: "/admin/memberships" },
      { label: "Enrolment requests", href: "/admin/members/requests" },
    ],
  },
  {
    label: "Mat",
    items: [
      { label: "Classes / Services", href: "/admin/classes-services" },
      { label: "Courses & seminars", href: "/admin/courses" },
      { label: "Levels", href: "/admin/levels" },
      { label: "Waitlists", href: "/admin/waitlists", ownerOnly: true },
    ],
  },
  {
    label: "Money",
    items: [
      { label: "Billing", href: "/admin/billing" },
      { label: "Financial dashboard", href: "/admin/finance", ownerOnly: true },
      { label: "Shop", href: "/admin/shop" },
    ],
  },
  {
    label: "Setup",
    items: [
      { label: "Staff", href: "/admin/staff" },
      { label: "Reports", href: "/admin/reports" },
      { label: "Waivers and disclaimers", href: "/admin/waivers", ownerOnly: true },
    ],
  },
];

/** The mat's own pages. The syllabus is the read-only /admin/levels (T13). */
const coachNavigationItems: readonly NavigationItem[] = [
  { label: "Dashboard", href: "/coach" },
  { label: "Progression syllabus", href: "/admin/levels" },
  { label: "My sign-in", href: "/coach/access" },
];

const sidebarStorageKey = "bpt-admin-sidebar";

/** The desktop sidebar is open unless this browser last closed it. Storage can be blocked. */
function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(sidebarStorageKey) === "collapsed";
  } catch {
    return false;
  }
}

function storeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(sidebarStorageKey, collapsed ? "collapsed" : "open");
  } catch {
    // The choice then lasts only for this page view.
  }
}

function isStaffRole(
  role: AdminSession["role"] | StaffSession["role"],
): role is StaffSession["role"] {
  return role === "headCoach" || role === "coach";
}

export function AdminShell({
  children,
  onSignOut,
  session,
}: {
  children: ReactNode;
  onSignOut?: () => Promise<void>;
  session: AdminSession | StaffSession;
}) {
  const pathname = usePathname() ?? "";
  const coachWorkspace = isStaffRole(session.role);
  const roleLabel =
    session.role === "owner"
      ? "Owner access"
      : session.role === "administrator"
        ? "Administrator access"
        : session.role === "headCoach"
          ? "Head coach operational access"
          : "Coach operational access";
  /**
   * The name can arrive empty, and that is not hypothetical: `admin-auth` stores
   * `user.displayName?.trim() ?? ""`, and production has an administrative account with no
   * `displayName` - the password-provider one. When it is missing the email takes the name line
   * instead of leaving a gap, and is not repeated underneath.
   */
  const personName = session.displayName.trim();
  const allowedRoutes = isStaffRole(session.role) ? staffRoutes[session.role] : undefined;
  const visibleGroups = navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (!item.ownerOnly || session.role === "owner") &&
          (!item.staffOnly || allowedRoutes !== undefined) &&
          (allowedRoutes === undefined || allowedRoutes.includes(item.href)) &&
          // The coach group already names these pages, so no other group repeats them (T13).
          !(coachWorkspace && coachNavigationItems.some((coach) => coach.href === item.href)),
      ),
    }))
    .filter((group) => group.items.length > 0);
  if (coachWorkspace) {
    visibleGroups.unshift({ label: "Coach", items: [...coachNavigationItems] });
  }
  const navigationLabel = coachWorkspace ? "Coach navigation" : "Admin navigation";
  const visibleNavigationItems = visibleGroups.flatMap((group) => group.items);
  const [navigationOpen, setNavigationOpen] = useState(false);
  // The shell only mounts after the client has a session, so storage is readable on first render.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const navigationInitializedRef = useRef(false);

  function isCurrentRoute(href: string): boolean {
    return href === "/admin" || href === "/coach"
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);
  }

  function closeNavigation(): void {
    setNavigationOpen(false);
  }

  function toggleSidebar(): void {
    const collapsed = !sidebarCollapsed;
    setSidebarCollapsed(collapsed);
    storeSidebarCollapsed(collapsed);
  }

  const workspaceName = coachWorkspace ? "coach" : "admin";

  useEffect(() => {
    if (!navigationInitializedRef.current) {
      navigationInitializedRef.current = true;
      return;
    }

    if (navigationOpen) {
      closeButtonRef.current?.focus();
    } else if (menuButtonRef.current) {
      menuButtonRef.current.focus();
    }
  }, [navigationOpen]);

  useEffect(() => {
    if (!navigationOpen) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") closeNavigation();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigationOpen]);

  function handleNavigationKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Tab") return;

    const focusableElements = Array.from(
      navigationRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (!firstElement || !lastElement) return;
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  useEffect(() => {
    if (!navigationOpen) return;

    function keepFocusInsideNavigation(event: FocusEvent): void {
      const target = event.target;
      if (target instanceof Node && !navigationRef.current?.contains(target)) {
        closeButtonRef.current?.focus();
      }
    }

    document.addEventListener("focusin", keepFocusInsideNavigation);
    return () => document.removeEventListener("focusin", keepFocusInsideNavigation);
  }, [navigationOpen]);

  function renderNavigation(className: string) {
    return (
      <nav aria-label={navigationLabel} className={className}>
        {visibleGroups.map((group) => (
          <div className="admin-nav-group" key={group.label}>
            <p aria-hidden="true" className="admin-nav-group-label">
              {group.label}
            </p>
            <ul aria-label={group.label} className="admin-nav-list">
              {group.items.map((item) => (
                <li key={item.label}>
                  <Link
                    aria-current={isCurrentRoute(item.href) ? "page" : undefined}
                    href={item.href}
                    onClick={closeNavigation}
                  >
                    <span aria-hidden="true">-&gt;</span>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    );
  }

  return (
    <>
      <a className="skip-link" href="#admin-main-content">
        Skip to main content
      </a>

      <div
        className="admin-shell"
        data-sidebar={sidebarCollapsed ? "collapsed" : "open"}
        data-testid="admin-shell"
      >
        <aside className="admin-sidebar" aria-label={navigationLabel}>
          <div className="admin-brand">
            <button
              aria-controls="admin-sidebar-panel"
              aria-expanded={!sidebarCollapsed}
              aria-label={`${sidebarCollapsed ? "Show" : "Hide"} ${workspaceName} navigation`}
              className="admin-logo-button"
              onClick={toggleSidebar}
              type="button"
            >
              <Image
                alt=""
                className="admin-logo"
                height={112}
                src="/bpt-jersey-logo.png"
                width={168}
              />
            </button>
            <span className="admin-brand-mark">BPT</span>
            <span className="admin-brand-name">Jersey</span>
          </div>

          <div className="admin-sidebar-panel" hidden={sidebarCollapsed} id="admin-sidebar-panel">
            <div className="admin-sidebar-heading">
              <p className="admin-sidebar-kicker">Private workspace</p>
              <p className="admin-sidebar-title">Run the day clearly.</p>
            </div>

            {renderNavigation("admin-desktop-navigation")}

            <div className="admin-sidebar-footer">
              <p className="admin-sidebar-kicker">Current access</p>
              <p className="admin-role">{roleLabel}</p>
              <p className="admin-sidebar-note">
                Every change here is recorded with who made it and when.
              </p>
            </div>
          </div>
        </aside>

        <div className="admin-workspace">
          <header className="admin-header">
            <button
              aria-controls="admin-mobile-navigation"
              aria-expanded={navigationOpen}
              aria-label={`${navigationOpen ? "Close" : "Open"} ${workspaceName} navigation`}
              className="admin-mobile-menu-button"
              onClick={() => setNavigationOpen((open) => !open)}
              ref={menuButtonRef}
              type="button"
            >
              <Image alt="" height={56} src="/bpt-jersey-logo.png" width={84} />
            </button>
            <div className="admin-header-title">
              <p className="admin-header-kicker">
                BPT Jersey / {coachWorkspace ? "Coach" : "Admin"}
              </p>
              <h1>{coachWorkspace ? "Coach workspace" : "Academy control room"}</h1>
            </div>
            <div className="admin-header-actions">
              <p className="admin-header-status">
                <span className="admin-status-dot" aria-hidden="true" />
                <span className="admin-identity" data-testid="admin-identity">
                  <span className="admin-identity-name">
                    {personName || session.email || "Coach"}
                  </span>
                  <span className="admin-identity-meta">
                    {personName && session.email ? `${roleLabel} - ${session.email}` : roleLabel}
                  </span>
                </span>
              </p>
              <Link className="admin-home-link" href="/account/courses">
                My courses
              </Link>
              <Link className="admin-home-link" href="/">
                Home
              </Link>
              {onSignOut ? (
                <button className="admin-signout" onClick={() => void onSignOut()} type="button">
                  Sign out
                </button>
              ) : null}
            </div>
          </header>

          {navigationOpen ? (
            <>
              <button
                aria-label={`Dismiss ${workspaceName} navigation`}
                className="admin-mobile-backdrop"
                onClick={closeNavigation}
                type="button"
              />
              <div
                aria-label={navigationLabel}
                aria-modal="true"
                className="admin-mobile-navigation"
                id="admin-mobile-navigation"
                onKeyDown={handleNavigationKeyDown}
                ref={navigationRef}
                role="dialog"
              >
                <div className="admin-mobile-navigation-header">
                  <div>
                    <strong>BPT Jersey</strong>
                    <span>
                      {visibleNavigationItems.find((item) => isCurrentRoute(item.href))?.label}
                    </span>
                  </div>
                  <button
                    aria-expanded="true"
                    aria-label={`Close ${workspaceName} navigation`}
                    className="admin-mobile-close-button"
                    onClick={closeNavigation}
                    ref={closeButtonRef}
                    type="button"
                  >
                    <AdminIcon name="close" height="1.25rem" width="1.25rem" />
                  </button>
                </div>
                {renderNavigation("admin-mobile-navigation-links")}
              </div>
            </>
          ) : null}

          <main className="admin-main admin-main-content" id="admin-main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
