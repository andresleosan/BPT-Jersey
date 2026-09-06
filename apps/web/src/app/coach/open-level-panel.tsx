"use client";

import { useEffect, useState, type FormEvent } from "react";
import { describeAgeBand, type LevelDefinitionRecord } from "@bpt-jersey/domain/levels";

import { getLevelCatalog, openStudentLevel } from "../../lib/levels-client";

type PanelProps = Readonly<{
  /** Students on the selected session roster; the head coach opens levels from here. */
  studentIds: readonly string[];
  onOpened?: (studentId: string, definitionKey: string) => void;
}>;

type CatalogState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; belts: readonly LevelDefinitionRecord[] }>
  | Readonly<{ status: "error" }>;

/**
 * Head-coach-only action: opens a student's level record at the belt they hold. Nothing is
 * granted automatically and stripes are never opened directly; promotions stay a separate,
 * approved decision.
 */
export function OpenLevelPanel({ studentIds, onOpened }: PanelProps) {
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [studentId, setStudentId] = useState("");
  const [definitionKey, setDefinitionKey] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Readonly<{ tone: "success" | "error"; text: string }>>();

  useEffect(() => {
    let mounted = true;
    void getLevelCatalog()
      .then((projection) => {
        if (!mounted) return;
        const belts = [...projection.definitions]
          .filter((definition) => definition.kind === "belt")
          .sort((left, right) => left.sequence - right.sequence);
        setCatalog({ status: "ready", belts });
      })
      .catch(() => {
        if (mounted) setCatalog({ status: "error" });
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!studentId || !definitionKey || notes.trim().length < 3) {
      setMessage({ tone: "error", text: "Choose a student, a belt and write a short note." });
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const opened = await openStudentLevel({
        studentId,
        definitionKey,
        decisionNotes: notes.trim(),
      });
      // T113: out of band is allowed and said out loud. Silence here would mean the student never
      // shows up as a recognition candidate and nobody knows why.
      setMessage({
        tone: "success",
        text: opened.ageBand.met
          ? `Level record opened for student ${studentId}.`
          : `Level record opened for student ${studentId}. Outside the catalog age band ` +
            `(${describeAgeBand(opened.ageBand)}): the record is open, but no promotion will be ` +
            `proposed for this student until the band is met.`,
      });
      onOpened?.(studentId, definitionKey);
      setNotes("");
    } catch {
      setMessage({
        tone: "error",
        text: "Unable to open the level record. It may already be open or the belt is not current.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="coach-payg-box" aria-labelledby="open-level-title">
      <h3 id="open-level-title">Open a student level record</h3>
      <p className="text-sm">
        Head coach only. Sets the belt the student holds today; stripes and promotions are still
        approved one by one.
      </p>
      <form className="coach-payg-form" onSubmit={(event) => void handleSubmit(event)}>
        <label htmlFor="open-level-student">
          Student
          <select
            className="coach-payg-input"
            disabled={busy || studentIds.length === 0}
            id="open-level-student"
            onChange={(event) => setStudentId(event.target.value)}
            required
            value={studentId}
          >
            <option value="">
              {studentIds.length === 0 ? "No students on this roster" : "Select a student"}
            </option>
            {studentIds.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="open-level-belt">
          Belt
          <select
            className="coach-payg-input"
            disabled={busy || catalog.status !== "ready"}
            id="open-level-belt"
            onChange={(event) => setDefinitionKey(event.target.value)}
            required
            value={definitionKey}
          >
            <option value="">
              {catalog.status === "loading"
                ? "Loading belts..."
                : catalog.status === "error"
                  ? "Catalog unavailable"
                  : "Select a belt"}
            </option>
            {catalog.status === "ready"
              ? catalog.belts.map((belt) => (
                  <option key={belt.definitionKey} value={belt.definitionKey}>
                    {belt.name}
                  </option>
                ))
              : null}
          </select>
        </label>
        <label htmlFor="open-level-notes">
          Notes
          <input
            className="coach-payg-input"
            disabled={busy}
            id="open-level-notes"
            maxLength={1000}
            onChange={(event) => setNotes(event.target.value)}
            required
            value={notes}
          />
        </label>
        <button
          className="button button-primary text-sm"
          disabled={busy || catalog.status !== "ready" || studentIds.length === 0}
          type="submit"
        >
          {busy ? "Opening..." : "Open level record"}
        </button>
      </form>
      {message ? (
        <p
          className={`notification notification-${message.tone}`}
          role={message.tone === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
