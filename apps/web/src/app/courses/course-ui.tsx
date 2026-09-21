import type { Course, EnrolmentStatus } from "@bpt-jersey/domain/courses";

export function CourseLoading({ label }: { label: string }) {
  return (
    <div className="course-loading" role="status" aria-label={label}>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
}

export function CourseProgrammeStatus({ status }: { status: Course["status"] }) {
  const label =
    status === "draft"
      ? "Draft, not public"
      : status === "published"
        ? "Published"
        : status === "completed"
          ? "Completed"
          : "Cancelled";
  return (
    <span
      className="course-status"
      data-tone={
        status === "published" || status === "completed"
          ? "confirmed"
          : status === "cancelled"
            ? "refused"
            : "neutral"
      }
    >
      {label}
    </span>
  );
}

const nextSteps: Record<EnrolmentStatus, readonly [string, string]> = {
  held: [
    "Send your payment",
    "Your place is reserved temporarily. Transfer the course fee, then send your reference and screenshot before the deadline.",
  ],
  offered: [
    "Your place is ready",
    "Send your payment evidence before the deadline to accept the place offered to you.",
  ],
  correction: [
    "Update your payment evidence",
    "Read the office note below, then send the corrected reference and screenshot.",
  ],
  review: [
    "The office is reviewing your payment",
    "Your place stays held during review. You do not need to send another payment.",
  ],
  approved: [
    "You are ready to train",
    "Your remaining sessions are included. Open your course calendar to see your dates.",
  ],
  withdrawal_requested: [
    "Withdrawal awaiting a decision",
    "Your access stays active until the office confirms. Refunds are reviewed separately.",
  ],
  waitlisted: [
    "Wait for a place",
    "Do not pay yet. If a place becomes available, you will have 24 hours to send payment evidence.",
  ],
  expired: [
    "Your reservation has expired",
    "A place is no longer held. If you already paid, send the evidence for office review before making any new payment.",
  ],
  rejected: [
    "Read the office decision",
    "This request has not been approved. Review the reason below before taking another action.",
  ],
  cancelled: [
    "This request is closed",
    "Review any payment or refund information below. Contact the academy if you need help.",
  ],
};

export function CourseNextStep({ status }: { status: EnrolmentStatus }) {
  const [title, description] = nextSteps[status];
  return (
    <aside className="course-next-step" aria-label="Next step">
      <strong>{title}</strong>
      <p>{description}</p>
    </aside>
  );
}

export function CourseEnrolmentSteps({ status }: { status?: EnrolmentStatus }) {
  const current = !status
    ? 0
    : ["held", "offered", "correction"].includes(status)
      ? 1
      : status === "review"
        ? 2
        : status === "approved"
          ? 3
          : -1;
  if (current < 0) return null;
  return (
    <ol className="course-progress" aria-label="Enrolment progress">
      {["Choose participant", "Send payment", "Office approval", "Attend sessions"].map(
        (label, index) => (
          <li
            key={label}
            aria-current={index === current ? "step" : undefined}
            data-complete={index < current}
          >
            <span className="course-progress-number" aria-hidden="true">
              {index + 1}
            </span>
            <span>
              {label}
              {index < current && <span className="course-sr-only">, completed</span>}
            </span>
          </li>
        ),
      )}
    </ol>
  );
}
