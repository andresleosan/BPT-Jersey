"use client";

import { useEffect, useState } from "react";

import {
  defaultGoal,
  defaultReward,
  type ProgressBar,
} from "@bpt-jersey/domain/members/engagement";

import {
  getMemberStreak,
  getPromotionOutlook,
  type MemberStreak,
  type PromotionOutlook,
} from "../../../lib/streak-client";
import { PromotionBar } from "../promotion/promotion-bar";
import { StreakFlame } from "./streak-flame";

type PanelState =
  | { status: "loading" }
  | { status: "hidden" }
  | { status: "ready"; streak: MemberStreak; outlook: PromotionOutlook };

function Bar({
  bar,
  base,
  noun,
}: Readonly<{ bar: ProgressBar; base: number; noun: "goal" | "reward" }>) {
  const done = base - bar.remaining;
  return (
    <div className={`streak-bar streak-bar--${noun}${bar.almost ? " is-almost" : ""}`}>
      <div className="streak-bar-head">
        <span>{bar.label}</span>
        <span>
          {bar.progress}/{bar.target}
        </span>
      </div>
      <progress
        max={base}
        value={done}
        aria-label={`${bar.label}: ${bar.progress} of ${bar.target}`}
      />
      {bar.almost ? (
        <p className="streak-bar-hint">One more class to reach your next {noun}.</p>
      ) : null}
    </div>
  );
}

/**
 * Streak slot between the purple header and the calendar (T042V2). Both calls load together so the card appears once,
 * at the skeleton's height. Any error hides the slot; a missing outlook only drops the belt bar.
 * Mounted with `key={studentId}`, so switching participant starts again from the skeleton.
 */
export function StreakPanel({ studentId }: Readonly<{ studentId: string }>) {
  const [state, setState] = useState<PanelState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    Promise.all([getMemberStreak(studentId), getPromotionOutlook(studentId).catch(() => null)])
      .then(([streak, outlook]) => {
        if (active) setState({ status: "ready", streak, outlook });
      })
      .catch(() => {
        if (active) setState({ status: "hidden" });
      });
    return () => {
      active = false;
    };
  }, [studentId]);

  if (state.status === "hidden") return null;
  if (state.status === "loading") {
    return (
      <div
        aria-hidden="true"
        className="skeleton-card streak-panel-skeleton"
        data-testid="streak-skeleton"
      />
    );
  }
  const { streak, outlook } = state;
  return (
    <section aria-label="Streak" className="streak-panel">
      <PromotionBar outlook={outlook} studentId={studentId} />
      <p className="account-eyebrow">Streak</p>
      <StreakFlame count={streak.streakCount} />
      <Bar bar={streak.goal} base={defaultGoal.target} noun="goal" />
      <Bar bar={streak.reward} base={defaultReward.target} noun="reward" />
      <p className="streak-hours">{streak.hoursSinceSeasonStart} hours trained this season</p>
    </section>
  );
}
