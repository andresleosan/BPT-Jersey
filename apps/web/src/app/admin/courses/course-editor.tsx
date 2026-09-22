"use client";
import { useEffect, useRef, useState } from "react";
import { courseDraftSchema, type Course, type CourseDraft, type CoursePage, type CourseWeeklySlot } from "@bpt-jersey/domain/courses";
import { courseDate, type PublicCourseSlot } from "../../../lib/courses/course-public-client";
import { courseApi, courseError } from "../../../lib/courses/course-client";
import { getScheduleCatalog, type ScheduleCatalogResponse } from "../../../lib/schedule-client";
import { useCourseAction } from "../../../lib/courses/use-course-action";
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function CourseEditor({
  course,
  onSaved,
  onClose,
}: {
  course: Course | null;
  onSaved: (course: Course) => void;
  onClose: () => void;
}) {
  const [locations, setLocations] = useState<ScheduleCatalogResponse["locations"]>([]);
  const [coaches, setCoaches] = useState<{ staffId: string; name: string }[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [instructorKind, setInstructorKind] = useState(course?.instructor.kind ?? "staff");
  const action = useCourseAction();
  const [weeks, setWeeks] = useState(String(course?.weeklySchedule?.weeks ?? course?.sessionCount ?? 6));
  const [slots, setSlots] = useState<(CourseWeeklySlot & {key: number})[]>(() =>
    (course?.weeklySchedule?.slots ?? [{
      weekday: course ? new Date(`${course.startsOn}T12:00:00Z`).getUTCDay() : 6,
      startTime: course?.startTime ?? "15:00",
      endTime: course?.endTime ?? "16:00",
    }]).map((slot, key) => ({...slot, key})),
  );
  const nextSlotKey = useRef(slots.length);
  function changeSlot(key: number, patch: Partial<CourseWeeklySlot>) {
    setSlots(current => current.map(slot => slot.key === key ? {...slot, ...patch} : slot));
  }
  function clearPreview() {
    setPreview(null);
    setPreviewDraft(null);
  }
  useEffect(() => {
    let active = true;
    void Promise.all([getScheduleCatalog(), courseApi.coaches({})])
      .then(([catalog, staff]) => {
        if (active) {
          setLocations(catalog.locations.filter((l) => l.active));
          setCoaches(staff.items);
          setCursor(staff.cursor);
        }
      })
      .catch((e) => {
        if (active) setLoadError(courseError(e));
      });
    return () => {
      active = false;
    };
  }, []);
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<CoursePage<PublicCourseSlot> | null>(null);
  const [previewDraft, setPreviewDraft] = useState<CourseDraft | null>(null);
  const [previewId] = useState(() => course?.courseId ?? crypto.randomUUID());
  const published = !!course && course.status !== "draft";
  async function save(form: HTMLFormElement, previewOnly = false) {
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "");
    const staff = coaches.find((c) => c.staffId === text("coach"));
    setLoadError("");
    const weeklySchedule = published ? course!.weeklySchedule : {
      weeks: Number(weeks), slots: slots.map(({weekday, startTime, endTime}) => ({weekday, startTime, endTime})),
    };
    const draft: CourseDraft = {
      kind: text("kind") as CourseDraft["kind"],
      title: text("title"),
      description: text("description"),
      techniques: text("techniques")
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean),
      instructor: published
        ? course!.instructor
        : instructorKind === "guest"
          ? { kind: "guest", name: text("guest") }
          : { kind: "staff", staffId: text("coach"), name: staff?.name ?? "" },
      locationId: published ? course!.locationId : text("location"),
      minAge: Number(text("minAge")),
      maxAge: text("maxAge") ? Number(text("maxAge")) : null,
      priceMinor: Math.round(Number(text("price")) * 100),
      capacity: Number(text("capacity")),
      cancellationTerms: text("terms"),
      startsOn: published ? course!.startsOn : text("date"),
      startTime: published ? course!.startTime : slots[0]!.startTime,
      endTime: published ? course!.endTime : slots[0]!.endTime,
      sessionCount: published ? course!.sessionCount : Number(weeks) * slots.length,
      ...(weeklySchedule ? {weeklySchedule} : {}),
    };
    const checked = courseDraftSchema.safeParse(draft);
    if (!checked.success) {
      setLoadError(checked.error.issues[0]?.message ?? "Check the weekly schedule.");
      return;
    }
    if (previewOnly) {
      setLoadError("");
      try {
        setPreview(await courseApi.dates({ courseId: previewId, draft }));
        setPreviewDraft(draft);
      } catch (e) {
        setLoadError(courseError(e));
      }
      return;
    }
    const result = await action.run(
      JSON.stringify(draft),
      (requestId) =>
        courseApi.save({
          requestId,
          draft,
          courseId: course?.courseId ?? null,
          expectedRevision: course?.revision ?? null,
        }),
      "Course saved.",
    );
    if (result) onSaved(result);
  }
  return (
    <section className="course-panel course-editor">
      <div className="course-panel-heading">
        <h3>{course ? "Edit course" : "Create a course or seminar"}</h3>
        <button className="course-link" onClick={onClose}>
          Close editor
        </button>
      </div>
      <p>
        Choose the weekly days and times, then how many weeks the programme runs.
        All session dates are created together when you publish.
      </p>
      {(loadError || action.error) && (
        <p className="course-error" role="alert">
          {loadError || action.error}
        </p>
      )}
      <form
        ref={formRef}
        onChange={clearPreview}
        onSubmit={(e) => {
          e.preventDefault();
          void save(e.currentTarget);
        }}
      >
        <fieldset disabled={action.busy}>
          <legend>Programme details</legend>
          <p className="course-fieldset-help">
            Tell participants what they will learn and who the programme is for.
          </p>
          <div className="course-form-grid">
            <label>
              Title
              <input name="title" defaultValue={course?.title} maxLength={160} required />
            </label>
            <label>
              Type
              <select name="kind" defaultValue={course?.kind ?? "course"}>
                <option value="course">Course</option>
                <option value="seminar">Seminar</option>
              </select>
            </label>
            <label className="wide">
              Description
              <textarea
                name="description"
                defaultValue={course?.description}
                maxLength={6000}
                required
              />
            </label>
            <label className="wide">
              Techniques, one per line
              <textarea name="techniques" defaultValue={course?.techniques.join("\n")} required />
            </label>
            <label>
              Minimum age
              <input
                name="minAge"
                type="number"
                min={0}
                max={120}
                defaultValue={course?.minAge ?? 12}
                required
              />
            </label>
            <label>
              Maximum age, optional
              <input
                name="maxAge"
                type="number"
                min={0}
                max={120}
                defaultValue={course?.maxAge ?? ""}
              />
            </label>
          </div>
        </fieldset>
        <fieldset disabled={action.busy || published}>
          <legend>Weekly schedule</legend>
          <p className="course-fieldset-help">
            Times use Jersey local time, including clock changes. Each selected session repeats once
            in every seven-day week, starting on or after the repeat-from date.
          </p>
          {published && <p>Use the session list to change a published date or time.</p>}
          <div className="course-form-grid">
            <label>
              Repeat from
              <input name="date" type="date" defaultValue={course?.startsOn} required />
            </label>
            <label>
              Number of weeks
              <input
                name="weeks"
                type="number"
                min={1}
                step={1}
                value={weeks}
                onChange={e => setWeeks(e.target.value)}
                required
              />
            </label>
          </div>
          <ol className="course-weekly-slots" aria-label="Sessions each week">
            {slots.map((slot, index) => (
              <li key={slot.key}>
                <strong>Weekly session {index + 1}</strong>
                <div className="course-weekly-slot-fields">
                  <label>
                    Day of the week
                    <select value={slot.weekday} onChange={e => changeSlot(slot.key, {weekday: Number(e.target.value)})}>
                      {[1, 2, 3, 4, 5, 6, 0].map(day => <option key={day} value={day}>{weekdays[day]}</option>)}
                    </select>
                  </label>
                  <label>
                    Start time
                    <input type="time" value={slot.startTime} onChange={e => changeSlot(slot.key, {startTime: e.target.value})} required />
                  </label>
                  <label>
                    Finish time
                    <input type="time" value={slot.endTime} onChange={e => changeSlot(slot.key, {endTime: e.target.value})} required />
                  </label>
                  {!published && <button type="button" className="course-link" disabled={slots.length === 1}
                    aria-label={`Remove weekly session ${index + 1}`}
                    onClick={() => {setSlots(current => current.filter(item => item.key !== slot.key)); clearPreview();}}>
                    Remove
                  </button>}
                </div>
              </li>
            ))}
          </ol>
          {!published && <button type="button" className="course-button secondary" disabled={slots.length >= 28}
            onClick={() => {
              const previous = slots[slots.length - 1]!;
              const key = nextSlotKey.current++;
              setSlots(current => [...current, {key, weekday: (previous.weekday + 1) % 7, startTime: previous.startTime, endTime: previous.endTime}]);
              clearPreview();
            }}>
            Add weekly session
          </button>}
          <p className="course-schedule-total" role="status">
            {Number.isSafeInteger(Number(weeks)) && Number(weeks) > 0
              ? `${slots.length} session${slots.length === 1 ? "" : "s"} per week × ${weeks} week${Number(weeks) === 1 ? "" : "s"} = ${Number(weeks) * slots.length} sessions in total.`
              : "Enter the number of weeks to calculate the total sessions."}
          </p>
          <div className="course-form-grid">
            <label>
              Location
              <select name="location" defaultValue={course?.locationId ?? ""} required>
                <option value="">Choose a location</option>
                {locations.map((l) => (
                  <option value={l.locationId} key={l.locationId}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Instructor type
              <select
                value={instructorKind}
                onChange={(e) => setInstructorKind(e.target.value as "staff" | "guest")}
              >
                <option value="staff">Academy coach</option>
                <option value="guest">Guest instructor</option>
              </select>
            </label>
            {instructorKind === "guest" ? (
              <label>
                Guest instructor name
                <input
                  name="guest"
                  defaultValue={course?.instructor.name}
                  maxLength={160}
                  required
                />
              </label>
            ) : (
              <label>
                Academy coach
                <select
                  name="coach"
                  defaultValue={
                    course?.instructor.kind === "staff" ? course.instructor.staffId : ""
                  }
                  required
                >
                  <option value="">Choose a coach</option>
                  {coaches.map((c) => (
                    <option value={c.staffId} key={c.staffId}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {cursor && (
                  <button
                    type="button"
                    className="course-link"
                    onClick={() =>
                      void courseApi
                        .coaches({ cursor })
                        .then((p) => {
                          setCoaches((old) => [...old, ...p.items]);
                          setCursor(p.cursor);
                        })
                        .catch((e) => setLoadError(courseError(e)))
                    }
                  >
                    Load more coaches
                  </button>
                )}
              </label>
            )}
          </div>
        </fieldset>
        <fieldset disabled={action.busy}>
          <legend>Places and payment</legend>
          <p className="course-fieldset-help">
            One bank transfer covers the programme. The office reviews each payment before approving
            enrolment.
          </p>
          <div className="course-form-grid">
            <label>
              One-time price (£)
              <input
                name="price"
                type="number"
                min="0.01"
                step="0.01"
                defaultValue={course ? course.priceMinor / 100 : ""}
                required
              />
            </label>
            <label>
              Places
              <input
                name="capacity"
                type="number"
                min={Math.max(1, course?.committedSeats ?? 0)}
                defaultValue={course?.capacity ?? 20}
                required
              />
            </label>
            <label className="wide">
              Cancellation and refund terms
              <textarea
                name="terms"
                defaultValue={course?.cancellationTerms}
                maxLength={6000}
                required
              />
            </label>
          </div>
          <p className="course-meta">
            Existing applicants keep the price and terms they accepted. A course payment does not
            create a regular membership.
          </p>
        </fieldset>
        {!published && (
          <section>
            <button
              type="button"
              className="course-button secondary"
              disabled={action.busy}
              onClick={() => {
                if (formRef.current?.reportValidity()) void save(formRef.current, true);
              }}
            >
              Preview exact Jersey dates
            </button>
            {preview && (
              <>
                <ol className="course-slots">
                  {preview.items.map((s) => (
                    <li key={s.sessionId}>
                      Session {s.ordinal}: {courseDate(s.startAt)} to {courseDate(s.endAt)}
                    </li>
                  ))}
                </ol>
                {preview.cursor && previewDraft && (
                  <button
                    type="button"
                    className="course-link"
                    onClick={() =>
                      void courseApi
                        .dates({
                          courseId: previewId,
                          draft: previewDraft,
                          cursor: preview.cursor!,
                        })
                        .then((p) => setPreview({ ...p, items: [...preview.items, ...p.items] }))
                        .catch((e) => setLoadError(courseError(e)))
                    }
                  >
                    Preview more dates
                  </button>
                )}
              </>
            )}
          </section>
        )}
        <footer className="course-form-footer">
          <p>
            {published
              ? "Changes apply to the programme. Existing applicants keep their accepted price and terms."
              : "Saving keeps this programme private. You can publish it after checking the dates."}
          </p>
          <button className="course-button" disabled={action.busy}>
            {action.busy ? "Saving…" : published ? "Save changes" : "Save draft"}
          </button>
        </footer>
      </form>
    </section>
  );
}
