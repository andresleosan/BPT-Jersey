"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import type { RegyfitAccessRecord } from "@bpt-jersey/domain";
import type { AdminRole } from "@bpt-jersey/domain";
import type { ReactElement } from "react";

import { useAdminGateSession } from "../admin-gate";
import {
  isAdminE2EEnabled,
  readInjectedRegyfitRecordsForRole,
} from "../../../lib/admin-test-bootstrap";
import {
  loadRegyfitAccessRecords,
  type RegyfitAccessProjection,
} from "../../../lib/regyfit-access-client";

type SafeRegyfitAccessRecord = Omit<RegyfitAccessRecord, "ip">;

export type SafeRegyfitAccessProjection = RegyfitAccessRecord | SafeRegyfitAccessRecord;

export type RegyfitAccessRecordsPageProps =
  | { records: readonly RegyfitAccessRecord[]; role: Extract<AdminRole, "owner"> }
  | {
      records: readonly SafeRegyfitAccessRecord[];
      role: Extract<AdminRole, "administrator">;
    };

type AccessRecordsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; records: readonly RegyfitAccessProjection[] };

type RecordFilter = "all" | "active" | "inactive";

const filterOptions: readonly RecordFilter[] = ["all", "active", "inactive"];

function recordKey(record: SafeRegyfitAccessProjection, index: number): string {
  return `${record.sourceId}-${index}`;
}

function matchesSearch(record: SafeRegyfitAccessProjection, search: string): boolean {
  const query = search.trim().toLocaleLowerCase();
  if (query.length === 0) {
    return true;
  }

  return [record.memberDisplayName, record.memberNumber, record.sourceId].some((field) =>
    (field ?? "").toLocaleLowerCase().includes(query),
  );
}

function matchesFilter(record: SafeRegyfitAccessProjection, filter: RecordFilter): boolean {
  if (filter === "all") {
    return true;
  }

  const isActive = record.loginCount > 0;
  return filter === "active" ? isActive : !isActive;
}

function getNoResultsMessage(search: string, filter: RecordFilter): string {
  const hasSearch = search.trim().length > 0;
  const hasFilter = filter !== "all";

  if (hasSearch && hasFilter) {
    return "No access records match your search and the selected filter.";
  }
  if (hasSearch) {
    return "No access records match your search.";
  }
  if (hasFilter) {
    return "No access records match the selected filter.";
  }
  return "No access records are available.";
}

function formatObservedDate(date: string | null): string {
  return date === null ? "Not observed" : date;
}

function formatObservedText(value: string | null): string {
  return value === null ? "Not observed" : value;
}

