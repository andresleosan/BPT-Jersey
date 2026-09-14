"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Billing is the finance home since 2026-09-14; this route only forwards old links. */
export default function FinanceRoute() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/billing");
  }, [router]);
  return (
    <p className="admin-empty-state">
      Finance moved.{" "}
      <Link className="admin-text-link" href="/admin/billing">
        Go to Billing
      </Link>
    </p>
  );
}
