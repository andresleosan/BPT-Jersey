"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * The section has no landing page of its own: it opens on the tab the office works from. Static
 * export rules out a redirect on the server, so the move happens in the browser.
 */
export default function ClassesServicesIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/classes-services/classes");
  }, [router]);

  return <p className="cs-placeholder">Opening Classes &amp; Services…</p>;
}
