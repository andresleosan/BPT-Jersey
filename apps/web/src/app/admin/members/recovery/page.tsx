"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MemberRecoveryQueuePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/members/requests#member-recovery");
  }, [router]);
  return (
    <p role="status">
      Opening Enrolment requests…{" "}
      <a href="/admin/members/requests#member-recovery">Continue to member recovery</a>
    </p>
  );
}
