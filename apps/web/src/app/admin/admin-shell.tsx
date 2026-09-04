"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { AdminSession } from "../../lib/admin-auth";
import type { StaffSession } from "../../lib/staff-auth";
import { AdminIcon } from "./admin-icons";

import "./admin.css";

const navigationItems = [
  { label: "Overview", href: "/admin" },
  { label: "Members", href: "/admin/members" },
  { label: "Memberships", href: "/admin/memberships" },
  { label: "Families", href: "/admin/families" },
  { label: "Waivers", href: "/admin/waivers" },
  { label: "Classes", href: "/admin/classes" },
  { label: "Activities", href: "/admin/activities" },
  { label: "Class waitlists", href: "/admin/waitlists" },
  { label: "Attendance", href: "/admin/attendance" },
  { label: "Reports", href: "/admin/reports" },
  { label: "CRM", href: "/admin/crm" },
  { label: "Retention", href: "/admin/retention" },
  { label: "Finance", href: "/admin/finance" },
  { label: "Billing", href: "/admin/billing" },
  { label: "Regyfit Access Records", href: "/admin/regyfit-access-records" },
  { label: "Staff", href: "/admin/staff" },
  { label: "Levels", href: "/admin/levels" },
  { label: "Lesson plans", href: "/admin/lesson-plans" },
] as const;

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
  const roleLabel =
    session.role === "owner"
      ? "Owner access"
      : session.role === "administrator"
        ? "Administrator access"
        : session.role === "headCoach"
          ? "Head coach operational access"
          : "Coach attendance access";
  const visibleNavigationItems =
    session.role === "headCoach"
      ? navigationItems.filter(
          (item) =>
            item.href === "/admin/classes" ||
            item.href === "/admin/attendance" ||
            item.href === "/admin/waitlists" ||
            item.href === "/admin/lesson-plans",
        )
      : session.role === "coach"
        ? navigationItems.filter(
            (item) =>
              item.href === "/admin/attendance" ||
              item.href === "/admin/waitlists" ||
              item.href === "/admin/lesson-plans",
          )
        : navigationItems;
  const [navigationOpen, setNavigationOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const navigationInitializedRef = useRef(false);

  function isCurrentRoute(href: string): boolean {
    return href === "/admin"
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);
  }

  function closeNavigation(): void {
    setNavigationOpen(false);
  }

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
      <nav aria-label="Admin navigation" className={className}>
        <ul className="admin-nav-list">
          {visibleNavigationItems.map((item) => (
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
      </nav>
    );
  }

  return (
    <>
      <a className="skip-link" href="#admin-main-content">
        Skip to main content
      </a>

      <div className="admin-shell" data-testid="admin-shell">
        <aside className="admin-sidebar" aria-label="Administrative navigation">
          <Link className="admin-brand" href="/" aria-label="BPT Jersey home">
            <Image
              alt="BPT Jersey logo"
              className="admin-logo"
              height={112}
              src="/bpt-jersey-logo.png"
              width={168}
            />
            <span className="admin-brand-mark">BPT</span>
            <span className="admin-brand-name">Jersey</span>
          </Link>

          <div className="admin-sidebar-heading">
            <p className="admin-sidebar-kicker">Private workspace</p>
            <p className="admin-sidebar-title">Run the day clearly.</p>
          </div>

          {renderNavigation("admin-desktop-navigation")}

          <div className="admin-sidebar-footer">
            <p className="admin-sidebar-kicker">Current access</p>
            <p className="admin-role">{roleLabel}</p>
            <p className="admin-sidebar-note">Synthetic preview / connected sources protected.</p>
          </div>
        </aside>

        <div className="admin-workspace">
          <header className="admin-header">
            <button
              aria-controls="admin-mobile-navigation"
              aria-expanded={navigationOpen}
              aria-label={navigationOpen ? "Close admin navigation" : "Open admin navigation"}
              className="admin-mobile-menu-button"
              onClick={() => setNavigationOpen((open) => !open)}
              ref={menuButtonRef}
              type="button"
            >
              <AdminIcon
                name={navigationOpen ? "close" : "menu"}
                height="1.25rem"
                width="1.25rem"
              />
            </button>
            <div className="admin-header-title">
              <p className="admin-header-kicker">BPT Jersey / Admin</p>
              <h1>Academy control room</h1>
            </div>
            <div className="admin-header-actions">
              <p className="admin-header-status">
                <span className="admin-status-dot" aria-hidden="true" />
                Authenticated shell - {roleLabel}
              </p>
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
                aria-label="Dismiss admin navigation"
                className="admin-mobile-backdrop"
                onClick={closeNavigation}
                type="button"
              />
              <div
                aria-label="Admin navigation"
                aria-modal="true"
                className="admin-mobile-navigation"
                id="admin-mobile-navigation"
                onKeyDown={handleNavigationKeyDown}
                ref={navigationRef}
                role="dialog"
              >
                <div className="admin-mobile-navigation-header">
                  <Image
                    alt="BPT Jersey mobile logo"
                    height={56}
                    src="/bpt-jersey-logo.png"
                    width={84}
                  />
                  <div>
                    <strong>BPT Jersey</strong>
                    <span>
                      {visibleNavigationItems.find((item) => isCurrentRoute(item.href))?.label}
                    </span>
                  </div>
                  <button
                    aria-expanded="true"
                    aria-label="Close admin navigation"
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
