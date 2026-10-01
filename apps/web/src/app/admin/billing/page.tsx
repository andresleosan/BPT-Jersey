"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** The Financial dashboard is the finance home since 2026-10-01; this route only forwards old links. */
export default function BillingRoute() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/admin/finance${window.location.search}`);
  }, [router]);
  return (
    <p className="admin-empty-state">
      Billing moved.{" "}
      <Link className="admin-text-link" href="/admin/finance">
        Go to the Financial dashboard
      </Link>
    </p>
  );
}
