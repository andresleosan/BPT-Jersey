import type { FormEvent } from "react";
import type { ClassRecord, DayOfWeek, LocationId } from "@bpt-jersey/domain/schedule";

import type { StaffProfileProjection } from "../../../lib/staff-client";
import type { ScheduleCatalogResponse } from "../../../lib/schedule-client";

export type ClassDraft = Readonly<{
  name: string;
  programId: string;
  locationId: "" | LocationId;
  dayOfWeek: DayOfWeek;
  startTime: string;
  durationMinutes: number;
  instructorIds: readonly string[];
  capacity: number;
  minParticipants: number;
  active: boolean;
}>;

export type SessionDraft = Readonly<{
  classId: string;
  programId: string;
  locationId: "" | LocationId;
  instructorId: string;
  title: string;
  startAt: string;
  endAt: string;
  capacity: number;
  minParticipants: number;
  isSeminar: boolean;
}>;

export type ScheduleDialogState =
  | Readonly<{ kind: "class"; mode: "create" | "edit"; classId?: string; draft: ClassDraft }>
  | Readonly<{ kind: "session"; draft: SessionDraft }>
  | Readonly<{ kind: "generate"; classId: string; fromDate: string; toDate: string }>
  | Readonly<{ kind: "cancel-session"; sessionId: string; label: string; reason: string }>
  | Readonly<{
      kind: "cancel-booking";
      booking: {
        sessionId: string;
        studentId: string;
      };
      label: string;
      reason: string;
    }>;

const dayLabels = Object.freeze([
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]);

function selectedValues(select: HTMLSelectElement): readonly string[] {
  return Object.freeze(Array.from(select.selectedOptions, (option) => option.value));
}

function title(dialog: ScheduleDialogState): string {
  if (dialog.kind === "class") return dialog.mode === "edit" ? "Edit class" : "Create class";
  if (dialog.kind === "session") return "Create session";
  if (dialog.kind === "generate") return "Generate sessions";
  return dialog.kind === "cancel-session" ? "Cancel session" : "Cancel reservation";
}

type DialogProps = Readonly<{
  activeStaff: readonly StaffProfileProjection[];
  busy: boolean;
  catalog: ScheduleCatalogResponse;
  classes: readonly ClassRecord[];
  dialog: ScheduleDialogState;
  error: string;
  onChange: (dialog: ScheduleDialogState) => void;
  onClose: () => void;
  onSubmitCancellation: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitClass: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitGenerate: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitSession: (event: FormEvent<HTMLFormElement>) => void;
}>;

function DialogActions({
  busy,
  destructive = false,
  label,
  onClose,
}: {
  busy: boolean;
  destructive?: boolean;
  label: string;
  onClose: () => void;
}) {
  return (
    <div className="schedule-admin-dialog-actions">
      <button
        className="schedule-admin-button schedule-admin-button-secondary"
        disabled={busy}
        onClick={onClose}
        type="button"
      >
        Keep unchanged
      </button>
      <button
        className={"schedule-admin-button" + (destructive ? " schedule-admin-button-danger" : "")}
        disabled={busy}
        type="submit"
      >
        {busy ? "Working..." : label}
      </button>
    </div>
  );
}

