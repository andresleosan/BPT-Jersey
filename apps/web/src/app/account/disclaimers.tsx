"use client";

import { useEffect, useState } from "react";

import type { OutstandingDisclaimer } from "@bpt-jersey/domain/consents/disclaimers";

import { acceptDisclaimer, getOutstandingDisclaimers } from "../../lib/disclaimers-client";

/**
 * T117: what this participant still has to read.
 *
 * Two things this panel is careful about. It sends back the hash of the text it actually rendered,
 * so accepting always refers to the words on the screen. And when the participant accepted an
 * earlier version, it says so, because being asked again after a rewording is a different thing
 * from being asked for the first time and pretending otherwise would be dishonest.
 */
export function DisclaimersPanel({ studentId }: { studentId: string }) {
  const [outstanding, setOutstanding] = useState<readonly OutstandingDisclaimer[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    setStatus("loading");
    void getOutstandingDisclaimers(studentId)
      .then((next) => {
        if (!active) return;
        setOutstanding(next);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [studentId]);

  async function handleAccept(entry: OutstandingDisclaimer): Promise<void> {
    setBusyId(entry.disclaimer.disclaimerId);
    setActionError("");
    try {
      await acceptDisclaimer({
        disclaimerId: entry.disclaimer.disclaimerId,
        studentId: entry.studentId,
        // The hash of the text rendered above, not of whatever is published now.
        contentHash: entry.disclaimer.contentHash,
      });
      setOutstanding((current) =>
        current.filter(
          (candidate) => candidate.disclaimer.disclaimerId !== entry.disclaimer.disclaimerId,
        ),
      );
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Unable to record that acceptance.");
    } finally {
      setBusyId(undefined);
    }
  }

  if (status === "loading") {
    return (
      <section aria-labelledby="disclaimers-title">
        <h2 id="disclaimers-title">Disclaimers</h2>
        <p role="status">Loading your disclaimers…</p>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section aria-labelledby="disclaimers-title">
        <h2 id="disclaimers-title">Disclaimers</h2>
        <p role="alert">Unable to load your disclaimers. Please try again.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="disclaimers-title">
      <h2 id="disclaimers-title">Disclaimers</h2>
      {outstanding.length === 0 ? (
        <p>There is nothing for you to read right now.</p>
      ) : (
        <ul>
          {outstanding.map((entry) => (
            <li key={entry.disclaimer.disclaimerId}>
              <h3>{entry.disclaimer.title}</h3>
              <p>
                {entry.disclaimer.required ? "Required" : "Optional"} &middot; version{" "}
                {entry.disclaimer.versionLabel}
              </p>
              {entry.previouslyAcceptedVersionLabel === null ? null : (
                <p>
                  You accepted version {entry.previouslyAcceptedVersionLabel}. The wording has
                  changed, so this asks you again.
                </p>
              )}
              <p>{entry.disclaimer.body}</p>
              <button
                disabled={busyId !== undefined}
                onClick={() => void handleAccept(entry)}
                type="button"
              >
                Accept this version
              </button>
            </li>
          ))}
        </ul>
      )}
      {actionError ? <p role="alert">{actionError}</p> : null}
    </section>
  );
}
