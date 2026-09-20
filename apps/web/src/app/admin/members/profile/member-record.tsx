"use client";

import { MemberReviewActions } from "../member-review";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  memberRecordTabs,
  type MemberProfile,
  type MemberProfileHeader,
  type MemberRecordTab,
} from "@bpt-jersey/domain/members/profile";

import {
  MemberRecordLoadError,
  getMemberProfile,
  isMemberRecordId,
} from "../../../../lib/member-profile-client";
import { useAdminOrStaffSession } from "../../admin-gate";
import { ClassesTab } from "./classes-tab";
import { DetailsTab } from "./details-tab";
import { IbjjfCard } from "./ibjjf-card";
import { ManageView, unsavedRatingsQuestion } from "./manage-view";
import { NotesTab } from "./notes-tab";
import { PaymentsTab } from "./payments-tab";
import { PlanTab } from "./plan-tab";
import { ProfileTab } from "./profile-tab";
import { RecordEmptyTab } from "./record-empty-tab";
import { participantTypeLabel, statusLabel } from "./record-format";

export type RecordLocation = Readonly<{
  studentId: string | null;
  tab: MemberRecordTab;
  manage: boolean;
}>;

const tabLabels: Readonly<Record<MemberRecordTab, string>> = {
  profile: "Profile",
  details: "Details",
  plan: "Plan",
  documents: "Documents",
  payments: "Payments",
  classes: "Classes",
  communication: "Communication",
  notes: "Notes",
};

const unsavedDetailsQuestion = "You have unsaved changes in Details. Leave without saving?";
const genericLoadError = "Unable to load this member record. Please try again.";

export function readRecordLocation(search: string): RecordLocation {
  const params = new URLSearchParams(search);
  const id = params.get("id");
  const tab = params.get("tab");
  return {
    studentId: isMemberRecordId(id) ? id : null,
    tab:
      tab !== null && (memberRecordTabs as readonly string[]).includes(tab)
        ? (tab as MemberRecordTab)
        : "profile",
    manage: params.get("view") === "manage",
  };
}

export function recordHref(
  studentId: string,
  tab: MemberRecordTab = "profile",
  manage = false,
): string {
  const params = new URLSearchParams({ id: studentId });
  if (tab !== "profile") params.set("tab", tab);
  if (manage) params.set("view", "manage");
  return `/admin/members/profile?${params.toString()}`;
}

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "invalid" }>
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "error" | "denied"; message: string }>
  | Readonly<{ status: "ready"; profile: MemberProfile }>;

