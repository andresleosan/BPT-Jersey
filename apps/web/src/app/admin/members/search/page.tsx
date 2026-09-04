"use client";

import { useState, type FormEvent } from "react";
import type {
  AdminDirectoryRow,
  MemberRecordMaintenanceDetail,
  PublicAdminIdentifierLookupKind,
} from "@bpt-jersey/domain/members/directory";
import { maskMembershipReference } from "@bpt-jersey/domain/members/directory";

import {
  getMemberDetail,
  lookupMemberIdentity,
  updateMember,
  type UpdateMemberInput,
} from "../../../../lib/members-client";

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

function SearchMembersContent() {
  const [lookupKind, setLookupKind] =
    useState<PublicAdminIdentifierLookupKind>("membership-number");
  const [identifier, setIdentifier] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });

  async function handleSearch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const value = identifier.trim();
    setDetail({ status: "idle" });
    if (value.length === 0) {
      setLookup({ status: "error" });
      return;
    }
    setLookup({ status: "loading" });
    try {
      const result = await lookupMemberIdentity(lookupKind, value);
      setLookup(result.matched ? { status: "match", row: result.row } : { status: "no-match" });
    } catch {
      setLookup({ status: "error" });
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

  return (
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
        <button className="admin-auth-button" disabled={lookup.status === "loading"} type="submit">
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
  );
}

export function SearchMembersPage() {
  return <SearchMembersContent />;
}

export default function SearchMembersRoute() {
  return <SearchMembersPage />;
}
