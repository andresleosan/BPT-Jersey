"use client";

// Plain anchors, not next/link: MemberRecord reads ?id/&view on mount and on popstate only, so a
// full navigation is what switches between the record and the Manage view.
import { useEffect, useState } from "react";
import type { LevelCatalogProjection } from "@bpt-jersey/domain/levels";

import {
  getLevelCatalog,
  getStudentLevelCard,
  levelsSafeErrors,
  type StudentLevelCard,
} from "../../../../lib/levels-client";
import { BeltBar } from "../../../levels/levels-browser";
import { beltPosition, groupBelts } from "../../../levels/levels-grouping";

type CardState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error" }>
  | Readonly<{ status: "ready"; card: StudentLevelCard; catalog: LevelCatalogProjection }>;

const promotionDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Jersey",
});

/** `"12/25"`, or a bare `"12"` when the level defines no minimum for that criterion. */
export function formatCriterion(done: number, min: number | null): string {
  return min === null ? String(done) : `${done}/${min}`;
}

/**
 * The stored instant is read back from a document, not from this build: an absent or unparseable
 * value must drop the line, because `Intl.DateTimeFormat.format` THROWS on an invalid date and
 * would take the whole record down with it.
 */
function formatPromotedOn(startedAt: string | null): string | null {
  if (startedAt === null) return null;
  const at = new Date(startedAt);
  if (Number.isNaN(at.getTime())) return null;
  return `Promoted on ${promotionDate.format(at)}`;
}

export function IbjjfCard({
  studentId,
  canOpenLevel,
  manageHref,
}: Readonly<{ studentId: string; canOpenLevel: boolean; manageHref: string }>) {
  const [state, setState] = useState<CardState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    Promise.all([getStudentLevelCard(studentId), getLevelCatalog()])
      .then(([card, catalog]) => {
        if (active) setState({ status: "ready", card, catalog });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [studentId, attempt]);

  if (state.status === "loading") {
    return (
      <section
        aria-busy="true"
        aria-label="JIU-JITSU IBJJF"
        className="ibjjf-card ibjjf-skeleton"
      />
    );
  }

  if (state.status === "error") {
    // One fixed string for every cause. The rejection's own message is never rendered: the clients
    // promise a safe string but a network or catalogue failure can arrive with anything in it.
    return (
      <section aria-label="JIU-JITSU IBJJF" className="ibjjf-card">
        <p className="admin-eyebrow">JIU-JITSU IBJJF</p>
        <h3>Levels unavailable</h3>
        <p className="ibjjf-error" role="alert">
          {levelsSafeErrors.card}
        </p>
        <button
          className="admin-auth-button"
          onClick={() => setAttempt((value) => value + 1)}
          type="button"
        >
          Try again
        </button>
      </section>
    );
  }

  const { card, catalog } = state;
  if (card.state === "uninitialized") {
    return (
      <section aria-label="JIU-JITSU IBJJF" className="ibjjf-card">
        <p className="admin-eyebrow">JIU-JITSU IBJJF</p>
        <h3>No level yet</h3>
        <p className="ibjjf-muted">This member has no IBJJF level on record.</p>
        <a className="admin-auth-button" href={manageHref}>
          {canOpenLevel ? "Open level" : "Manage"}
        </a>
      </section>
    );
  }

  const position = beltPosition(groupBelts(catalog), card.currentDefinition.definitionKey);
  const promotedOn = formatPromotedOn(card.currentLevelStartedAt);
  const { classes, time } = card.criteria;
  // Spec 6.2: `null` means the top of the catalogue, NOT nought per cent. It must never reach a bar.
  const percent = card.targetDefinition === null ? null : card.progressPercent;

  return (
    <section aria-label="JIU-JITSU IBJJF" className="ibjjf-card">
      <p className="admin-eyebrow">JIU-JITSU IBJJF</p>
      {position === null ? null : (
        <BeltBar
          name={position.belt.name}
          stripeCount={position.stripeCount}
          visual={position.belt.visual}
        />
      )}
      <h3>{position?.definition.name ?? "Level not in the current catalogue"}</h3>
      {promotedOn === null ? null : <p className="ibjjf-muted">{promotedOn}</p>}
      {percent === null ? (
        <p className="ibjjf-muted">
          Highest level in the catalogue. There is no next graduation to work towards.
        </p>
      ) : (
        <div className="ibjjf-progress">
          <p id={`ibjjf-next-${studentId}`}>Next graduation</p>
          <progress aria-labelledby={`ibjjf-next-${studentId}`} max={100} value={percent} />
          <strong className="ibjjf-number">{percent}%</strong>
        </div>
      )}
      <dl className="ibjjf-criteria">
        <div className={classes.met ? "ibjjf-met" : "ibjjf-unmet"}>
          <dt>Classes since last promotion</dt>
          <dd>
            <span className="ibjjf-number">
              {formatCriterion(classes.completed, classes.required)}
            </span>{" "}
            <span className="ibjjf-status">{classes.met ? "Met" : "Not met"}</span>
          </dd>
          {classes.imported > 0 ? (
            <dd className="ibjjf-muted">
              {`${classes.imported} from Regyfit + ${classes.completed - classes.imported} in BPT`}
            </dd>
          ) : null}
        </div>
        <div className={time.met ? "ibjjf-met" : "ibjjf-unmet"}>
          <dt>Days at this level</dt>
          <dd>
            <span className="ibjjf-number">
              {formatCriterion(time.elapsedDays, time.requiredDays)}
            </span>{" "}
            <span className="ibjjf-status">{time.met ? "Met" : "Not met"}</span>
          </dd>
        </div>
      </dl>
      <a className="admin-auth-button" href={manageHref}>
        Manage
      </a>
    </section>
  );
}
