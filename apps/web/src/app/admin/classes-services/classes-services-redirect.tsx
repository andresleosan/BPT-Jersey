"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import "./classes-services.css";

/**
 * Neither the section index nor the legacy /admin/classes route has a page of its own: both open the
 * tab the office works from. Static export rules out a redirect on the server, so the move happens in
 * the browser, and both routes share this component so they show the same interim card.
 */
export function ClassesServicesRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/classes-services/classes");
  }, [router]);

  return <p className="cs-placeholder">Opening Classes &amp; Services…</p>;
}
