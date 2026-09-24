"use client";

import { useEffect, useState } from "react";

import {
  listDisclaimerAcceptances,
  type DisclaimerAcceptanceRow,
} from "../../../lib/disclaimer-status-client";

import "./acceptances.css";

/**
 * R15: who accepted the academy terms, per student. Names are shown by operator decision (Luis,
 * 2026-09-24), which overrides the T117 "counts, never who" rule for this audit only.
 */

/**
 * One CSV cell: quotes doubled, and a leading = + - @ tab or CR neutralised so a spreadsheet never
 * runs it.
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function toCsv(rows: readonly DisclaimerAcceptanceRow[]): string {
  const lines = [["name", "terms_version", "terms_accepted_at", "disclaimers"]];
  for (const row of rows) {
    lines.push([
      row.fullName,
      row.termsVersion ?? "",
      row.termsAcceptedAt ?? "",
      row.disclaimers ? "yes" : "no",
    ]);
  }
  return lines.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function downloadCsv(rows: readonly DisclaimerAcceptanceRow[]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "academy-terms-acceptances.csv";
  link.click();
  // Revoked a moment later: revoking straight after click can cancel the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AcceptancesPanel() {
  const [missingOnly, setMissingOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; rows: readonly DisclaimerAcceptanceRow[] }
  >({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void listDisclaimerAcceptances({ missingOnly })
      .then((rows) => {
        if (active) setState({ status: "ready", rows });
      })
      .catch((cause: unknown) => {
        if (active)
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : "Acceptances are unavailable.",
          });
      });
    return () => {
      active = false;
    };
  }, [missingOnly]);

  const query = search.trim().toLocaleLowerCase("en-GB");
  const rows =
    state.status === "ready"
      ? state.rows.filter((row) => row.fullName.toLocaleLowerCase("en-GB").includes(query))
      : [];

  return (
    <section className="acceptances" aria-labelledby="acceptances-title">
      <header className="waiver-admin-header">
        <p className="admin-page-eyebrow">Academy terms</p>
        <h2 id="acceptances-title">Acceptances</h2>
        <p>Every active member, whether they accepted the current terms and their disclaimers.</p>
      </header>

      <div className="acceptances-controls">
        <label className="acceptances-search">
          Search by name
          <input onChange={(event) => setSearch(event.target.value)} type="search" value={search} />
        </label>
        <label className="acceptances-missing">
          <input
            checked={missingOnly}
            onChange={(event) => setMissingOnly(event.target.checked)}
            type="checkbox"
          />{" "}
          Missing only
        </label>
        <button
          className="button button-secondary acceptances-download"
          disabled={state.status !== "ready" || rows.length === 0}
          onClick={() => downloadCsv(rows)}
          type="button"
        >
          Download CSV
        </button>
      </div>

      {state.status === "loading" ? (
        <div aria-busy="true" className="acceptances-skeleton" />
      ) : state.status === "error" ? (
        <p className="waiver-message waiver-message-error" role="alert">
          {state.message}
        </p>
      ) : rows.length === 0 ? (
        <p role="status">No members match.</p>
      ) : (
        <div className="acceptances-scroll">
          <table className="acceptances-table">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Terms</th>
                <th scope="col">Disclaimers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.studentId}>
                  <th scope="row">{row.fullName}</th>
                  <td>
                    {row.termsVersion ? (
                      <>
                        <span aria-hidden="true">✓</span> {row.termsVersion}
                        {row.termsAcceptedAt
                          ? ` · ${new Date(row.termsAcceptedAt).toLocaleDateString("en-GB")}`
                          : ""}
                      </>
                    ) : (
                      <span className="acceptances-missing-mark">
                        <span aria-hidden="true">✗</span> Missing
                      </span>
                    )}
                  </td>
                  <td>
                    {row.disclaimers ? (
                      <>
                        <span aria-hidden="true">✓</span> Accepted
                      </>
                    ) : (
                      <span className="acceptances-missing-mark">
                        <span aria-hidden="true">✗</span> Missing
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
