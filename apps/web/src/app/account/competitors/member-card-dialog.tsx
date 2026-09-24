"use client";

import { useEffect, useRef, useState } from "react";

import { compareTechniques, type MemberPublicCard } from "@bpt-jersey/domain/members/engagement";

import { getLevelCatalog } from "../../../lib/levels-client";

import "./competitors.css";

const listLimit = 12;
// Belt colours are catalogue data; anything that is not a plain hex or colour word is not painted.
const safeColour = /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/iu;

function initials(name: string): string {
  const parts = name.replace(/\./gu, "").trim().split(/\s+/u);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

/** `skill-key` → «Skill key» when the catalogue has no label for it. */
function humanise(key: string): string {
  const words = key.replace(/[-_.:]+/gu, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

let skillLabels: Promise<ReadonlyMap<string, string>> | undefined;
function loadSkillLabels(): Promise<ReadonlyMap<string, string>> {
  skillLabels ??= getLevelCatalog()
    .then((catalog) => new Map(catalog.skills.map((skill) => [skill.key, skill.displayLabel])))
    .catch(() => {
      skillLabels = undefined;
      return new Map<string, string>();
    });
  return skillLabels;
}

export function MemberAvatar({ card, size }: Readonly<{ card: MemberPublicCard; size: number }>) {
  if (card.photoUrl?.startsWith("https://")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed R2 URL on a static export
      <img className="competitor-avatar" src={card.photoUrl} width={size} height={size} alt={card.displayName} />
    );
  }
  return (
    <span className="competitor-avatar competitor-initials" style={{ width: size, height: size }} aria-hidden="true">
      {initials(card.displayName)}
    </span>
  );
}

export function BeltLabel({ card }: Readonly<{ card: MemberPublicCard }>) {
  if (!card.belt) return <span className="competitor-belt">No belt yet</span>;
  const colour = safeColour.test(card.belt.color) ? card.belt.color : undefined;
  return (
    <span className="competitor-belt">
      <span className="competitor-belt-swatch" style={colour ? { background: colour } : undefined} aria-hidden="true" />
      <span>
        {card.belt.name} · {card.stripes} {card.stripes === 1 ? "stripe" : "stripes"}
      </span>
    </span>
  );
}

function TechniqueList({
  title,
  keys,
  labels,
}: Readonly<{ title: string; keys: readonly string[]; labels: ReadonlyMap<string, string> }>) {
  const shown = keys.slice(0, listLimit);
  return (
    <section className="competitor-techniques">
      <h3>{title}</h3>
      {keys.length === 0 ? (
        <p className="competitor-muted">Nothing here.</p>
      ) : (
        <ul>
          {shown.map((key) => (
            <li key={key}>{labels.get(key) ?? humanise(key)}</li>
          ))}
          {keys.length > listLimit ? <li className="competitor-muted">+{keys.length - listLimit} more</li> : null}
        </ul>
      )}
    </section>
  );
}

/**
 * Another member's public card in a native dialog. Opens on mount, closes on Esc or «Close», and
 * gives focus back to whatever opened it. Without `mine` the technique comparator is left out.
 */
export function MemberCardDialog({
  card,
  mine,
  onClose,
}: Readonly<{ card: MemberPublicCard; mine: MemberPublicCard | null; onClose: () => void }>) {
  const ref = useRef<HTMLDialogElement>(null);
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(new Map());
  // Read at first render, before showModal moves focus, so a StrictMode re-run keeps the real trigger.
  const [trigger] = useState(() =>
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const titleId = `member-card-${card.studentId}`;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    // No close() here: under StrictMode its queued close event would reach onClose after the re-open.
    return () => trigger?.focus();
  }, [trigger]);

  useEffect(() => {
    if (!mine) return;
    let active = true;
    void loadSkillLabels().then((map) => {
      if (active) setLabels(map);
    });
    return () => {
      active = false;
    };
  }, [mine]);

  const close = () => {
    const dialog = ref.current;
    if (dialog && typeof dialog.close === "function") dialog.close();
    else onClose();
  };
  const comparison = mine ? compareTechniques(mine.skillKeys, card.skillKeys) : null;

  return (
    <dialog ref={ref} className="member-card-dialog" aria-labelledby={titleId} onClose={onClose}>
      <div className="member-card-head">
        <MemberAvatar card={card} size={96} />
        <div>
          <h2 id={titleId}>{card.displayName}</h2>
          <BeltLabel card={card} />
        </div>
      </div>
      <dl className="member-card-stats">
        <div>
          <dt>Streak</dt>
          <dd>x{card.streakCount}</dd>
        </div>
        <div>
          <dt>Sessions this season</dt>
          <dd>{card.attendancesSinceSeasonStart}</dd>
        </div>
      </dl>
      {comparison ? (
        <div className="member-card-compare">
          <TechniqueList title="They have, you don't" keys={comparison.theyHave} labels={labels} />
          <TechniqueList title="You have, they don't" keys={comparison.iHave} labels={labels} />
        </div>
      ) : null}
      <div className="member-card-actions">
        <button type="button" className="button" onClick={close}>
          Close
        </button>
      </div>
    </dialog>
  );
}
