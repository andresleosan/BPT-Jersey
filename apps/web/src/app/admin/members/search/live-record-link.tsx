"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { resolveImportedSubscription } from "../../../../lib/subscription-admin-client";

export function LiveRecordLink({ recordId }: { recordId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "unresolved" | "error">("idle");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function open() {
    setState("loading");
    try {
      const result = await resolveImportedSubscription(recordId);
      if (!active.current) return;
      if (result.studentId === null) setState("unresolved");
      else router.push(`/admin/members/profile?${new URLSearchParams({ id: result.studentId })}`);
    } catch {
      if (active.current) setState("error");
    }
  }
  return (
    <div className="member-record-notice">
      <p>This is the imported archive. Live activity belongs to the linked member record.</p>
      <button
        className="member-record-button"
        type="button"
        disabled={state === "loading"}
        onClick={() => void open()}
      >
        Open live record
      </button>
      {state === "loading" ? <p role="status">Finding live record…</p> : null}
      {state === "error" ? (
        <p role="alert">
          Unable to resolve this live record. Please try again. If this continues, ask the office to
          check the link and your access.
        </p>
      ) : null}
      {state === "unresolved" ? (
        <>
          <p role="status">
            Live record not linked yet. Review member migration or find an existing member before
            creating a record.
          </p>
          <Link className="member-record-link" href="/admin/members/migration">
            Review member migration
          </Link>
          {" · "}
          <Link className="member-record-link" href="/admin/members">
            Find an existing member
          </Link>
        </>
      ) : null}
    </div>
  );
}
