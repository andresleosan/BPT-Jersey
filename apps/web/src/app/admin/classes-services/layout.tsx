"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useAdminOrStaffSession } from "../admin-gate";
import { classesServicesTabs } from "./classes-services-tabs";

import "../admin.css";
import "./classes-services.css";

const panelId = "classes-services-panel";

export default function ClassesServicesLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const session = useAdminOrStaffSession();
  const isStaff = session.role === "coach" || session.role === "headCoach";
  const tabs = classesServicesTabs.filter((tab) => !isStaff || tab.staffVisible);

  return (
    <div className="cs-page">
      <p className="admin-eyebrow">BPT Jersey / Classes &amp; Services</p>
      {/* The shell header already owns the page h1 ("Academy control room"). */}
      <h2 className="cs-title">Classes / Services</h2>
      <nav aria-label="Classes / Services sections" className="cs-tabs">
        <ul role="tablist">
          {tabs.map((tab) => {
            const current = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            return (
              <li key={tab.href} role="presentation">
                <Link
                  aria-controls={panelId}
                  aria-current={current ? "page" : undefined}
                  aria-selected={current}
                  href={tab.href}
                  role="tab"
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <section className="cs-panel" id={panelId} role="tabpanel">
        {children}
      </section>
    </div>
  );
}
