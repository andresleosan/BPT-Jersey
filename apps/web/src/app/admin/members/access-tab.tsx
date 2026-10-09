"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  manualProgressError,
  manualProgressLimits,
  type LevelCatalogProjection,
  type ProgressManagement,
} from "@bpt-jersey/domain/levels";
import type { MemberOverviewRow } from "@bpt-jersey/domain/members/overview";
import type { ProgramRecord } from "@bpt-jersey/domain/schedule";
import {
  ageOnDate,
  ageRangeAdmits,
  ageRangeLabel,
  dateKeyInJersey,
  type MemberAgeRange,
  type SaveStudentAgeRange,
  type StudentGroupAccess,
} from "@bpt-jersey/domain/schedule/member-calendar";

import { getLevelCatalog } from "../../../lib/levels-client";
import {
  getProgressManagement,
  setProgressClassCount,
  setProgressLevel,
} from "../../../lib/progress-management-client";
import { getScheduleCatalog } from "../../../lib/schedule-client";
import {
  getStudentGroupAccess,
  listStudentAccessExceptions,
  saveStudentAgeRange,
  type AccessExceptionRow,
} from "../../../lib/student-group-access-client";
import { AdminDataTable } from "../admin-data-table";
import { GroupAccessEditor } from "./profile/group-access-editor";

type Bounds = Readonly<{ minAge: number; maxAge: number | null }>;
type Member = Readonly<{ studentId: string; fullName: string; age?: number | undefined }>;

const conflictMessage = "Another administrator changed this access. Reload before saving again.";

function messageOf(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong. Please try again.";
}

function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function yearsLabel(dateOfBirth: string | null, today: string): string {
  return dateOfBirth ? `${ageOnDate(dateOfBirth, today)} years` : "Age unknown";
}

