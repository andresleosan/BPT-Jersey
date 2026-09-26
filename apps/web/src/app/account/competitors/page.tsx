"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { AccountMemberProfile } from "@bpt-jersey/domain/members/access";
import type { MemberPublicCard } from "@bpt-jersey/domain/members/engagement";

import { ClientAuthGate, ClientAuthProvider } from "../../../lib/client-auth";
import {
  competitorsUnavailable,
  getCompetitors,
  type CompetitorsResponse,
} from "../../../lib/competitors-client";
import { listMyProfiles } from "../../../lib/family-plan-client";
import { BeltLabel, MemberAvatar, MemberCardDialog } from "./member-card-dialog";

import "../account.css";
import "./competitors.css";

type Neighbours = NonNullable<CompetitorsResponse["attendance"]>;
type TableKey = "attendance" | "belt";

const tables: readonly { key: TableKey; label: string }[] = [
  { key: "attendance", label: "Attendance" },
  { key: "belt", label: "Belt" },
];
const cohortNames = { kids: "Kids", teens: "Teens", adults: "Adults" } as const;
const builtAtFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function Skeleton() {
  return (
    <div className="competitor-skeleton" aria-busy="true" role="status">
      <span className="visually-hidden">Loading competitors</span>
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="skeleton-card competitor-skeleton-row" />
      ))}
    </div>
  );
}

function CompetitorTable({
  table,
  neighbours,
  onOpen,
}: Readonly<{
  table: TableKey;
  neighbours: Neighbours | null;
  onOpen: (card: MemberPublicCard, opener: HTMLElement) => void;
}>) {
  if (!neighbours)
    return <p className="competitor-muted">Your place appears after tonight&apos;s update.</p>;
  const rows = [...neighbours.above, neighbours.current, ...neighbours.below];
  return (
    <ol className="competitor-list">
      {rows.map((card) => {
        const isYou = card.studentId === neighbours.current.studentId;
        const body = (
          <>
            <MemberAvatar card={card} size={40} />
            <span className="competitor-main">
              <span className="competitor-name">
                {card.displayName}
                {isYou ? " (you)" : ""}
              </span>
              <BeltLabel card={card} />
            </span>
            <span className="competitor-figures">
              {card.streakCount > 0 ? (
                <span>
                  <span className="visually-hidden">Streak </span>x{card.streakCount}
                </span>
              ) : null}
              <span>
                {table === "attendance"
                  ? `${card.attendancesSinceSeasonStart} ${card.attendancesSinceSeasonStart === 1 ? "session" : "sessions"}`
                  : card.promotionPercent === null
                    ? "–"
                    : `${Math.round(card.promotionPercent)}%`}
              </span>
            </span>
          </>
        );
        return (
          <li
            key={card.studentId}
            aria-current={isYou ? "true" : undefined}
            className={isYou ? "is-you" : undefined}
          >
            {isYou ? (
              <div className="competitor-row">{body}</div>
            ) : (
              <button
                type="button"
                className="competitor-row"
                onClick={(event) => onOpen(card, event.currentTarget)}
              >
                {body}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Competitors({ studentId }: Readonly<{ studentId: string }>) {
  const [state, setState] = useState<CompetitorsResponse | "loading" | "error">("loading");
  const [tab, setTab] = useState<TableKey>("attendance");
  const [open, setOpen] = useState<{ card: MemberPublicCard; opener: HTMLElement } | null>(null);
  const tabRefs = useRef<Record<TableKey, HTMLButtonElement | null>>({
    attendance: null,
    belt: null,
  });

  useEffect(() => {
    let active = true;
    getCompetitors(studentId)
      .then((response) => {
        if (active) setState(response);
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [studentId]);

  if (state === "loading") return <Skeleton />;
  if (state === "error")
    return <p className="client-destination-intro">{competitorsUnavailable}</p>;

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tables.findIndex((item) => item.key === tab);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tables.length
        : event.key === "ArrowLeft"
          ? (index - 1 + tables.length) % tables.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tables.length - 1
              : -1;
    if (next === -1) return;
    event.preventDefault();
    const key = tables[next]?.key ?? tab;
    setTab(key);
    tabRefs.current[key]?.focus();
  };

  const mine = state.attendance?.current ?? state.belt?.current ?? null;
  return (
    <section className="competitors" aria-label="Your place in your age group">
      <p className="competitor-cohort">{cohortNames[state.cohort]} table</p>
      <div role="tablist" aria-label="Rankings" className="competitor-tabs">
        {tables.map((item) => (
          <button
            key={item.key}
            ref={(element) => {
              tabRefs.current[item.key] = element;
            }}
            type="button"
            role="tab"
            id={`competitors-tab-${item.key}`}
            aria-controls={`competitors-panel-${item.key}`}
            aria-selected={tab === item.key}
            tabIndex={tab === item.key ? 0 : -1}
            onClick={() => setTab(item.key)}
            onKeyDown={onTabKey}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tables.map((item) => (
        <div
          key={item.key}
          role="tabpanel"
          id={`competitors-panel-${item.key}`}
          aria-labelledby={`competitors-tab-${item.key}`}
          hidden={tab !== item.key}
          className="competitor-panel"
        >
          <CompetitorTable
            table={item.key}
            neighbours={state[item.key]}
            onOpen={(card, opener) => setOpen({ card, opener })}
          />
        </div>
      ))}
      <p className="competitor-footer">
        Updated nightly{state.builtAt ? ` · ${builtAtFormat.format(new Date(state.builtAt))}` : ""}
      </p>
      {open ? (
        <MemberCardDialog
          key={open.card.studentId}
          card={open.card}
          mine={mine}
          returnFocus={open.opener}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}

/** Competitors (T043V2): two above, you, two below, in your own age group's Attendance and Belt tables. */
function CompetitorsContent() {
  const [profiles, setProfiles] = useState<readonly AccountMemberProfile[] | null>();
  const [selected, setSelected] = useState("");

  useEffect(() => {
    let active = true;
    listMyProfiles()
      .then((list) => {
        if (!active) return;
        setProfiles(list);
        setSelected(list[0]?.studentId ?? "");
      })
      .catch(() => {
        if (active) setProfiles(null);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="client-destination competitors-page" aria-labelledby="competitors-title">
      <p className="account-eyebrow">
        <Link href="/account">← Back to account</Link>
      </p>
      <h1 className="member-title-compact" id="competitors-title">
        Competitors
      </h1>
      {profiles === undefined ? (
        <Skeleton />
      ) : profiles === null || profiles.length === 0 ? (
        <p className="client-destination-intro">{competitorsUnavailable}</p>
      ) : (
        <>
          {profiles.length > 1 ? (
            <div className="competitor-person">
              <label htmlFor="competitors-person">Showing</label>
              <select
                id="competitors-person"
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                {profiles.map((profile) => (
                  <option key={profile.studentId} value={profile.studentId}>
                    {profile.via === "self" ? "You" : profile.fullName}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {selected ? <Competitors key={selected} studentId={selected} /> : null}
        </>
      )}
    </main>
  );
}

export default function AccountCompetitorsPage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate returnPath="/account/competitors">
        <CompetitorsContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
