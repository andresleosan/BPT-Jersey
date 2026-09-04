"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  AdminDirectoryRow,
  MemberRecordMaintenanceDetail,
  PublicAdminIdentifierLookupKind,
} from "@bpt-jersey/domain/members/directory";
import { maskMembershipReference } from "@bpt-jersey/domain/members/directory";
import type {
  RegyfitMemberDirectoryPage,
  RegyfitMemberDirectoryRow,
  RegyfitMemberRecord,
} from "@bpt-jersey/domain/members/regyfit-records";

import {
  getMemberDetail,
  getRegyfitMemberRecord,
  listRegyfitMemberRecords,
  lookupMemberIdentity,
  updateMember,
  type UpdateMemberInput,
} from "../../../../lib/members-client";
import { AdminStatusBadge } from "../../admin-ui";
import { MemberProfilePanel } from "./member-profile-panel";

import "../../admin.css";

type LookupState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "no-match" }>
  | Readonly<{ status: "match"; row: AdminDirectoryRow }>
  | Readonly<{ status: "error" }>;

type DetailState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "loaded"; detail: MemberRecordMaintenanceDetail }>
  | Readonly<{ status: "error" }>;

type DirectoryState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "loaded"; page: RegyfitMemberDirectoryPage }>
  | Readonly<{ status: "error" }>;

type RecordState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading"; recordId: string }>
  | Readonly<{ status: "loaded"; record: RegyfitMemberRecord }>
  | Readonly<{ status: "error"; recordId: string }>;

function displayOptional(value: string | undefined): string {
  return value === undefined || value.length === 0 ? "Not provided" : value;
}

type MemberEditDraft = Readonly<{
  fullName: string;
  dateOfBirth: string;
  phoneNumber: string;
  email: string;
  trainingCenter: "Town" | "West";
  trainingTimePreferences: readonly ("morning" | "afternoon" | "evening")[];
  membershipNumber: string;
  idCardNumber: string;
  vatNumber: string;
  gender: "male" | "female" | "unknown";
  frequencyNote: string;
}>;

function detailToDraft(detail: MemberRecordMaintenanceDetail): MemberEditDraft {
  return Object.freeze({
    fullName: detail.fullName,
    dateOfBirth: detail.dateOfBirth,
    phoneNumber: detail.phoneNumber ?? "",
    email: detail.email ?? "",
    trainingCenter: detail.trainingCenter,
    trainingTimePreferences: Object.freeze([...detail.trainingTimePreferences]),
    membershipNumber: detail.membershipNumber ?? "",
    idCardNumber: detail.idCardNumber ?? "",
    vatNumber: detail.vatNumber ?? "",
    gender: detail.gender,
    frequencyNote: detail.frequencyNote ?? "",
  });
}

