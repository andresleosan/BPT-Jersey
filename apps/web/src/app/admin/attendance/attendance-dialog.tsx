import type { FormEvent } from "react";
import type {
  AttendanceState,
  CheckoutMethod,
  SessionOperationalStatus,
} from "@bpt-jersey/domain/schedule";

export type AttendanceDialogState =
  | Readonly<{
      kind: "correction";
      sessionId: string;
      studentId: string;
      currentStatus: SessionOperationalStatus;
      newState: AttendanceState;
      reason: string;
    }>
  | Readonly<{
      kind: "checkout";
      sessionId: string;
      studentId: string;
      method: CheckoutMethod;
      authorizedAdultId: string;
      authorizedAdultName: string;
      notes: string;
    }>;

type AttendanceDialogProps = Readonly<{
  busy: boolean;
  dialog: AttendanceDialogState;
  error: string;
  onChange: (next: AttendanceDialogState) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}>;

const correctionStates = [
  { value: "attended", label: "Attended" },
  { value: "late", label: "Late" },
  { value: "absent", label: "Absent" },
  { value: "no_show", label: "No-show" },
  { value: "excused", label: "Excused absence" },
] as const;

export function AttendanceDialog({
  busy,
  dialog,
  error,
  onChange,
  onClose,
  onSubmit,
}: AttendanceDialogProps) {
  const title = dialog.kind === "correction" ? "Correct attendance" : "Record checkout";
  const submitLabel = dialog.kind === "correction" ? "Save correction" : "Record checkout";
  return (
    <div
      aria-labelledby="attendance-dialog-title"
      aria-modal="true"
      className="attendance-dialog-backdrop"
      role="dialog"
    >
      <section className="attendance-dialog">
        <header className="attendance-dialog-heading">
          <div>
            <p className="admin-eyebrow">Canonical roster operation</p>
            <h3 id="attendance-dialog-title">{title}</h3>
            <p>
              Student <strong>{dialog.studentId}</strong>
            </p>
          </div>
          <button
            aria-label="Close attendance dialog"
            className="attendance-close-button"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </header>

        <form className="attendance-dialog-form" noValidate onSubmit={onSubmit}>
          {dialog.kind === "correction" ? (
            <>
              <p className="attendance-dialog-context">
                Current roster state: <strong>{dialog.currentStatus.replaceAll("_", " ")}</strong>
              </p>
              <label className="attendance-field">
                Corrected state
                <select
                  autoFocus
                  onChange={(event) =>
                    onChange({
                      ...dialog,
                      newState: event.target.value as AttendanceState,
                    })
                  }
                  value={dialog.newState}
                >
                  {correctionStates.map((state) => (
                    <option key={state.value} value={state.value}>
                      {state.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="attendance-field">
                Correction reason
                <textarea
                  maxLength={300}
                  onChange={(event) => onChange({ ...dialog, reason: event.target.value })}
                  rows={4}
                  value={dialog.reason}
                />
              </label>
            </>
          ) : (
            <>
              <p className="attendance-dialog-context">
                Checkout is available only after an attended or late check-in.
              </p>
              <label className="attendance-field">
                Release method
                <select
                  autoFocus
                  onChange={(event) =>
                    onChange({
                      ...dialog,
                      method: event.target.value as CheckoutMethod,
                    })
                  }
                  value={dialog.method}
                >
                  <option value="authorizedAdult">Authorized adult</option>
                  <option value="independentRelease">Independent release</option>
                  <option value="staffOverride">Staff override</option>
                </select>
              </label>
              {dialog.method === "authorizedAdult" ? (
                <div className="attendance-field-grid">
                  <label className="attendance-field">
                    Authorized adult ID
                    <input
                      maxLength={128}
                      onChange={(event) =>
                        onChange({ ...dialog, authorizedAdultId: event.target.value })
                      }
                      value={dialog.authorizedAdultId}
                    />
                  </label>
                  <label className="attendance-field">
                    Authorized adult name
                    <input
                      autoComplete="name"
                      maxLength={160}
                      onChange={(event) =>
                        onChange({ ...dialog, authorizedAdultName: event.target.value })
                      }
                      value={dialog.authorizedAdultName}
                    />
                  </label>
                </div>
              ) : null}
              {dialog.method === "independentRelease" ? (
                <p className="attendance-dialog-context">
                  This records an independent release. Confirm academy policy before saving.
                </p>
              ) : null}
              {dialog.method === "staffOverride" ? (
                <label className="attendance-field">
                  Staff override note
                  <textarea
                    maxLength={300}
                    onChange={(event) => onChange({ ...dialog, notes: event.target.value })}
                    rows={4}
                    value={dialog.notes}
                  />
                </label>
              ) : null}
            </>
          )}

          {error ? (
            <p className="attendance-dialog-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="attendance-dialog-actions">
            <button
              className="attendance-button attendance-button-secondary"
              disabled={busy}
              onClick={onClose}
              type="button"
            >
              Keep unchanged
            </button>
            <button className="attendance-button attendance-button-primary" disabled={busy}>
              {busy ? "Saving..." : submitLabel}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