function dayLabel(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function earliest(...keys: readonly (string | null | undefined)[]): string | null {
  const present = keys.filter((key): key is string => typeof key === "string");
  return present.length ? [...present].sort()[0]! : null;
}

function sameRange(left: MemberAgeRange | null | undefined, right: MemberAgeRange | null | undefined) {
  return (
    (left ?? null) === (right ?? null) ||
    (!!left &&
      !!right &&
      left.minAge === right.minAge &&
      left.maxAge === right.maxAge &&
      (left.reason ?? "") === (right.reason ?? "") &&
      (left.expiresOn ?? null) === (right.expiresOn ?? null))
  );
}

/** Whole number from 3 to 99, or undefined when the field does not hold one. */
function ageValue(text: string): number | undefined {
  if (!/^\d{1,2}$/u.test(text.trim())) return undefined;
  const value = Number(text);
  return value >= 3 && value <= 99 ? value : undefined;
}

export function AccessTab({ rows, isOwner }: { rows: readonly MemberOverviewRow[]; isOwner: boolean }) {
  const today = dateKeyInJersey(new Date());
  const [exceptions, setExceptions] = useState<readonly AccessExceptionRow[] | null>(null);
  const [listError, setListError] = useState<string>();
  const [listToken, setListToken] = useState(0);
  const [programs, setPrograms] = useState<readonly ProgramRecord[]>([]);
  const [programsError, setProgramsError] = useState(false);
  const [query, setQuery] = useState("");
  const [member, setMember] = useState<Member | null>(null);

  useEffect(() => {
    getScheduleCatalog().then(
      (catalog) => setPrograms(catalog.programs),
      () => setProgramsError(true),
    );
  }, []);

  useEffect(() => {
    let live = true;
    setListError(undefined);
    listStudentAccessExceptions().then(
      (next) => live && setExceptions(next),
      (failure: unknown) => {
        if (!live) return;
        setExceptions([]);
        setListError(messageOf(failure));
      },
    );
    return () => {
      live = false;
    };
  }, [listToken]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return rows
      .filter((row) => row.rowKind === "member" && row.fullName.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [rows, query]);

  const programName = (id: string) =>
    programs.find((program) => program.programId === id)?.name ?? "Unavailable group";

  return (
    <section className="admin-panel-card access-tab" aria-labelledby="access-tab-title">
      <header className="access-head">
        <p className="admin-eyebrow">Members / Access</p>
        <h3 id="access-tab-title">Access exceptions</h3>
        <p className="access-lead">
          Let a member book classes for an older age range, or extra class types. Their plan,
          centres and weekly limit still apply.
        </p>
      </header>

      {listError ? (
        <p className="progress-manage-error" role="alert">
          {listError}
        </p>
      ) : null}

      {programsError ? (
        <p className="progress-manage-error" role="alert">
          Class types are unavailable. Reload to see which types open.
        </p>
      ) : null}

      {exceptions === null ? (
        <>
          <p className="visually-hidden" role="status">
            Loading access exceptions
          </p>
          <div aria-hidden="true" className="access-skeleton" />
        </>
      ) : exceptions.length === 0 ? (
        listError ? null : (
          <div className="access-empty" role="status">
            <p className="admin-eyebrow">Access</p>
            <p className="access-empty-title">No exceptions yet</p>
            <p>Search a member below to add one.</p>
          </div>
        )
      ) : (
        <AdminDataTable
          caption="Members with access exceptions"
          columns={[
            {
              key: "member",
              label: "Member",
              render: (row) => (
                <span className="access-member-cell">
                  <strong>{row.fullName || "Unnamed member"}</strong>
                  <span>{yearsLabel(row.dateOfBirth, today)}</span>
                </span>
              ),
            },
            {
              key: "range",
              label: "Age range",
              render: (row) => (row.ageRange ? ageRangeLabel(row.ageRange) : "—"),
            },
            {
              key: "extra",
              label: "Extra classes",
              render: (row) =>
                row.programIds.length ? row.programIds.map(programName).join(", ") : "—",
            },
            {
              key: "ends",
              label: "Ends",
              render: (row) => {
                const ends = earliest(row.ageRange?.expiresOn, row.expiresOn);
                return ends ? dayLabel(ends) : "—";
              },
            },
            {
              key: "action",
              label: "Action",
              render: (row) => (
                <button
                  aria-label={`Edit access for ${row.fullName}`}
                  className="membership-table-button"
                  onClick={() =>
                    setMember({
                      studentId: row.studentId,
                      fullName: row.fullName,
                      ...(row.dateOfBirth ? { age: ageOnDate(row.dateOfBirth, today) } : {}),
                    })
                  }
                  type="button"
                >
                  Edit
                </button>
              ),
            },
          ]}
          rowKey={(row) => row.studentId}
          rows={exceptions}
        />
      )}

      <div className="admin-filter-bar">
        <label className="admin-filter-control members-search">
          Member
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type at least 2 letters of a name"
            type="search"
            value={query}
          />
        </label>
      </div>
      {matches.length > 0 ? (
        <ul className="progress-manage-matches" aria-label="Matching members">
          {matches.map((row) => (
            <li key={row.studentId}>
              <button
                className="membership-table-button"
                onClick={() => {
                  setMember({ studentId: row.studentId, fullName: row.fullName, age: row.age });
                  setQuery("");
                }}
                type="button"
              >
                {row.fullName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {member ? (
        <MemberAccess
          isOwner={isOwner}
          key={member.studentId}
          member={member}
          onSaved={() => setListToken((token) => token + 1)}
          programs={programs}
          programsError={programsError}
          today={today}
        />
      ) : null}
    </section>
  );
}

function MemberAccess({
  isOwner,
  member,
  onSaved,
  programs,
  programsError,
  today,
}: {
  isOwner: boolean;
  member: Member;
  onSaved: () => void;
  programs: readonly ProgramRecord[];
  programsError: boolean;
  today: string;
}) {
  const { studentId, fullName } = member;
  const heading = useRef<HTMLHeadingElement>(null);
  const [access, setAccess] = useState<StudentGroupAccess>();
  const [loadError, setLoadError] = useState<string>();
  const [accessToken, setAccessToken] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [reason, setReason] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [confirmAdult, setConfirmAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    setLoadError(undefined);
    getStudentGroupAccess(studentId).then(
      (next) => {
        if (!live) return;
        setAccess(next);
        const range = next.ageRange ?? null;
        setMinAge(range ? String(range.minAge) : "");
        setMaxAge(range?.maxAge != null ? String(range.maxAge) : "");
        setReason(range?.reason ?? "");
        setExpiresOn(range?.expiresOn ?? "");
        setConfirmAdult(false);
      },
      (failure: unknown) => live && setLoadError(messageOf(failure)),
    );
    return () => {
      live = false;
    };
  }, [studentId, accessToken]);

  const dateOfBirth = access?.dateOfBirth ?? null;
  const realAge = dateOfBirth ? ageOnDate(dateOfBirth, today) : (member.age ?? null);
  const min = ageValue(minAge);
  const max = maxAge.trim() === "" ? null : ageValue(maxAge);
  const range: Bounds | null =
    min !== undefined && max !== undefined && (max === null || max >= min)
      ? { minAge: min, maxAge: max }
      : null;
  const rangeError =
    minAge.trim() === "" && maxAge.trim() === ""
      ? undefined
      : min === undefined
        ? "Enter From as a whole number from 3 to 99."
        : max === undefined
          ? "Enter To as a whole number from 3 to 99, or leave it empty for no upper age."
          : range === null
            ? "To must not be below From."
            : undefined;
  // Same reading as the server: a type with no age range already admits everyone.
  const opens = range
    ? programs.filter(
        (program) => program.active && program.ageRange && ageRangeAdmits(program.ageRange, range),
      )
    : [];
  const adultWarning =
    dateOfBirth !== null &&
    realAge !== null &&
    realAge < 16 &&
    range !== null &&
    (range.maxAge === null || range.maxAge >= 16);
  const saved = access?.ageRange ?? null;

  async function submit(next: SaveStudentAgeRange["ageRange"]) {
    if (!access) return;
    setBusy(true);
    setError(undefined);
    setConflict(false);
    setNotice(undefined);
    try {
      // The extra-classes editor shares the revision; re-read it, but refuse if the range moved.
      const fresh = await getStudentGroupAccess(studentId);
      if (!sameRange(fresh.ageRange, access.ageRange)) {
        setConflict(true);
        setError(conflictMessage);
        return;
      }
      const result = await saveStudentAgeRange({ studentId, revision: fresh.revision, ageRange: next });
      setAccess(result);
      setConfirmAdult(false);
      if (!result.ageRange) {
        setMinAge("");
        setMaxAge("");
        setReason("");
        setExpiresOn("");
      }
      setSavedCount((count) => count + 1);
      setNotice(
        next
          ? "Age range saved. The member's calendar updates on its next refresh."
          : "Age range removed. The member's calendar updates on its next refresh.",
      );
      onSaved();
    } catch (failure) {
      if (codeOf(failure) === "functions/aborted") {
        setConflict(true);
        setError(conflictMessage);
      } else {
        setError(messageOf(failure));
      }
    } finally {
      setBusy(false);
    }
  }

  function saveRange() {
    if (rangeError || !range) {
      setError(rangeError ?? "Enter the age range From.");
      return;
    }
    if (reason.trim() === "") {
      setError("Enter a reason for the age range.");
      return;
    }
    if (expiresOn && expiresOn < today) {
      setError("The end date has already passed.");
      return;
    }
    void submit({ ...range, reason: reason.trim(), expiresOn: expiresOn || null });
  }

  function removeRange() {
    if (!window.confirm(`Remove the age range for ${fullName}?`)) return;
    void submit(null);
  }

  return (
    <section className="admin-panel-card access-member" aria-labelledby="access-member-title">
      <h3 id="access-member-title" ref={heading} tabIndex={-1}>
        {fullName}
        {realAge !== null ? ` · ${realAge} years` : ""}
      </h3>

      {loadError ? (
        <div className="access-load-error">
          <p className="progress-manage-error" role="alert">
            {loadError}
          </p>
          <button
            className="membership-table-button"
            onClick={() => setAccessToken((token) => token + 1)}
            type="button"
          >
            Reload
          </button>
        </div>
      ) : null}

      <div className="access-grid">
        <fieldset className="progress-manage-block access-range" disabled={!access || busy}>
          <legend>Age range</legend>
          {!access && !loadError ? (
            <p className="progress-manage-note" role="status">
              Loading the saved range…
            </p>
          ) : null}
          <div className="access-range-pair">
            <label className="admin-filter-control">
              From
              <input
                inputMode="numeric"
                max={99}
                min={3}
                onChange={(event) => {
                  setNotice(undefined);
                  setMinAge(event.target.value);
                }}
                type="number"
                value={minAge}
              />
            </label>
            <label className="admin-filter-control">
              To
              <input
                aria-describedby="access-to-help"
                inputMode="numeric"
                max={99}
                min={3}
                onChange={(event) => {
                  setNotice(undefined);
                  setMaxAge(event.target.value);
                }}
                type="number"
                value={maxAge}
              />
            </label>
          </div>
          <p className="access-opens" id="access-to-help">
            Leave To empty for no upper age.
          </p>
          <p aria-live="polite" className="access-opens">
            {rangeError
              ? rangeError
              : programsError
                ? ""
                : range
                  ? opens.length
                    ? `Opens: ${opens.map((program) => program.name).join(", ")}`
                    : "Opens no extra class types"
                  : "Enter From to see which class types open."}
          </p>

          {adultWarning ? (
            <div className="access-warning" role="alert">
              <p className="access-warning-title">Adult classes</p>
              <p>This member is under 16 and will be able to book adult (16+) classes.</p>
              <label className="access-confirm">
                <input
                  checked={confirmAdult}
                  onChange={(event) => setConfirmAdult(event.target.checked)}
                  type="checkbox"
                />
                I confirm adult classes are appropriate
              </label>
            </div>
          ) : null}

          <label className="admin-filter-control">
            Reason
            <textarea
              aria-describedby="access-reason-help"
              maxLength={500}
              onChange={(event) => {
                setNotice(undefined);
                setReason(event.target.value);
              }}
              required
              rows={3}
              value={reason}
            />
          </label>
          <p className="access-opens" id="access-reason-help">
            Required. Only the office can read it.
          </p>
          <label className="admin-filter-control">
            Ends on (optional)
            <input
              min={today}
              onChange={(event) => {
                setNotice(undefined);
                setExpiresOn(event.target.value);
              }}
              type="date"
              value={expiresOn}
            />
          </label>

          <div aria-live="polite">
            {error ? (
              <div className="access-load-error">
                <p className="progress-manage-error" role="alert">
                  {error}
                </p>
                {conflict ? (
                  <button
                    className="membership-table-button"
                    onClick={() => {
                      setError(undefined);
                      setConflict(false);
                      setAccessToken((token) => token + 1);
                    }}
                    type="button"
                  >
                    Reload
                  </button>
                ) : null}
              </div>
            ) : null}
            {notice ? (
              <p className="progress-manage-note" role="status">
                {notice}
              </p>
            ) : null}
          </div>

          <div className="access-actions">
            <button
              className="button"
              disabled={!access || busy || (adultWarning && !confirmAdult)}
              onClick={saveRange}
              type="button"
            >
              {busy ? "Saving…" : "Save age range"}
            </button>
            {saved ? (
              <button
                className="membership-table-button"
                disabled={busy}
                onClick={removeRange}
                type="button"
              >
                Remove range
              </button>
            ) : null}
          </div>
        </fieldset>

        <div className="progress-manage-block access-extra">
          {/* Shares the access revision: remount after each range save so it re-reads it. */}
          <GroupAccessEditor key={`${studentId}-${savedCount}`} studentId={studentId} />
        </div>

        {isOwner ? (
          <LevelBlock range={range} studentId={studentId} today={today} />
        ) : (
          <p className="progress-manage-note access-level-note">
            Only the owner can change the level.
          </p>
        )}
      </div>
    </section>
  );
}

function LevelBlock({
  range,
  studentId,
  today,
}: {
  range: Bounds | null;
  studentId: string;
  today: string;
}) {
  const [catalog, setCatalog] = useState<LevelCatalogProjection | null>(null);
  const [data, setData] = useState<ProgressManagement | null>(null);
  const [token, setToken] = useState(0);
  const [definitionKey, setDefinitionKey] = useState("");
  const [classes, setClasses] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    getLevelCatalog().then(setCatalog, (failure: unknown) => setError(messageOf(failure)));
  }, []);

  useEffect(() => {
    let live = true;
    getProgressManagement(studentId).then(
      (next) => {
        if (!live) return;
        setData(next);
        setDefinitionKey(next.currentDefinitionKey ?? "");
        setClasses(next.classesAtLevel);
      },
      (failure: unknown) => live && setError(messageOf(failure)),
    );
    return () => {
      live = false;
    };
  }, [studentId, token]);

  const definitions = useMemo(
    () => [...(catalog?.definitions ?? [])].sort((a, b) => a.sequence - b.sequence),
    [catalog],
  );
  const options = useMemo(() => {
    if (!range) return definitions;
    // The saved level and the one picked here always stay selectable.
    const kept = (key: string) => key === data?.currentDefinitionKey || key === definitionKey;
    const fitting = definitions.filter(
      (definition) =>
        kept(definition.definitionKey) ||
        ageRangeAdmits(
          { minAge: definition.criteria.minAge ?? 0, maxAge: definition.criteria.maxAge },
          range,
        ),
    );
    return fitting.some((definition) => !kept(definition.definitionKey)) ? fitting : definitions;
  }, [definitions, range, data?.currentDefinitionKey, definitionKey]);
  const limits = manualProgressLimits(definitions, definitionKey);
  const levelChanged = data !== null && definitionKey !== (data.currentDefinitionKey ?? "");
  const classesChanged = data !== null && classes !== data.classesAtLevel;
  const changed = levelChanged || (classesChanged && limits.classes !== null);

  function save() {
    if (!data || definitionKey === "" || !changed) return;
    const counts = limits.classes !== null ? { classes } : {};
    const countError = manualProgressError(limits, counts);
    if (countError !== null) {
      setError(countError);
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    // Only a new level restarts its time; a class count alone keeps the level and its start date.
    const request = levelChanged
      ? setProgressLevel({
          studentId,
          definitionKey,
          startedOn: today,
          ...counts,
          reason: "Age range access",
        })
      : setProgressClassCount({
          studentId,
          definitionKey: data.currentDefinitionKey ?? undefined,
          classes,
          reason: "Age range access",
        });
    request
      .then(
        () => {
          setNotice("Level saved.");
          setToken((value) => value + 1);
        },
        (failure: unknown) => setError(messageOf(failure)),
      )
      .finally(() => setBusy(false));
  }

  return (
    <fieldset className="progress-manage-block access-level" disabled={busy}>
      <legend>Level</legend>
      {data === null || catalog === null ? (
        error ? null : (
          <p className="progress-manage-note" role="status">
            Loading the level…
          </p>
        )
      ) : !data.initialized ? (
        <p className="progress-manage-note" role="status">
          No level yet. Open their level from their member record first.
        </p>
      ) : (
        <>
          <label className="admin-filter-control">
            Belt / stripe
            <select
              onChange={(event) => {
                const key = event.target.value;
                setDefinitionKey(key);
                setNotice(undefined);
                // D5: keep the count, trimmed to what the new level allows.
                const cap = manualProgressLimits(definitions, key).classes;
                setClasses((value) => (cap === null ? value : Math.min(value, cap)));
              }}
              value={definitionKey}
            >
              {options.map((definition) => (
                <option key={definition.definitionKey} value={definition.definitionKey}>
                  {definition.name}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-filter-control">
            Classes done at this level
            <input
              disabled={limits.classes === null}
              max={limits.classes ?? undefined}
              min={0}
              onChange={(event) =>
                setClasses(Math.max(0, Math.floor(Number(event.target.value) || 0)))
              }
              type="number"
              value={classes}
            />
          </label>
          <p className="access-opens">
            {limits.classes === null
              ? "This level has no class requirement to adjust."
              : `From 0 to ${limits.classes}.${levelChanged ? " The level starts today." : ""}`}
          </p>
          <button className="button" disabled={busy || !changed} onClick={save} type="button">
            {busy ? "Saving…" : "Save level"}
          </button>
        </>
      )}
      <div aria-live="polite">
        {error ? (
          <p className="progress-manage-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="progress-manage-note" role="status">
            {notice}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