export function RegyfitAccessRecordsPage({
  records,
  role,
}: RegyfitAccessRecordsPageProps): ReactElement {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RecordFilter>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const detailsRef = useRef<HTMLElement | null>(null);

  const visibleRecords = records
    .map((record, index) => ({ key: recordKey(record, index), record }))
    .filter(({ record }) => matchesSearch(record, search) && matchesFilter(record, filter));
  const selectedRecord = visibleRecords.find(({ key }) => key === selectedKey)?.record;

  useEffect(() => {
    if (selectedKey !== null) {
      detailsRef.current?.focus();
    }
  }, [selectedKey]);

  return (
    <section
      className="regyfit-access-panel"
      data-role={role}
      data-testid="regyfit-access-records-panel"
      id="regyfit-access-records"
      aria-labelledby="regyfit-access-records-title"
    >
      <header className="regyfit-access-heading">
        <p className="admin-eyebrow">Read-only source view</p>
        <h2 id="regyfit-access-records-title">Regyfit access records.</h2>
        <p>
          Review observed access data without changing the source record or inferring a business
          status.
        </p>
      </header>

      <div className="regyfit-access-controls">
        <label className="regyfit-search-label" htmlFor="regyfit-access-search">
          Search access records
        </label>
        <input
          className="regyfit-search-input"
          id="regyfit-access-search"
          name="regyfit-access-search"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Member, number or source ID"
          type="search"
          value={search}
        />

        <fieldset className="regyfit-filter-group">
          <legend>Filter records</legend>
          <div className="regyfit-filter-buttons">
            {filterOptions.map((option) => (
              <button
                aria-pressed={filter === option}
                className="regyfit-filter-button"
                key={option}
                onClick={() => setFilter(option)}
                type="button"
              >
                {option.charAt(0).toUpperCase() + option.slice(1)}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {visibleRecords.length === 0 ? (
        <p className="regyfit-no-results" role="status" aria-live="polite">
          {getNoResultsMessage(search, filter)}
        </p>
      ) : (
        <div className="regyfit-table-wrap">
          <table className="regyfit-access-table" aria-label="Regyfit access records">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Member number</th>
                <th scope="col">Source ID</th>
                <th scope="col">Observed login count</th>
                <th scope="col">Last observed login</th>
                <th scope="col">
                  <span className="visually-hidden">Record actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map(({ key, record }) => {
                const activityLabel = record.loginCount > 0 ? "Active" : "Inactive";

                return (
                  <tr data-responsive-card="true" data-testid="regyfit-access-record-row" key={key}>
                    <td data-label="Member">
                      <strong>{record.memberDisplayName}</strong>
                      <span className="regyfit-record-activity">
                        {activityLabel} by observed logins
                      </span>
                    </td>
                    <td data-label="Member number">{formatObservedText(record.memberNumber)}</td>
                    <td data-label="Source ID">{record.sourceId}</td>
                    <td data-label="Observed login count">{record.loginCount}</td>
                    <td data-label="Last observed login">
                      {formatObservedDate(record.lastLoginAt)}
                    </td>
                    <td data-label="Record actions">
                      <button
                        aria-controls="regyfit-record-details"
                        aria-expanded={selectedKey === key}
                        className="regyfit-detail-button"
                        onClick={() => setSelectedKey(key)}
                        type="button"
                      >
                        View details for {record.memberDisplayName}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedRecord === undefined ? null : (
        <aside
          aria-labelledby="regyfit-record-details-title"
          aria-describedby="regyfit-record-details-description"
          className="regyfit-record-details"
          id="regyfit-record-details"
          ref={detailsRef}
          role="region"
          tabIndex={-1}
        >
          <div className="regyfit-details-heading">
            <p className="admin-card-label">Selected record</p>
            <h3 id="regyfit-record-details-title">Record details</h3>
            <p className="visually-hidden" id="regyfit-record-details-description">
              Selected access record details.
            </p>
          </div>
          <dl className="regyfit-details-list">
            <div>
              <dt>Member</dt>
              <dd>{selectedRecord.memberDisplayName}</dd>
            </div>
            <div>
              <dt>Member number</dt>
              <dd>{formatObservedText(selectedRecord.memberNumber)}</dd>
            </div>
            <div>
              <dt>Source ID</dt>
              <dd>{selectedRecord.sourceId}</dd>
            </div>
            <div>
              <dt>Observed login count</dt>
              <dd>{selectedRecord.loginCount}</dd>
            </div>
            <div>
              <dt>Last observed login</dt>
              <dd>{formatObservedDate(selectedRecord.lastLoginAt)}</dd>
            </div>
            <div>
              <dt>Academy ID</dt>
              <dd>{selectedRecord.academyId}</dd>
            </div>
            <div>
              <dt>Source system</dt>
              <dd>{selectedRecord.sourceSystem}</dd>
            </div>
            <div>
              <dt>Import run ID</dt>
              <dd>{selectedRecord.importRunId}</dd>
            </div>
            <div>
              <dt>Captured at</dt>
              <dd>{selectedRecord.capturedAt}</dd>
            </div>
            <div>
              <dt>Schema version</dt>
              <dd>{selectedRecord.schemaVersion}</dd>
            </div>
            {role === "owner" && "ip" in selectedRecord ? (
              <div className="regyfit-restricted-field">
                <dt>IP</dt>
                <dd>
                  <span className="regyfit-restricted-label">Restricted IP</span>
                  {selectedRecord.ip}
                </dd>
              </div>
            ) : null}
          </dl>
        </aside>
      )}
    </section>
  );
}

export function AdminAccessRecordsContent(): ReactElement {
  const session = useAdminGateSession();
  const syntheticMode = isAdminE2EEnabled();
  const [state, setState] = useState<AccessRecordsState>(() =>
    syntheticMode
      ? {
          status: "ready",
          records:
            session.role === "owner"
              ? readInjectedRegyfitRecordsForRole("owner")
              : readInjectedRegyfitRecordsForRole("administrator"),
        }
      : { status: "loading" },
  );

  useEffect(() => {
    if (syntheticMode) {
      return;
    }

    let active = true;
    void loadRegyfitAccessRecords()
      .then((records) => {
        if (active) {
          startTransition(() => setState({ status: "ready", records }));
        }
      })
      .catch(() => {
        if (active) {
          startTransition(() => setState({ status: "error" }));
        }
      });

    return () => {
      active = false;
    };
  }, [session.role, syntheticMode]);

  if (state.status === "loading") {
    return <p role="status">Loading Regyfit access records...</p>;
  }

  if (state.status === "error") {
    return <p role="alert">Unable to load Regyfit access records.</p>;
  }

  if (session.role === "owner") {
    return (
      <RegyfitAccessRecordsPage
        records={state.records as readonly RegyfitAccessRecord[]}
        role="owner"
      />
    );
  }

  return (
    <RegyfitAccessRecordsPage
      records={state.records.map((record) => {
        if ("ip" in record) {
          const { ip, ...safeRecord } = record;
          void ip;
          return safeRecord;
        }
        return record;
      })}
      role="administrator"
    />
  );
}

export default function RegyfitAccessRecordsRoute(): ReactElement {
  if (process.env.NODE_ENV === "test") {
    return <RegyfitAccessRecordsPage records={[]} role="administrator" />;
  }

  return <AdminAccessRecordsContent />;
}
