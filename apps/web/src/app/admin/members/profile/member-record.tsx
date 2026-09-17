"use client";

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
import { DetailsTab } from "./details-tab";
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
  | Readonly<{ status: "error"; message: string }>
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
          <dd>{participantTypeLabel(header.participantType)}</dd>
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
  const [location, setLocation] = useState<RecordLocation | null>(null);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const detailsDirty = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    function sync(): void {
      setLocation(readRecordLocation(window.location.search));
    }
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const studentId = location === null ? undefined : location.studentId;

  useEffect(() => {
    if (studentId === undefined) return undefined;
    if (studentId === null) {
      setLoad({ status: "invalid" });
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
        setLoad({
          status: "error",
          message: error instanceof MemberRecordLoadError ? error.message : genericLoadError,
        });
      },
    );
    return () => {
      active = false;
    };
  }, [studentId, attempt]);

  const readyStudentId = load.status === "ready" ? load.profile.header.studentId : undefined;
  useEffect(() => {
    if (readyStudentId !== undefined) headingRef.current?.focus();
  }, [readyStudentId]);

  const onDirtyChange = useCallback((dirty: boolean) => {
    detailsDirty.current = dirty;
  }, []);

  const visibleTabs: readonly MemberRecordTab[] =
    load.status === "ready" && load.profile.view === "full" ? memberRecordTabs : ["profile"];
  const activeTab: MemberRecordTab =
    location !== null && visibleTabs.includes(location.tab) ? location.tab : "profile";

  function selectTab(tab: MemberRecordTab): boolean {
    if (location === null || location.studentId === null || tab === activeTab) return false;
    if (
      activeTab === "details" &&
      detailsDirty.current &&
      !window.confirm(unsavedDetailsQuestion)
    ) {
      return false;
    }
    detailsDirty.current = false;
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

  // Plan C (E2) insertion points: `ibjjfCardSlot` becomes <IbjjfCard studentId={…} />, and the
  // `location.manage` branch below renders <ManageView … /> in place of the PROFILE cards.
  const ibjjfCardSlot: ReactNode = undefined;

  function panel(profile: MemberProfile): ReactNode {
    if (activeTab === "profile") {
      return <ProfileTab profile={profile} ibjjfCardSlot={ibjjfCardSlot} />;
    }
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
        <Link className="member-record-link" href="/admin/members/search">
          Back to member search
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

      {load.status === "error" ? (
        <div className="member-record-notice">
          <p className="admin-eyebrow">Members / Record</p>
          <p role="alert">{load.message}</p>
          <button
            className="member-record-button"
            onClick={() => setAttempt((current) => current + 1)}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : null}

      {load.status === "ready" ? (
        <>
          <RecordHeader header={load.profile.header} headingRef={headingRef} />
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
