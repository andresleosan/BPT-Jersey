"use client";

import { useAdminOrStaffSession } from "../../admin-gate";
import { MigrationQueue } from "./migration-queue";
import "../../admin.css";

export default function MemberMigrationPage() {
  const session = useAdminOrStaffSession();
  if (session.role !== "owner" && session.role !== "administrator") {
    return <p className="member-record-hint">Only the office can review the member migration.</p>;
  }
  return <MigrationQueue />;
}
