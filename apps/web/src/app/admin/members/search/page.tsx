"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  memberGenders,
  memberOrderByValues,
  memberReportKeys,
  membershipStatuses,
  paymentStatuses,
  type MemberGender,
  type MemberOrderBy,
  type MemberReportKey,
  type MemberSearchFilters,
} from "@bpt-jersey/domain";

import {
  getMemberReportPdf,
  getMemberReportSummary,
  searchMembers,
  type MemberSearchProjection,
  type MemberSearchResult,
} from "../../../../lib/members-client";

import "../../admin.css";

type SearchFormValues = Readonly<{
  membershipNumber: string;
  name: string;
  email: string;
  idCardNumber: string;
  vatNumber: string;
  mobileNumber: string;
  frequency: string;
  paymentOrStatus: "" | NonNullable<MemberSearchFilters["paymentOrStatus"]>;
  gender: "" | MemberGender;
  trainingCenter: string;
  orderBy: "" | MemberOrderBy;
}>;

const initialFormValues: SearchFormValues = {
  membershipNumber: "",
  name: "",
  email: "",
  idCardNumber: "",
  vatNumber: "",
  mobileNumber: "",
  frequency: "",
  paymentOrStatus: "",
  gender: "",
  trainingCenter: "",
  orderBy: "",
};

const reportLabels: Readonly<Record<MemberReportKey, string>> = {
  total: "Total members",
  active: "Active members",
  withNumber: "Members with number",
  noNumber: "Members without number",
  inactive: "Inactive members",
  regularized: "Regularized members",
  activeRegularized: "Active regularized members",
  suspended: "Suspended members",
};

const textFields = [
  "membershipNumber",
  "name",
  "email",
  "idCardNumber",
  "vatNumber",
  "mobileNumber",
  "frequency",
  "trainingCenter",
] as const;