export function ScheduleDialog({
  activeStaff,
  busy,
  catalog,
  classes,
  dialog,
  error,
  onChange,
  onClose,
  onSubmitCancellation,
  onSubmitClass,
  onSubmitGenerate,
  onSubmitSession,
}: DialogProps) {
  const dialogTitle = title(dialog);
  return (
    <div
      aria-labelledby="schedule-dialog-title"
      aria-modal="true"
      className="schedule-admin-dialog-backdrop"
      role="dialog"
    >
      <section className="schedule-admin-dialog">
        <div className="schedule-admin-dialog-heading">
          <div>
            <p className="admin-eyebrow">Connected operation</p>
            <h3 id="schedule-dialog-title">{dialogTitle}</h3>
          </div>
          <button
            aria-label="Close dialog"
            className="schedule-admin-close"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        {dialog.kind === "class" ? (
          <form aria-label={dialogTitle} className="schedule-admin-form" onSubmit={onSubmitClass}>
            <label className="schedule-admin-field">
              Class name
              <input
                autoFocus
                maxLength={100}
                minLength={2}
                onChange={(event) =>
                  onChange({ ...dialog, draft: { ...dialog.draft, name: event.target.value } })
                }
                required
                value={dialog.draft.name}
              />
            </label>
            {dialog.mode === "create" ? (
              <>
                <label className="schedule-admin-field">
                  Program
                  <select
                    onChange={(event) =>
                      onChange({
                        ...dialog,
                        draft: { ...dialog.draft, programId: event.target.value },
                      })
                    }
                    required
                    value={dialog.draft.programId}
                  >
                    <option value="">Select a program</option>
                    {catalog.programs
                      .filter((program) => program.active)
                      .map((program) => (
                        <option key={program.programId} value={program.programId}>
                          {program.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="schedule-admin-field">
                  Training center
                  <select
                    onChange={(event) =>
                      onChange({
                        ...dialog,
                        draft: {
                          ...dialog.draft,
                          locationId: event.target.value as LocationId | "",
                        },
                      })
                    }
                    required
                    value={dialog.draft.locationId}
                  >
                    <option value="">Select a center</option>
                    {catalog.locations
                      .filter((location) => location.active)
                      .map((location) => (
                        <option key={location.locationId} value={location.locationId}>
                          {location.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="schedule-admin-field">
                  Day
                  <select
                    onChange={(event) =>
                      onChange({
                        ...dialog,
                        draft: {
                          ...dialog.draft,
                          dayOfWeek: Number(event.target.value) as DayOfWeek,
                        },
                      })
                    }
                    value={dialog.draft.dayOfWeek}
                  >
                    {dayLabels.map((label, index) => (
                      <option key={label} value={index + 1}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="schedule-admin-field">
                  Start time
                  <input
                    onChange={(event) =>
                      onChange({
                        ...dialog,
                        draft: { ...dialog.draft, startTime: event.target.value },
                      })
                    }
                    required
                    type="time"
                    value={dialog.draft.startTime}
                  />
                </label>
                <label className="schedule-admin-field">
                  Duration (minutes)
                  <input
                    max={480}
                    min={15}
                    onChange={(event) =>
                      onChange({
                        ...dialog,
                        draft: { ...dialog.draft, durationMinutes: Number(event.target.value) },
                      })
                    }
                    required
                    type="number"
                    value={dialog.draft.durationMinutes}
                  />
                </label>
              </>
            ) : (
              <p className="schedule-admin-form-note">
                Program, center, and recurrence remain fixed by the existing update contract.
              </p>
            )}
            <label className="schedule-admin-field schedule-admin-field-wide">
              Coaches
              <select
                multiple
                onChange={(event) =>
                  onChange({
                    ...dialog,
                    draft: { ...dialog.draft, instructorIds: selectedValues(event.target) },
                  })
                }
                required
                size={Math.min(Math.max(activeStaff.length, 2), 5)}
                value={[...dialog.draft.instructorIds]}
              >
                {[
                  ...activeStaff.map((profile) => profile.staffKey),
                  ...dialog.draft.instructorIds.filter(
                    (id) => !activeStaff.some((profile) => profile.staffKey === id),
                  ),
                ].map((staffKey) => (
                  <option key={staffKey} value={staffKey}>
                    {staffKey}
                  </option>
                ))}
              </select>
            </label>
            <label className="schedule-admin-field">
              Capacity
              <input
                max={200}
                min={1}
                onChange={(event) =>
                  onChange({
                    ...dialog,
                    draft: { ...dialog.draft, capacity: Number(event.target.value) },
                  })
                }
                required
                type="number"
                value={dialog.draft.capacity}
              />
            </label>
            <label className="schedule-admin-field">
              Minimum participants
              <input
                max={dialog.draft.capacity}
                min={0}
                onChange={(event) =>
                  onChange({
                    ...dialog,
                    draft: { ...dialog.draft, minParticipants: Number(event.target.value) },
                  })
                }
                required
                type="number"
                value={dialog.draft.minParticipants}
              />
            </label>
            {dialog.mode === "edit" ? (
              <label className="schedule-admin-check">
                <input
                  checked={dialog.draft.active}
                  onChange={(event) =>
                    onChange({
                      ...dialog,
                      draft: { ...dialog.draft, active: event.target.checked },
                    })
                  }
                  type="checkbox"
                />
                Class is active
              </label>
            ) : null}
            {error ? (
              <p
                className="schedule-admin-notice schedule-admin-notice-error schedule-admin-field-wide"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <DialogActions
              busy={busy}
              label={dialog.mode === "edit" ? "Save changes" : "Create class"}
              onClose={onClose}
            />
          </form>
        ) : null}

        {dialog.kind === "session" ? (
          <form aria-label={dialogTitle} className="schedule-admin-form" onSubmit={onSubmitSession}>
            <label className="schedule-admin-field schedule-admin-field-wide">
              Recurring class (optional)
              <select
                autoFocus
                onChange={(event) => {
                  const source = classes.find((item) => item.classId === event.target.value);
                  onChange({
                    ...dialog,
                    draft: source
                      ? {
                          ...dialog.draft,
                          classId: source.classId,
                          programId: source.programId,
                          locationId: source.locationId,
                          instructorId: source.instructorIds[0] ?? "",
                          title: source.name,
                          capacity: source.capacity,
                          minParticipants: source.minParticipants,
                        }
                      : { ...dialog.draft, classId: "" },
                  });
                }}
                value={dialog.draft.classId}
              >
                <option value="">Standalone session</option>
                {classes
                  .filter((item) => item.active)
                  .map((item) => (
                    <option key={item.classId} value={item.classId}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="schedule-admin-field">
              Program
              <select
                onChange={(event) =>
                  onChange({
                    ...dialog,
                    draft: { ...dialog.draft, programId: event.target.value },
                  })
                }
                required
                value={dialog.draft.programId}
              >
                <option value="">Select a program</option>
                {catalog.programs
                  .filter((program) => program.active)
                  .map((program) => (
                    <option key={program.programId} value={program.programId}>
                      {program.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="schedule-admin-field">
              Training center
              <select
                onChange={(event) =>
                  onChange({
                    ...dialog,
                    draft: {
                      ...dialog.draft,
                      locationId: event.target.value as LocationId | "",
                    },
                  })
                }
                required
                value={dialog.draft.locationId}
              >
                <option value="">Select a center</option>
                {catalog.locations
                  .filter((location) => location.active)
                  .map((location) => (
                    <option key={location.locationId} value={location.locationId}>
                      {location.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="schedule-admin-field">
              Coach
              <select
                onChange={(event) =>
                  onChange({
                    ...dialog,
                    draft: { ...dialog.draft, instructorId: event.target.value },
                  })
                }
                required
                value={dialog.draft.instructorId}
              >
                <option value="">Select a coach</option>
                {activeStaff.map((profile) => (
                  <option key={profile.staffKey} value={profile.staffKey}>
                    {profile.staffKey}
                  </option>
                ))}
              </select>
            </label>
            {(["title", "startAt", "endAt"] as const).map((field) => (
              <label className="schedule-admin-field" key={field}>
                {field === "title"
                  ? "Session title"
                  : field === "startAt"
                    ? "Starts on this device"
                    : "Ends on this device"}
                <input
                  maxLength={field === "title" ? 120 : undefined}
                  minLength={field === "title" ? 2 : undefined}
                  onChange={(event) =>
                    onChange({
                      ...dialog,
                      draft: { ...dialog.draft, [field]: event.target.value },
                    })
                  }
                  required
                  type={field === "title" ? "text" : "datetime-local"}
                  value={dialog.draft[field]}
                />
              </label>
            ))}
            <label className="schedule-admin-field">
              Capacity
              <input
                max={300}
                min={1}
                onChange={(event) =>
                  onChange({
                    ...dialog,
                    draft: { ...dialog.draft, capacity: Number(event.target.value) },
                  })
                }
                required
                type="number"
                value={dialog.draft.capacity}
              />
            </label>
            <label className="schedule-admin-field">
              Minimum participants
              <input
                max={dialog.draft.capacity}
                min={0}
                onChange={(event) =>
                  onChange({
                    ...dialog,
                    draft: { ...dialog.draft, minParticipants: Number(event.target.value) },
                  })
                }
                required
                type="number"
                value={dialog.draft.minParticipants}
              />
            </label>
            <label className="schedule-admin-check">
              <input
                checked={dialog.draft.isSeminar}
                onChange={(event) =>
                  onChange({
                    ...dialog,
                    draft: { ...dialog.draft, isSeminar: event.target.checked },
                  })
                }
                type="checkbox"
              />
              Seminar or special event
            </label>
            {error ? (
              <p
                className="schedule-admin-notice schedule-admin-notice-error schedule-admin-field-wide"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <DialogActions busy={busy} label="Create session" onClose={onClose} />
          </form>
        ) : null}

        {dialog.kind === "generate" ? (
          <form
            aria-label={dialogTitle}
            className="schedule-admin-form"
            onSubmit={onSubmitGenerate}
          >
            <p className="schedule-admin-form-note schedule-admin-field-wide">
              The backend applies recurrence and skips existing deterministic session IDs.
            </p>
            <label className="schedule-admin-field">
              From
              <input
                autoFocus
                onChange={(event) => onChange({ ...dialog, fromDate: event.target.value })}
                required
                type="date"
                value={dialog.fromDate}
              />
            </label>
            <label className="schedule-admin-field">
              To
              <input
                onChange={(event) => onChange({ ...dialog, toDate: event.target.value })}
                required
                type="date"
                value={dialog.toDate}
              />
            </label>
            {error ? (
              <p
                className="schedule-admin-notice schedule-admin-notice-error schedule-admin-field-wide"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <DialogActions busy={busy} label="Generate sessions" onClose={onClose} />
          </form>
        ) : null}

        {dialog.kind === "cancel-session" || dialog.kind === "cancel-booking" ? (
          <form
            aria-label={dialogTitle}
            className="schedule-admin-form"
            onSubmit={onSubmitCancellation}
          >
            <p className="schedule-admin-form-note schedule-admin-field-wide">
              You are cancelling <strong>{dialog.label}</strong>. Backend cutoff, state, and role
              rules still apply.
            </p>
            <label className="schedule-admin-field schedule-admin-field-wide">
              Cancellation reason
              <textarea
                autoFocus
                maxLength={200}
                minLength={2}
                onChange={(event) => onChange({ ...dialog, reason: event.target.value })}
                required
                rows={4}
                value={dialog.reason}
              />
            </label>
            {error ? (
              <p
                className="schedule-admin-notice schedule-admin-notice-error schedule-admin-field-wide"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <DialogActions busy={busy} destructive label="Confirm cancellation" onClose={onClose} />
          </form>
        ) : null}
      </section>
    </div>
  );
}
