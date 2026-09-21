import type { EnrolmentStatus } from "@bpt-jersey/domain/courses";

// DESIGN.md §2: status is always text plus a coloured left rule, never colour alone.
const presentation: Record<
  EnrolmentStatus,
  readonly [string, "confirmed" | "attention" | "refused" | "neutral"]
> = {
  held: ["Place held", "attention"],
  review: ["Payment in review", "attention"],
  correction: ["Correction requested", "attention"],
  approved: ["Approved", "confirmed"],
  withdrawal_requested: ["Withdrawal requested", "attention"],
  expired: ["Reservation expired", "refused"],
  rejected: ["Not approved", "refused"],
  cancelled: ["Cancelled", "refused"],
  waitlisted: ["On the waiting list", "neutral"],
  offered: ["Place offered", "attention"],
};

export function CourseStatus({ status }: Readonly<{ status: EnrolmentStatus }>) {
  const [label, tone] = presentation[status];
  return (
    <span className="course-status" data-tone={tone}>
      {label}
    </span>
  );
}