function optionalText(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function filtersFromForm(values: SearchFormValues): MemberSearchFilters {
  const filters: { -readonly [K in keyof MemberSearchFilters]?: MemberSearchFilters[K] } = {};
  for (const field of textFields) {
    const value = optionalText(values[field]);
    if (value !== undefined) filters[field] = value;
  }
  if (values.paymentOrStatus !== "") filters.paymentOrStatus = values.paymentOrStatus;
  if (values.gender !== "") filters.gender = values.gender;
  if (values.orderBy !== "") filters.orderBy = values.orderBy;
  return filters;
}

function updateFormField<K extends keyof SearchFormValues>(
  values: SearchFormValues,
  field: K,
  value: SearchFormValues[K],
): SearchFormValues {
  return { ...values, [field]: value };
}

function formatMemberValue(value: string | undefined): string {
  return value ?? "Not provided";
}

function formatDate(value: string | undefined): string {
  if (value === undefined) return "Not provided";
  return value.slice(0, 10);
}

function MemberTable({ members }: { members: readonly MemberSearchProjection[] }) {
  return (
    <div className="regyfit-table-wrap">
      <table className="regyfit-access-table">
        <caption className="visually-hidden">Member search results</caption>
        <thead>
          <tr>
            <th scope="col">Membership number</th>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">ID card number</th>
            <th scope="col">VAT number</th>
            <th scope="col">Birth date</th>
            <th scope="col">Mobile number</th>
            <th scope="col">Frequency</th>
            <th scope="col">Payment / status</th>
            <th scope="col">Gender</th>
            <th scope="col">Training center</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <MemberRow key={member.memberId} member={member} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberRow({ member }: { member: MemberSearchProjection }) {
  return (
    <tr>
      <td data-label="Membership number">{formatMemberValue(member.membershipNumber)}</td>
      <td data-label="Name">
        <strong>{member.fullName}</strong>
      </td>
      <td data-label="Email">{formatMemberValue(member.email)}</td>
      <td data-label="ID card number">{formatMemberValue(member.idCardNumber)}</td>
      <td data-label="VAT number">{formatMemberValue(member.vatNumber)}</td>
      <td data-label="Birth date">{formatDate(member.birthDate)}</td>
      <td data-label="Mobile number">{formatMemberValue(member.mobileNumber)}</td>
      <td data-label="Frequency">{formatMemberValue(member.frequency)}</td>
      <td data-label="Payment / status">
        {member.paymentStatus} / {member.membershipStatus}
      </td>
      <td data-label="Gender">{member.gender}</td>
      <td data-label="Training center">{formatMemberValue(member.trainingCenter)}</td>
    </tr>
  );
}

function FilterField({
  field,
  label,
  onChange,
  type = "text",
  value,
}: {
  field: keyof Pick<SearchFormValues, (typeof textFields)[number]>;
  label: string;
  onChange: (field: keyof SearchFormValues, value: string) => void;
  type?: "email" | "tel" | "text";
  value: string;
}) {
  const inputId = `member-search-${field}`;
  return (
    <div className="login-field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        name={field}
        onChange={(event) => onChange(field, event.target.value)}
        type={type}
        value={value}
      />
    </div>
  );
}

function ReportCounters({
  counts,
  busyReport,
  onDownload,
}: {
  counts: Partial<Record<MemberReportKey, number>>;
  busyReport: MemberReportKey | undefined;
  onDownload: (report: MemberReportKey) => void;
}) {
  return (
    <section className="admin-module-grid" aria-labelledby="member-reports-title">
      <h3 className="visually-hidden" id="member-reports-title">
        Member reports
      </h3>
      {memberReportKeys.map((report) => (
        <article className="admin-module-card" key={report}>
          <div className="admin-module-card-header">
            <p className="admin-card-index" aria-hidden="true">
              {String(counts[report] ?? "-")}
            </p>
            <p className="admin-card-label">Report</p>
          </div>
          <h4>{reportLabels[report]}</h4>
          <button
            className="regyfit-filter-button"
            disabled={busyReport !== undefined}
            onClick={() => onDownload(report)}
            type="button"
          >
            {busyReport === report
              ? "Preparing report..."
              : `Download ${reportLabels[report].toLowerCase()} report`}
          </button>
        </article>
      ))}
    </section>
  );
}

function SearchMembersContent() {
  const [values, setValues] = useState<SearchFormValues>(initialFormValues);
  const [submittedFilters, setSubmittedFilters] = useState<MemberSearchFilters>({});
  const [result, setResult] = useState<MemberSearchResult | undefined>();
  const [pageToken, setPageToken] = useState<string | undefined>();
  const [pageHistory, setPageHistory] = useState<readonly (string | undefined)[]>([]);
  const [counts, setCounts] = useState<Partial<Record<MemberReportKey, number>>>({});
  const [error, setError] = useState("");
  const [counterError, setCounterError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyReport, setBusyReport] = useState<MemberReportKey>();
  const [, startTransition] = useTransition();

  async function loadResults(filters: MemberSearchFilters, token?: string): Promise<void> {
    setError("");
    setCounterError("");
    setCounts({});
    setLoading(true);
    try {
      const searchPromise =
        token === undefined ? searchMembers(filters) : searchMembers(filters, token);
      const [searchOutcome, summaryOutcome] = await Promise.all([
        Promise.allSettled([searchPromise]),
        Promise.allSettled(memberReportKeys.map((report) => getMemberReportSummary(report))),
      ]);
      const searchResult = searchOutcome[0];
      const summaries = summaryOutcome
        .filter(
          (
            outcome,
          ): outcome is PromiseFulfilledResult<{ report: MemberReportKey; count: number }> =>
            outcome.status === "fulfilled",
        )
        .map((outcome) => outcome.value);
      if (searchResult?.status === "rejected" || searchResult === undefined) {
        throw searchResult?.reason ?? new Error("Search failed");
      }
      startTransition(() => {
        setResult(searchResult.value);
        if (summaryOutcome.some((outcome) => outcome.status === "rejected")) {
          setCounterError("Unable to load report counters. Please try again.");
        } else {
          setCounts(
            Object.fromEntries(summaries.map((summary) => [summary.report, summary.count])),
          );
        }
      });
    } catch {
      setError("Unable to load members. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleFieldChange(field: keyof SearchFormValues, value: string): void {
    setValues((current) => updateFormField(current, field, value));
  }

  function handleSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const filters = filtersFromForm(values);
    setSubmittedFilters(filters);
    setPageToken(undefined);
    setPageHistory([]);
    void loadResults(filters);
  }

  function handleNextPage(): void {
    if (!result?.nextPageToken || loading) return;
    setPageHistory((history) => [...history, pageToken]);
    setPageToken(result.nextPageToken);
    void loadResults(submittedFilters, result.nextPageToken);
  }

  function handlePreviousPage(): void {
    if (pageHistory.length === 0 || loading) return;
    const previousToken = pageHistory[pageHistory.length - 1];
    setPageHistory((history) => history.slice(0, -1));
    setPageToken(previousToken);
    void loadResults(submittedFilters, previousToken);
  }

  async function handleDownload(report: MemberReportKey): Promise<void> {
    setError("");
    setBusyReport(report);
    const reportWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!reportWindow) {
      setError("Unable to download member report. Please try again.");
      setBusyReport(undefined);
      return;
    }
    try {
      const { downloadUrl } = await getMemberReportPdf(report);
      reportWindow.location.replace(downloadUrl);
    } catch {
      reportWindow.close();
      setError("Unable to download member report. Please try again.");
    } finally {
      setBusyReport(undefined);
    }
  }

  return (
    <section className="regyfit-access-panel" aria-labelledby="member-search-title">
      <header className="regyfit-access-heading">
        <p className="admin-eyebrow">Members / Search and reports</p>
        <h2 id="member-search-title">Find the right member record.</h2>
        <p>Use the approved member fields to search the academy directory or prepare a report.</p>
      </header>

      <form className="regyfit-access-controls" onSubmit={handleSearch}>
        <FilterField
          field="membershipNumber"
          label="Membership number"
          onChange={handleFieldChange}
          value={values.membershipNumber}
        />
        <FilterField field="name" label="Name" onChange={handleFieldChange} value={values.name} />
        <FilterField
          field="email"
          label="Email"
          onChange={handleFieldChange}
          type="email"
          value={values.email}
        />
        <FilterField
          field="idCardNumber"
          label="ID card number"
          onChange={handleFieldChange}
          value={values.idCardNumber}
        />
        <FilterField
          field="vatNumber"
          label="VAT number"
          onChange={handleFieldChange}
          value={values.vatNumber}
        />
        <FilterField
          field="mobileNumber"
          label="Mobile number"
          onChange={handleFieldChange}
          type="tel"
          value={values.mobileNumber}
        />
        <FilterField
          field="frequency"
          label="Frequency"
          onChange={handleFieldChange}
          value={values.frequency}
        />
        <div className="login-field">
          <label htmlFor="member-search-payment-or-status">Payment or status</label>
          <select
            id="member-search-payment-or-status"
            onChange={(event) => handleFieldChange("paymentOrStatus", event.target.value)}
            value={values.paymentOrStatus}
          >
            <option value="">Any payment or status</option>
            {[...paymentStatuses, ...membershipStatuses].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="login-field">
          <label htmlFor="member-search-gender">Gender</label>
          <select
            id="member-search-gender"
            onChange={(event) => handleFieldChange("gender", event.target.value)}
            value={values.gender}
          >
            <option value="">Any gender</option>
            {memberGenders.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <FilterField
          field="trainingCenter"
          label="Training center"
          onChange={handleFieldChange}
          value={values.trainingCenter}
        />
        <div className="login-field">
          <label htmlFor="member-search-order-by">Order by</label>
          <select
            id="member-search-order-by"
            onChange={(event) => handleFieldChange("orderBy", event.target.value)}
            value={values.orderBy}
          >
            <option value="">Name</option>
            {memberOrderByValues.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <button className="admin-auth-button" disabled={loading} type="submit">
          {loading ? "SEARCHING..." : "SEARCH"}
        </button>
      </form>

      <ReportCounters
        counts={counts}
        busyReport={busyReport}
        onDownload={(report) => void handleDownload(report)}
      />
      {counterError ? (
        <p aria-live="assertive" className="regyfit-no-results" role="alert">
          {counterError}
        </p>
      ) : null}

      <section aria-busy={loading} aria-label="Search results" className="regyfit-access-panel">
        <h3 className="visually-hidden">Search results</h3>
        {error ? (
          <p aria-live="assertive" className="regyfit-no-results" role="alert">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p aria-live="polite" className="regyfit-no-results" role="status">
            Loading members...
          </p>
        ) : result?.members.length ? (
          <MemberTable members={result.members} />
        ) : result ? (
          <p aria-live="polite" className="regyfit-no-results" role="status">
            No members match these filters.
          </p>
        ) : (
          <p aria-live="polite" className="regyfit-no-results" role="status">
            Search to see members.
          </p>
        )}
        {result ? (
          <div className="regyfit-filter-buttons" aria-label="Member result pagination">
            <button
              className="regyfit-filter-button"
              disabled={pageHistory.length === 0 || loading}
              onClick={handlePreviousPage}
              type="button"
            >
              Previous page
            </button>
            <button
              className="regyfit-filter-button"
              disabled={!result.nextPageToken || loading}
              onClick={handleNextPage}
              type="button"
            >
              Next page
            </button>
          </div>
        ) : null}
      </section>
    </section>
  );
}

export function SearchMembersPage() {
  return <SearchMembersContent />;
}

export default function SearchMembersRoute() {
  if (process.env.NODE_ENV === "test") return <SearchMembersPage />;
  return <SearchMembersPage />;
}