function RecordHeader({
  header,
  headingRef,
}: {
  header: MemberProfileHeader;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const badge = header.birthdayBadge;
  return (
    <header className="member-record-header">
      <p className="admin-eyebrow">Members / Record</p>
      <h2 ref={headingRef} tabIndex={-1}>
        {header.fullName}
      </h2>
      <dl className="member-record-facts">
        {header.maskedMemberReference === undefined ? null : (
          <div>
            <dt>Member reference</dt>
            <dd>{header.maskedMemberReference}</dd>
          </div>
        )}
        <div>
          <dt>Age</dt>
          <dd>{header.age === null ? "Unknown" : `${header.age} years`}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>
            {header.reviewReason === "date-of-birth-missing"
              ? "Age unknown"
              : participantTypeLabel(header.participantType)}
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd className={`member-record-status member-record-status-${header.status}`}>
            {statusLabel(header.status)}
          </dd>
        </div>
      </dl>
      {badge === null ? null : (
        <p className="member-record-birthday">
          {badge.kind === "today"
            ? "Birthday today"
            : `Birthday in ${badge.days} ${badge.days === 1 ? "day" : "days"}`}
        </p>
      )}
    </header>
  );
}

export function MemberRecord() {
  const { role } = useAdminOrStaffSession();
  return <MemberRecordSession key={role} role={role} />;
}

function MemberRecordSession({
  role,
}: {
  role: ReturnType<typeof useAdminOrStaffSession>["role"];
}) {
  // The office searches from Members; the mat from Member search (operator 2026-09-19).
  const office = role === "owner" || role === "administrator";
  const [location, setLocation] = useState<RecordLocation | null>(null);
  const [recordLoad, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  /**
   * Task 17 review, Major-2: ONE fact, "the panel on screen holds unsaved work", owned here,
   * because this component owns four of the five ways out of a panel — the tab strip, the arrow
   * keys, the browser's own Back/Forward and the member-search link. It holds the question to
   * ask, so a panel names its own stake and `null` means there is nothing to lose. The Details
   * form and the IBJJF assessment both report into it; they cannot both be on screen at once.
   */
  const unsaved = useRef<string | null>(null);
  const focusOfficeNote = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const locationRef = useRef<RecordLocation | null>(null);
  const activeTabRef = useRef<MemberRecordTab>("profile");

  /**
   * A history move (Back / Forward) changes the tab without passing through `selectTab`, so the
   * unsaved-DETAILS question is asked here too. On cancel the previous entry is pushed back, which
   * keeps the address bar and the rendered tab saying the same thing.
   */
  useEffect(() => {
    function sync(): void {
      const next = readRecordLocation(window.location.search);
      const current = locationRef.current;
      // `beforeunload` does not fire for an in-app history move, so this is the only thing
      // standing between Back and an unsaved panel - whichever panel it is.
      if (current !== null && current.studentId !== null && unsaved.current !== null) {
        const leaving =
          next.studentId !== current.studentId ||
          next.tab !== activeTabRef.current ||
          next.manage !== current.manage;
        if (leaving && !window.confirm(unsaved.current)) {
          window.history.pushState(
            null,
            "",
            recordHref(current.studentId, activeTabRef.current, current.manage),
          );
          return;
        }
      }
      unsaved.current = null;
      setLocation(next);
    }
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const studentId = location === null ? undefined : location.studentId;
  // Effects run after commit: never render a loaded record for a different URL identity.
  const load: LoadState =
    recordLoad.status === "ready" && recordLoad.profile.header.studentId !== studentId
      ? { status: "loading" }
      : recordLoad;

  useEffect(() => {
    if (studentId === undefined) return undefined;
    if (studentId === null) {
      setLoad({
        status: new URLSearchParams(window.location.search).has("id") ? "invalid" : "missing",
      });
      return undefined;
    }
    let active = true;
    setLoad((current) =>
      current.status === "ready" && current.profile.header.studentId === studentId
        ? current
        : { status: "loading" },
    );
    getMemberProfile(studentId).then(
      (profile) => {
        if (active) setLoad({ status: "ready", profile });
      },
      (error: unknown) => {
        if (!active) return;
        if (error instanceof MemberRecordLoadError && error.kind === "missing") {
          setLoad({ status: "missing" });
          return;
        }
        setLoad({
          status: "error",
          message: error instanceof MemberRecordLoadError ? error.message : genericLoadError,
        });
      },
    );
    return () => {
      active = false;
    };
  }, [studentId, attempt, role]);

  const readyStudentId = load.status === "ready" ? load.profile.header.studentId : undefined;
  useEffect(() => {
    if (readyStudentId !== undefined) headingRef.current?.focus();
  }, [readyStudentId]);

  const onUnavailable = useCallback(
    (error: MemberRecordLoadError) => {
      setLoad((current) =>
        current.status === "ready" && current.profile.header.studentId === studentId
          ? error.kind === "missing"
            ? { status: "missing" }
            : { status: "denied", message: error.message }
          : current,
      );
    },
    [studentId],
  );

  const onCurrentMembership = useCallback(
    (
      currentMembership: import("@bpt-jersey/domain/members/profile").MemberProfileCards["currentMembership"],
    ) => {
      setLoad((current) =>
        current.status === "ready" && current.profile.view === "full"
          ? {
              ...current,
              profile: {
                ...current.profile,
                cards: { ...current.profile.cards, currentMembership },
              },
            }
          : current,
      );
    },
    [],
  );

  const onDirtyChange = useCallback((dirty: boolean) => {
    unsaved.current = dirty ? unsavedDetailsQuestion : null;
  }, []);

  const onRatingsDirtyChange = useCallback((dirty: boolean) => {
    unsaved.current = dirty ? unsavedRatingsQuestion : null;
  }, []);

  /** Every exit this component owns asks the same question, of whichever panel is on screen. */
  function mayLeave(): boolean {
    return unsaved.current === null || window.confirm(unsaved.current);
  }

  const visibleTabs: readonly MemberRecordTab[] =
    load.status === "ready" && load.profile.view === "full" ? memberRecordTabs : ["profile"];
  const activeTab: MemberRecordTab =
    location !== null && visibleTabs.includes(location.tab) ? location.tab : "profile";
  useEffect(() => {
    if (activeTab === "details" && focusOfficeNote.current) {
      document.getElementById("member-details-internalNotes")?.focus();
      focusOfficeNote.current = false;
    }
  }, [activeTab]);
  // The `popstate` listener is registered once, so it reads the current location through refs.
  useEffect(() => {
    locationRef.current = location;
    activeTabRef.current = activeTab;
  });

  /**
   * An unknown `?tab=`, or a tab this viewer cannot open, falls back to PROFILE. Rewrite the query
   * so the URL names the tab actually on screen - otherwise the link stays wrong for ever, because
   * clicking the tab it already renders does nothing.
   */
  useEffect(() => {
    if (load.status !== "ready" || location === null || location.studentId === null) return;
    // Navigation can happen after this render commits but before its passive effects run.
    // Only repair the location this effect belongs to; otherwise an old record can rewrite
    // the new URL and make the next student's data commit under the previous student's ID.
    const current = readRecordLocation(window.location.search);
    if (
      current.studentId !== location.studentId ||
      current.tab !== location.tab ||
      current.manage !== location.manage
    )
      return;
    const href = recordHref(location.studentId, activeTab, location.manage);
    if (window.location.search === href.slice(href.indexOf("?"))) return;
    window.history.replaceState(null, "", href);
    if (location.tab !== activeTab) setLocation({ ...location, tab: activeTab });
  }, [activeTab, load.status, location]);

  function selectTab(tab: MemberRecordTab): boolean {
    if (location === null || location.studentId === null || tab === activeTab) return false;
    // A tab click also leaves the Manage MODE of the PROFILE panel, which is where the unsaved
    // ratings live, so this question is not about Details alone.
    if (!mayLeave()) return false;
    unsaved.current = null;
    window.history.pushState(null, "", recordHref(location.studentId, tab));
    setLocation({ ...location, tab, manage: false });
    return true;
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const index = visibleTabs.indexOf(activeTab);
    const last = visibleTabs.length - 1;
    const nextIndex =
      event.key === "ArrowRight"
        ? (index + 1) % visibleTabs.length
        : event.key === "ArrowLeft"
          ? (index + last) % visibleTabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : undefined;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = visibleTabs[nextIndex];
    if (next !== undefined && selectTab(next)) {
      document.getElementById(`member-record-tab-${next}`)?.focus();
    }
  }

  const ibjjfCardSlot: ReactNode =
    readyStudentId === undefined ? undefined : (
      <IbjjfCard
        canOpenLevel={role === "owner" || role === "administrator" || role === "headCoach"}
        manageHref={recordHref(readyStudentId, "profile", true)}
        studentId={readyStudentId}
      />
    );

  function panel(profile: MemberProfile): ReactNode {
    if (activeTab === "profile") {
      // Manage is a MODE of the PROFILE panel, not a tab: `selectTab` drops `view=manage` on every
      // tab change and every arrow key, so leaving the panel leaves the mode (Task 16 decision).
      return location?.manage === true ? (
        <ManageView
          age={profile.header.age}
          fullName={profile.header.fullName}
          onRatingsDirtyChange={onRatingsDirtyChange}
          recordHref={recordHref(profile.header.studentId)}
          role={role}
          studentId={profile.header.studentId}
        />
      ) : (
        <ProfileTab profile={profile} ibjjfCardSlot={ibjjfCardSlot} />
      );
    }
    if (activeTab === "plan" && profile.view === "full")
      return (
        <PlanTab
          key={profile.header.studentId}
          studentId={profile.header.studentId}
          onCurrentMembership={onCurrentMembership}
          onUnavailable={onUnavailable}
        />
      );
    if (activeTab === "payments" && profile.view === "full")
      return (
        <PaymentsTab
          key={profile.header.studentId}
          studentId={profile.header.studentId}
          onUnavailable={onUnavailable}
        />
      );
    if (activeTab === "classes" && profile.view === "full")
      return (
        <ClassesTab
          key={profile.header.studentId}
          studentId={profile.header.studentId}
          onUnavailable={onUnavailable}
        />
      );
    if (activeTab === "notes" && profile.view === "full")
      return (
        <NotesTab
          note={profile.details.details?.internalNotes}
          onEdit={() => {
            if (selectTab("details")) focusOfficeNote.current = true;
          }}
        />
      );
    if (activeTab === "details") {
      return profile.view === "full" ? (
        <DetailsTab
          onDirtyChange={onDirtyChange}
          onSaved={() => setAttempt((current) => current + 1)}
          profile={profile}
        />
      ) : null;
    }
    return (
      <RecordEmptyTab
        canOpenDetails={profile.view === "full"}
        onOpenDetails={() => {
          if (selectTab("details")) document.getElementById("member-record-tab-details")?.focus();
        }}
        studentId={profile.header.studentId}
        tab={activeTab}
      />
    );
  }

  return (
    <section aria-label="Member record" className="admin-module-page member-record">
      <div>
        <Link
          className="member-record-link"
          href={office ? "/admin/members" : "/admin/members/search"}
          onClick={(event) => {
            // A route change tears every panel down; nothing else on the way out asks.
            if (!mayLeave()) event.preventDefault();
          }}
        >
          {office ? "Back to members" : "Back to member search"}
        </Link>
      </div>

      {load.status === "loading" ? (
        <div
          aria-busy="true"
          aria-label="Loading member record"
          className="member-record-skeleton"
          role="status"
        >
          <span />
          <span />
          <span />
        </div>
      ) : null}

      {load.status === "invalid" ? (
        <div className="member-record-notice" role="alert">
          <p className="admin-eyebrow">Members / Record</p>
          <p>This member record link is not valid.</p>
        </div>
      ) : null}

      {load.status === "missing" ? (
        <div className="member-record-notice">
          <p role="status">Live member record unavailable. It may not have been created yet.</p>
          {office ? (
            <>
              <Link href="/admin/members/migration">Review member migration</Link>
              {" · "}
              <Link href="/admin/members/search">Imported archive</Link>
            </>
          ) : null}
        </div>
      ) : null}

      {load.status === "error" || load.status === "denied" ? (
        <div className="member-record-notice">
          <p className="admin-eyebrow">Members / Record</p>
          <p role="alert">{load.message}</p>
          {load.status === "error" ? (
            <button
              className="member-record-button"
              onClick={() => setAttempt((current) => current + 1)}
              type="button"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      {load.status === "ready" ? (
        <>
          <RecordHeader header={load.profile.header} headingRef={headingRef} />
          {office ? (
            <MemberReviewActions
              {...load.profile.header}
              onSaved={() => setAttempt((current) => current + 1)}
            />
          ) : null}
          <div
            aria-label="Member record sections"
            className="admin-member-profile-tabs member-record-tabs"
            onKeyDown={onTabKeyDown}
            role="tablist"
          >
            {visibleTabs.map((tab) => (
              <button
                aria-controls="member-record-panel"
                aria-selected={tab === activeTab}
                className={`admin-member-profile-tab${tab === activeTab ? " is-active" : ""}`}
                id={`member-record-tab-${tab}`}
                key={tab}
                onClick={() => selectTab(tab)}
                role="tab"
                tabIndex={tab === activeTab ? 0 : -1}
                type="button"
              >
                {tabLabels[tab]}
              </button>
            ))}
          </div>
          <div
            aria-labelledby={`member-record-tab-${activeTab}`}
            className="admin-member-profile-panel"
            id="member-record-panel"
            role="tabpanel"
            tabIndex={0}
          >
            {panel(load.profile)}
          </div>
        </>
      ) : null}
    </section>
  );
}