function optionalTrimmed(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function updatePayload(
  detail: MemberRecordMaintenanceDetail,
  draft: MemberEditDraft,
  requestId: string,
): UpdateMemberInput {
  const phoneNumber = optionalTrimmed(draft.phoneNumber);
  const email = optionalTrimmed(draft.email);
  const membershipNumber = optionalTrimmed(draft.membershipNumber);
  const idCardNumber = optionalTrimmed(draft.idCardNumber);
  const vatNumber = optionalTrimmed(draft.vatNumber);
  const frequencyNote = optionalTrimmed(draft.frequencyNote);
  return Object.freeze({
    studentId: detail.studentId,
    requestId,
    fullName: draft.fullName.trim(),
    dateOfBirth: draft.dateOfBirth,
    ...(phoneNumber === undefined ? {} : { phoneNumber }),
    ...(email === undefined ? {} : { email }),
    trainingCenter: draft.trainingCenter,
    trainingTimePreferences: Object.freeze([...draft.trainingTimePreferences]),
    ...(membershipNumber === undefined ? {} : { membershipNumber }),
    ...(idCardNumber === undefined ? {} : { idCardNumber }),
    ...(vatNumber === undefined ? {} : { vatNumber }),
    gender: draft.gender,
    ...(frequencyNote === undefined ? {} : { frequencyNote }),
  });
}

function updatedDetail(
  current: MemberRecordMaintenanceDetail,
  input: UpdateMemberInput,
): MemberRecordMaintenanceDetail {
  return Object.freeze({
    studentId: current.studentId,
    fullName: input.fullName,
    dateOfBirth: input.dateOfBirth,
    ...(input.phoneNumber === undefined ? {} : { phoneNumber: input.phoneNumber }),
    ...(input.email === undefined ? {} : { email: input.email }),
    trainingCenter: input.trainingCenter,
    trainingTimePreferences: Object.freeze([...input.trainingTimePreferences]),
    participantType: current.participantType,
    active: current.active,
    status: current.status,
    ...(input.membershipNumber === undefined ? {} : { membershipNumber: input.membershipNumber }),
    ...(input.idCardNumber === undefined ? {} : { idCardNumber: input.idCardNumber }),
    ...(input.vatNumber === undefined ? {} : { vatNumber: input.vatNumber }),
    gender: input.gender,
    ...(input.frequencyNote === undefined ? {} : { frequencyNote: input.frequencyNote }),
  });
}

function RestrictedDetail({
  detail,
  onUpdated,
}: {
  detail: MemberRecordMaintenanceDetail;
  onUpdated: (detail: MemberRecordMaintenanceDetail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MemberEditDraft>(() => detailToDraft(detail));
  const [requestId, setRequestId] = useState<string>();
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error" | "success">("idle");

  function newRequestId(): string {
    return globalThis.crypto.randomUUID();
  }

  function beginEdit(): void {
    setDraft(detailToDraft(detail));
    setRequestId(newRequestId());
    setSaveStatus("idle");
    setEditing(true);
  }

  function replaceDraft(next: Partial<MemberEditDraft>): void {
    setDraft((current) => Object.freeze({ ...current, ...next }));
    setRequestId(newRequestId());
    setSaveStatus("idle");
  }

  function cancelEdit(): void {
    setEditing(false);
    setRequestId(undefined);
    setSaveStatus("idle");
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (requestId === undefined) {
      setSaveStatus("error");
      return;
    }
    const payload = updatePayload(detail, draft, requestId);
    setSaveStatus("saving");
    try {
      await updateMember(payload);
      onUpdated(updatedDetail(detail, payload));
      setEditing(false);
      setRequestId(undefined);
      setSaveStatus("success");
    } catch {
      setSaveStatus("error");
    }
  }

  return (
    <section aria-labelledby="member-restricted-detail-title">
      <h3 id="member-restricted-detail-title">Restricted member details</h3>
      <dl>
        <dt>Date of birth</dt>
        <dd>{detail.dateOfBirth}</dd>
        <dt>Phone number</dt>
        <dd>{displayOptional(detail.phoneNumber)}</dd>
        <dt>Email</dt>
        <dd>{displayOptional(detail.email)}</dd>
        <dt>Training time preferences</dt>
        <dd>{detail.trainingTimePreferences.join(", ")}</dd>
        <dt>Membership number</dt>
        <dd>{displayOptional(detail.membershipNumber)}</dd>
        <dt>ID card number</dt>
        <dd>{displayOptional(detail.idCardNumber)}</dd>
        <dt>VAT number</dt>
        <dd>{displayOptional(detail.vatNumber)}</dd>
        <dt>Gender</dt>
        <dd>{detail.gender}</dd>
        <dt>Frequency note</dt>
        <dd>{displayOptional(detail.frequencyNote)}</dd>
      </dl>
      {editing ? (
        <form aria-label="Edit member" onSubmit={(event) => void save(event)}>
          <div className="login-field">
            <label htmlFor="member-edit-full-name">Full name</label>
            <input
              id="member-edit-full-name"
              maxLength={160}
              onChange={(event) => replaceDraft({ fullName: event.target.value })}
              required
              type="text"
              value={draft.fullName}
            />
          </div>
          <div className="login-field">
            <label htmlFor="member-edit-date-of-birth">Date of birth</label>
            <input
              id="member-edit-date-of-birth"
              onChange={(event) => replaceDraft({ dateOfBirth: event.target.value })}
              required
              type="date"
              value={draft.dateOfBirth}
            />
          </div>
          <div className="login-field">
            <label htmlFor="member-edit-phone">Phone number</label>
            <input
              id="member-edit-phone"
              maxLength={64}
              onChange={(event) => replaceDraft({ phoneNumber: event.target.value })}
              type="tel"
              value={draft.phoneNumber}
            />
          </div>
          <div className="login-field">
            <label htmlFor="member-edit-email">Email</label>
            <input
              id="member-edit-email"
              maxLength={320}
              onChange={(event) => replaceDraft({ email: event.target.value })}
              type="email"
              value={draft.email}
            />
          </div>
          <div className="login-field">
            <label htmlFor="member-edit-training-center">Training center</label>
            <select
              id="member-edit-training-center"
              onChange={(event) =>
                replaceDraft({ trainingCenter: event.target.value as "Town" | "West" })
              }
              value={draft.trainingCenter}
            >
              <option value="Town">Town</option>
              <option value="West">West</option>
            </select>
          </div>
          <fieldset>
            <legend>Training time preferences</legend>
            {(["morning", "afternoon", "evening"] as const).map((preference) => (
              <label key={preference}>
                <input
                  checked={draft.trainingTimePreferences.includes(preference)}
                  onChange={(event) =>
                    replaceDraft({
                      trainingTimePreferences: event.target.checked
                        ? Object.freeze([...draft.trainingTimePreferences, preference])
                        : Object.freeze(
                            draft.trainingTimePreferences.filter(
                              (current) => current !== preference,
                            ),
                          ),
                    })
                  }
                  type="checkbox"
                />
                {preference[0]?.toUpperCase()}
                {preference.slice(1)}
              </label>
            ))}
          </fieldset>
          {(
            [
              ["Membership number", "member-edit-membership", "membershipNumber"],
              ["ID card number", "member-edit-id-card", "idCardNumber"],
              ["VAT number", "member-edit-vat", "vatNumber"],
              ["Frequency note", "member-edit-frequency", "frequencyNote"],
            ] as const
          ).map(([label, id, field]) => (
            <div className="login-field" key={field}>
              <label htmlFor={id}>{label}</label>
              <input
                id={id}
                maxLength={field === "frequencyNote" ? 256 : 64}
                onChange={(event) => replaceDraft({ [field]: event.target.value })}
                type="text"
                value={draft[field]}
              />
            </div>
          ))}
          <div className="login-field">
            <label htmlFor="member-edit-gender">Gender</label>
            <select
              id="member-edit-gender"
              onChange={(event) =>
                replaceDraft({ gender: event.target.value as MemberEditDraft["gender"] })
              }
              value={draft.gender}
            >
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
          <button disabled={saveStatus === "saving"} type="submit">
            {saveStatus === "saving" ? "Saving..." : "Save changes"}
          </button>
          <button disabled={saveStatus === "saving"} onClick={cancelEdit} type="button">
            Cancel
          </button>
        </form>
      ) : (
        <button className="regyfit-filter-button" onClick={beginEdit} type="button">
          Edit member
        </button>
      )}
      {saveStatus === "error" ? (
        <p aria-live="assertive" role="alert">
          Unable to update member. Please try again.
        </p>
      ) : null}
      {saveStatus === "success" ? (
        <p aria-live="polite" role="status">
          Member updated.
        </p>
      ) : null}
    </section>
  );
}

function matchesQuery(row: RegyfitMemberDirectoryRow, query: string): boolean {
  const haystacks = [row.fullName, row.memberNumber, row.email, row.mobile, row.birthDate];
  return haystacks.some((value) => value !== undefined && value.toLowerCase().includes(query));
}

function AcademyMemberDirectorySection({
  directory,
  onRetry,
  onSelectRecord,
  selectedRecordId,
}: {
  directory: DirectoryState;
  onRetry: () => void;
  onSelectRecord: (row: RegyfitMemberDirectoryRow) => void;
  selectedRecordId: string | undefined;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const rows = useMemo(
    () => (directory.status === "loaded" ? directory.page.rows : []),
    [directory],
  );
  const paymentModes = useMemo(
    () =>
      [...new Set(rows.map((row) => row.paymentMode).filter((mode) => mode !== undefined))].sort(),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return rows.filter(
      (row) =>
        (query.length === 0 || matchesQuery(row, query)) &&
        (stateFilter === "all" || row.membershipState === stateFilter) &&
        (paymentFilter === "all" || row.paymentMode === paymentFilter),
    );
  }, [rows, searchQuery, stateFilter, paymentFilter]);

  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
  const safePage = Math.min(page, totalPages - 1);
  const currentRows = filteredRows.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const activeCount = rows.filter((row) => row.membershipState === "active").length;
  const inactiveCount = rows.length - activeCount;
  const numberedCount = rows.filter((row) => row.memberNumber !== undefined).length;

  return (
    <section
      className="admin-panel-card"
      style={{ marginBottom: "2.5rem" }}
      aria-labelledby="directory-search-heading"
    >
      <div className="admin-panel-card-heading">
        <div>
          <p className="admin-eyebrow">Members / Regyfit academy records</p>
          <h3 id="directory-search-heading">
            Academy member directory{rows.length > 0 ? ` (${rows.length} records)` : ""}
          </h3>
        </div>
      </div>

      {directory.status === "loaded" ? (
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", margin: "1rem 0" }}>
          <span className="admin-status-badge admin-status-active">Total: {rows.length}</span>
          <span className="admin-status-badge admin-status-active">Active: {activeCount}</span>
          <span className="admin-status-badge admin-status-attention">
            Inactive: {inactiveCount}
          </span>
          <span className="admin-status-badge admin-status-active">
            With member Nº: {numberedCount}
          </span>
          <span className="admin-status-badge admin-status-attention">
            No number: {rows.length - numberedCount}
          </span>
        </div>
      ) : null}

      <p style={{ color: "#4b5563", fontSize: "0.95rem", marginBottom: "1.25rem" }}>
        Search, filter and inspect the member records captured from Regyfit
        {directory.status === "loaded" && directory.page.capturedAt !== undefined
          ? ` on ${directory.page.capturedAt.slice(0, 10)}`
          : ""}
        . Click any member number to open that student&apos;s full record.
      </p>

      {directory.status === "loading" ? <p role="status">Loading academy directory...</p> : null}
      {directory.status === "error" ? (
        <div>
          <p aria-live="assertive" role="alert">
            Unable to load the academy directory. Please try again.
          </p>
          <button className="admin-auth-button" onClick={onRetry} type="button">
            Retry
          </button>
        </div>
      ) : null}

      {directory.status === "loaded" ? (
        <>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
            <div className="login-field" style={{ flex: "1 1 280px" }}>
              <label htmlFor="member-search-input">Search members</label>
              <input
                id="member-search-input"
                type="text"
                placeholder="Filter by name, member Nº, email, mobile or birthdate..."
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setPage(0);
                }}
              />
            </div>
            <div className="login-field" style={{ flex: "0 1 180px" }}>
              <label htmlFor="member-status-filter">Status filter</label>
              <select
                id="member-status-filter"
                value={stateFilter}
                onChange={(event) => {
                  setStateFilter(event.target.value);
                  setPage(0);
                }}
              >
                <option value="all">All statuses</option>
                <option value="active">Active ({activeCount})</option>
                <option value="inactive">Inactive ({inactiveCount})</option>
              </select>
            </div>
            <div className="login-field" style={{ flex: "0 1 200px" }}>
              <label htmlFor="member-payment-filter">Payment</label>
              <select
                id="member-payment-filter"
                value={paymentFilter}
                onChange={(event) => {
                  setPaymentFilter(event.target.value);
                  setPage(0);
                }}
              >
                <option value="all">All payment modes</option>
                {paymentModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: "0.75rem", fontSize: "0.875rem", color: "#6b7280" }}>
            Showing {filteredRows.length === 0 ? 0 : safePage * pageSize + 1} -{" "}
            {Math.min((safePage + 1) * pageSize, filteredRows.length)} of {filteredRows.length}{" "}
            members
          </div>

          <div className="admin-data-table-wrap">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Member Nº</th>
                  <th>Name</th>
                  <th>Birthdate</th>
                  <th>E-mail</th>
                  <th>Mobile Nº</th>
                  <th>Payment</th>
                  <th>Belt</th>
                  <th>Membership</th>
                </tr>
              </thead>
              <tbody>
                {currentRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: "2rem" }}>
                      No members match your search criteria.
                    </td>
                  </tr>
                ) : (
                  currentRows.map((row) => (
                    <tr
                      key={row.recordId}
                      {...(row.recordId === selectedRecordId
                        ? { "aria-current": "true" as const, style: { background: "#eef2ff" } }
                        : {})}
                    >
                      <td>
                        <button
                          type="button"
                          aria-label={`Open full record for ${row.fullName}`}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#4f46e5",
                            fontWeight: "bold",
                            cursor: "pointer",
                            textDecoration: "underline",
                          }}
                          onClick={() => onSelectRecord(row)}
                          title="Click to open the full member record"
                        >
                          {row.memberNumber ?? `#${row.recordId}`}
                        </button>
                      </td>
                      <td>
                        <strong>{row.fullName}</strong>
                      </td>
                      <td>{row.birthDate ?? "—"}</td>
                      <td>{row.email ?? "—"}</td>
                      <td>{row.mobile ?? "—"}</td>
                      <td>
                        {row.paymentMode === undefined ? (
                          "—"
                        ) : (
                          <AdminStatusBadge status={row.paymentMode} />
                        )}
                      </td>
                      <td>{row.belt ?? "—"}</td>
                      <td>
                        <AdminStatusBadge status={row.membershipState} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div
              className="admin-filter-bar"
              style={{
                marginTop: "1rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                Page {safePage + 1} of {totalPages}
              </span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  className="admin-auth-button"
                  type="button"
                  disabled={safePage === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                >
                  Previous
                </button>
                <button
                  className="admin-auth-button"
                  type="button"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function SearchMembersContent() {
  const [lookupKind, setLookupKind] =
    useState<PublicAdminIdentifierLookupKind>("membership-number");
  const [identifier, setIdentifier] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });
  const [directory, setDirectory] = useState<DirectoryState>({ status: "loading" });
  const [directoryAttempt, setDirectoryAttempt] = useState(0);
  const [selected, setSelected] = useState<RecordState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    setDirectory({ status: "loading" });
    async function loadDirectory(): Promise<void> {
      try {
        const page = await listRegyfitMemberRecords();
        if (!Array.isArray(page?.rows)) throw new Error("directory unavailable");
        if (!cancelled) setDirectory({ status: "loaded", page });
      } catch {
        if (!cancelled) setDirectory({ status: "error" });
      }
    }
    void loadDirectory();
    return () => {
      cancelled = true;
    };
  }, [directoryAttempt]);

  async function runLookup(
    kind: PublicAdminIdentifierLookupKind,
    rawIdentifier: string,
  ): Promise<void> {
    const value = rawIdentifier.trim();
    setDetail({ status: "idle" });
    if (value.length === 0) {
      setLookup({ status: "error" });
      return;
    }
    setLookup({ status: "loading" });
    try {
      const result = await lookupMemberIdentity(kind, value);
      setLookup(result.matched ? { status: "match", row: result.row } : { status: "no-match" });
    } catch {
      setLookup({ status: "error" });
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await runLookup(lookupKind, identifier);
  }

  function handleCanonicalLookup(membershipNumber: string): void {
    setLookupKind("membership-number");
    setIdentifier(membershipNumber);
    void runLookup("membership-number", membershipNumber);
  }

  async function openRecord(row: RegyfitMemberDirectoryRow): Promise<void> {
    setSelected({ status: "loading", recordId: row.recordId });
    if (row.memberNumber !== undefined) {
      setLookupKind("membership-number");
      setIdentifier(row.memberNumber);
    }
    try {
      const record = await getRegyfitMemberRecord(row.recordId);
      setSelected((current) =>
        current.status === "loading" && current.recordId === row.recordId
          ? { status: "loaded", record }
          : current,
      );
    } catch {
      setSelected((current) =>
        current.status === "loading" && current.recordId === row.recordId
          ? { status: "error", recordId: row.recordId }
          : current,
      );
    }
  }

  async function handleDetail(studentId: string): Promise<void> {
    setDetail({ status: "loading" });
    try {
      setDetail({ status: "loaded", detail: await getMemberDetail(studentId) });
    } catch {
      setDetail({ status: "error" });
    }
  }

  function handleUpdatedMember(nextDetail: MemberRecordMaintenanceDetail): void {
    setDetail({ status: "loaded", detail: nextDetail });
    setLookup((current) => {
      if (current.status !== "match" || current.row.studentId !== nextDetail.studentId) {
        return current;
      }
      const membershipReference = maskMembershipReference(nextDetail.membershipNumber);
      return {
        status: "match",
        row: Object.freeze({
          studentId: current.row.studentId,
          fullName: nextDetail.fullName,
          trainingCenter: nextDetail.trainingCenter,
          participantType: current.row.participantType,
          active: current.row.active,
          status: current.row.status,
          ...(membershipReference === undefined ? {} : { membershipReference }),
        }),
      };
    });
  }

  let selectedRecordId: string | undefined;
  if (selected.status === "loaded") selectedRecordId = selected.record.recordId;
  else if (selected.status !== "idle") selectedRecordId = selected.recordId;

  return (
    <>
      {selected.status === "loading" ? (
        <p className="admin-panel-card" role="status">
          Loading member record...
        </p>
      ) : null}
      {selected.status === "error" ? (
        <p className="admin-panel-card" aria-live="assertive" role="alert">
          Unable to load the member record. Please try again.
        </p>
      ) : null}
      {selected.status === "loaded" ? (
        <MemberProfilePanel
          record={selected.record}
          onCanonicalLookup={handleCanonicalLookup}
          onClose={() => setSelected({ status: "idle" })}
        />
      ) : null}
      <AcademyMemberDirectorySection
        directory={directory}
        onRetry={() => setDirectoryAttempt((attempt) => attempt + 1)}
        onSelectRecord={(row) => void openRecord(row)}
        selectedRecordId={selectedRecordId}
      />
      <section className="regyfit-access-panel" aria-labelledby="member-search-title">
        <header className="regyfit-access-heading">
          <p className="admin-eyebrow">Members / Exact lookup</p>
          <h2 id="member-search-title">Find a canonical student record.</h2>
          <p>Search by one exact approved identifier. Restricted fields load only on request.</p>
        </header>

        <form className="regyfit-access-controls" onSubmit={(event) => void handleSearch(event)}>
          <div className="login-field">
            <label htmlFor="member-lookup-kind">Identifier type</label>
            <select
              id="member-lookup-kind"
              onChange={(event) =>
                setLookupKind(event.target.value as PublicAdminIdentifierLookupKind)
              }
              value={lookupKind}
            >
              <option value="membership-number">Membership number</option>
              <option value="id-card-number">ID card number</option>
              <option value="vat-number">VAT number</option>
            </select>
          </div>
          <div className="login-field">
            <label htmlFor="member-exact-identifier">Exact identifier</label>
            <input
              autoComplete="off"
              id="member-exact-identifier"
              onChange={(event) => setIdentifier(event.target.value)}
              required
              type="text"
              value={identifier}
            />
          </div>
          <button
            className="admin-auth-button"
            disabled={lookup.status === "loading"}
            type="submit"
          >
            {lookup.status === "loading" ? "Searching..." : "Search exact identifier"}
          </button>
        </form>

        <section
          aria-busy={lookup.status === "loading"}
          aria-label="Member lookup result"
          className="regyfit-access-panel"
        >
          {lookup.status === "idle" ? <p>Search to see a student.</p> : null}
          {lookup.status === "loading" ? <p role="status">Searching...</p> : null}
          {lookup.status === "no-match" ? (
            <p aria-live="polite" role="status">
              No matching student was found.
            </p>
          ) : null}
          {lookup.status === "error" ? (
            <p aria-live="assertive" role="alert">
              Unable to find member. Please try again.
            </p>
          ) : null}
          {lookup.status === "match" ? (
            <>
              <dl>
                <dt>Membership reference</dt>
                <dd>{lookup.row.membershipReference}</dd>
                <dt>Name</dt>
                <dd>{lookup.row.fullName}</dd>
                <dt>Training center</dt>
                <dd>{lookup.row.trainingCenter}</dd>
                <dt>Participant type</dt>
                <dd>{lookup.row.participantType}</dd>
                <dt>State</dt>
                <dd>{lookup.row.active ? lookup.row.status : "inactive"}</dd>
              </dl>
              <button
                className="regyfit-filter-button"
                disabled={detail.status === "loading" || detail.status === "loaded"}
                onClick={() => void handleDetail(lookup.row.studentId)}
                type="button"
              >
                {detail.status === "loading"
                  ? "Loading restricted details..."
                  : "View restricted details"}
              </button>
              {detail.status === "error" ? (
                <p aria-live="assertive" role="alert">
                  Unable to load member details. Please try again.
                </p>
              ) : null}
              {detail.status === "loaded" ? (
                <RestrictedDetail detail={detail.detail} onUpdated={handleUpdatedMember} />
              ) : null}
            </>
          ) : null}
        </section>
      </section>
    </>
  );
}

export function SearchMembersPage() {
  return <SearchMembersContent />;
}

export default function SearchMembersRoute() {
  return <SearchMembersPage />;
}
