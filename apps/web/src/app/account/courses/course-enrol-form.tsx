"use client";
import { useEffect, useState } from "react";
import type {
  CourseCandidate,
  CourseEnrolment,
  CoursePage,
  ParticipantScope,
  PublicCourse,
} from "@bpt-jersey/domain/courses";
import { courseApi, courseError } from "../../../lib/courses/course-client";
import { publicCourse, courseMoney } from "../../../lib/courses/course-public-client";
import { CourseEnrolmentSteps, CourseLoading } from "../../courses/course-ui";
import { useCourseAction } from "../../../lib/courses/use-course-action";
export function CourseEnrolForm({
  courseId,
  onEnrolled,
  onClose,
}: {
  courseId: string;
  onClose: () => void;
  onEnrolled: (e: CourseEnrolment) => void;
}) {
  const [course, setCourse] = useState<PublicCourse | null>(null);
  const [participants, setParticipants] = useState<CoursePage<ParticipantScope>>({
    items: [],
    cursor: null,
  });
  const [selected, setSelected] = useState("");
  const [create, setCreate] = useState(false);
  const [kind, setKind] = useState<"adult" | "minor">("adult");
  const [candidateId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const action = useCourseAction();
  async function loadParticipants(cursor?: string) {
    try {
      const page = await courseApi.participants(cursor ? { cursor } : {});
      setParticipants((old) => ({
        ...page,
        items: [...(cursor ? old.items : []), ...page.items].filter(
          (p, i, all) => all.findIndex((a) => a.participantKey === p.participantKey) === i,
        ),
      }));
    } catch (e) {
      setError(courseError(e));
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void publicCourse(courseId, controller.signal)
      .then(setCourse)
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      });
    void loadParticipants();
    return () => controller.abort();
  }, [courseId]);
  async function saveParticipant(form: HTMLFormElement) {
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "");
    const input = {
      candidateId,
      kind,
      fullName: text("name"),
      dateOfBirth: text("dob"),
      contactEmail: text("email"),
      contactPhone: text("phone"),
      applicantName: text("applicantName"),
      trainingCenter: text("centre") as CourseCandidate["trainingCenter"],
      trainingTimePreferences: data.getAll("times") as CourseCandidate["trainingTimePreferences"],
      revision: 0,
      guardianDeclaration: data.get("guardian") === "on",
    };
    const result = await action.run(
      JSON.stringify(input),
      () => courseApi.candidate(input),
      "Participant saved. Choose the participant and confirm the course terms.",
    );
    if (result) {
      setCreate(false);
      const scope: ParticipantScope = {
        participant: { kind: "candidate", candidateId: result.candidateId },
        participantKey: `candidate:${result.candidateId}`,
        fullName: result.fullName,
        dateOfBirth: result.dateOfBirth,
        studentId: result.canonicalStudentId,
      };
      setParticipants((old) => ({
        ...old,
        items: [...old.items.filter((p) => p.participantKey !== scope.participantKey), scope],
      }));
      setSelected(scope.participantKey);
    }
  }
  async function enrol() {
    if (!course || !accepted) return;
    const participant = participants.items.find((p) => p.participantKey === selected);
    if (!participant) return;
    const input = {
      courseId,
      courseRevision: course.revision,
      participant: participant.participant,
      acceptTerms: true as const,
    };
    let availabilityAfterFailure: PublicCourse["availability"] | null = null;
    const result = await action.run(
      JSON.stringify(input),
      async (requestId) => {
        try {
          return await (
            course.availability === "waitlist" ? courseApi.waitlist : courseApi.reserve
          )({ ...input, requestId });
        } catch (e) {
          const reason = (e as { details?: { reason?: string } }).details?.reason;
          if (reason === "full") availabilityAfterFailure = "waitlist";
          throw e;
        }
      },
      course.availability === "waitlist"
        ? "You have joined the waitlist."
        : "Place reserved. Send your payment evidence within 24 hours.",
    );
    if (result) onEnrolled(result);
    else {
      try {
        const latest = await publicCourse(courseId, new AbortController().signal);
        if (
          latest.priceMinor !== course.priceMinor ||
          latest.cancellationTerms !== course.cancellationTerms
        )
          setAccepted(false);
        setCourse(
          availabilityAfterFailure ? { ...latest, availability: availabilityAfterFailure } : latest,
        );
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }
  return (
    <section className="course-panel course-enrol-panel">
      <div className="course-panel-heading">
        <h2>{course?.title ?? "Enrol in a course"}</h2>
        <button className="course-link" onClick={onClose}>
          Back to my requests
        </button>
      </div>
      <CourseEnrolmentSteps />
      {(error || action.error) && (
        <p className="course-error" role="alert">
          {error || action.error}
        </p>
      )}
      {action.message && (
        <p className="course-notice" role="status">
          {action.message}
        </p>
      )}
      {!course && !error && <CourseLoading label="Loading programme and participants" />}
      {course && (
        <>
          <p>
            {courseMoney(course.priceMinor)} for the programme. Ages {course.minAge}
            {course.maxAge === null ? "+" : `-${course.maxAge}`}
          </p>
          <p>
            Joining now covers the remaining sessions at the full course price.{" "}
            <a href={`/courses/view?course=${courseId}`}>Review all dates and course details</a>.
          </p>
          <label>
            Participant
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Choose a participant</option>
              {participants.items.map((p) => (
                <option key={p.participantKey} value={p.participantKey}>
                  {p.fullName} · {p.dateOfBirth}
                </option>
              ))}
            </select>
          </label>
          {participants.cursor && (
            <button
              className="course-link"
              onClick={() => void loadParticipants(participants.cursor!)}
            >
              Load more participants
            </button>
          )}
          <button className="course-link" onClick={() => setCreate((v) => !v)}>
            {create ? "Close participant form" : "Add myself or a child"}
          </button>
          {create && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveParticipant(e.currentTarget);
              }}
            >
              <fieldset disabled={action.busy}>
                <legend>Participant details</legend>
                <div className="course-form-grid">
                  <label>
                    Enrolling
                    <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                      <option value="adult">Myself (18 or over)</option>
                      <option value="minor">A child under 18</option>
                    </select>
                  </label>
                  <label>
                    Participant’s full name
                    <input name="name" maxLength={160} required autoComplete="off" />
                  </label>
                  <label>
                    Participant’s date of birth
                    <input name="dob" type="date" required />
                  </label>
                  <label>
                    Your name
                    <input name="applicantName" maxLength={160} required autoComplete="name" />
                  </label>
                  <label>
                    Your email
                    <input
                      name="email"
                      type="email"
                      maxLength={254}
                      required
                      autoComplete="email"
                    />
                  </label>
                  <label>
                    Your phone
                    <input name="phone" type="tel" maxLength={64} required autoComplete="tel" />
                  </label>
                  <label>
                    Usual training centre
                    <select name="centre">
                      <option value="Town">Town</option>
                      <option value="West">West</option>
                    </select>
                  </label>
                  <div>
                    <p>Preferred training times</p>
                    {["morning", "afternoon", "evening"].map((t) => (
                      <label className="course-check" key={t}>
                        <input type="checkbox" name="times" value={t} />
                        {t}
                      </label>
                    ))}
                  </div>
                </div>
                {kind === "minor" && (
                  <label className="course-check">
                    <input type="checkbox" name="guardian" required />I am this child’s parent or
                    legal guardian and am authorised to enrol them.
                  </label>
                )}
                <p className="course-meta">
                  Choose at least one preferred training time. Each child needs a separate course
                  request and payment evidence.
                </p>
                <button className="course-button secondary" disabled={action.busy}>
                  Save participant
                </button>
              </fieldset>
            </form>
          )}
          <details>
            <summary>Cancellation and refund terms</summary>
            <p className="course-prose">{course.cancellationTerms}</p>
          </details>
          <label className="course-check">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            I accept these terms and the one-time course price.
          </label>
          <button
            className="course-button"
            disabled={
              action.busy || create || !selected || !accepted || course.availability === "closed"
            }
            onClick={() => void enrol()}
          >
            {action.busy
              ? "Submitting…"
              : course.availability === "waitlist"
                ? "Join waitlist, no payment yet"
                : "Reserve my place"}
          </button>
        </>
      )}
    </section>
  );
}
