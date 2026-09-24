"use client";

import { useEffect, useState } from "react";

import type { PromotionOutlook } from "../../../lib/streak-client";

type Outlook = NonNullable<PromotionOutlook>;

function milestoneNotice(outlook: Outlook): string | null {
  switch (outlook.milestone) {
    case "oneLeft":
      return `1 more class and your coach can assess you for ${outlook.nextName}.`;
    case "90":
      return "You're at 90% — your coach can assess you soon.";
    case "75":
      return `75% of the way to ${outlook.nextName}.`;
    default:
      return null;
  }
}

/** True the first time this participant reaches this milestone on this level on this device. */
function firstSighting(studentId: string, outlook: Outlook): boolean {
  const key = `bpt.promotionNotice.${studentId}.${outlook.levelKey}.${outlook.milestone}`;
  try {
    if (window.localStorage.getItem(key)) return false;
    window.localStorage.setItem(key, new Date().toISOString());
  } catch {
    /* no storage: show it this time */
  }
  return true;
}

export function PromotionBar({
  outlook,
  studentId,
}: Readonly<{ outlook: PromotionOutlook; studentId: string }>) {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!outlook) return;
    const text = milestoneNotice(outlook);
    // Storage is read after mount so the static export and the first client render agree.
    if (text && firstSighting(studentId, outlook)) setNotice(text);
  }, [outlook, studentId]);
  if (!outlook) return null;
  // Floor, so the figure never runs ahead of the milestone the server reports.
  const percent = Math.floor(outlook.percent);
  return (
    <div className="promotion-bar">
      <div className="streak-bar-head">
        <span>Next belt: {outlook.nextName}</span>
        <span>{percent}%</span>
      </div>
      <progress
        max={100}
        value={percent}
        aria-label={`Progress to ${outlook.nextName}: ${percent}%`}
      />
      {outlook.classesToGo !== null ? (
        <p className="promotion-to-go">
          {outlook.classesToGo} {outlook.classesToGo === 1 ? "class" : "classes"} to go
        </p>
      ) : null}
      {/* Mounted empty so the text change is announced; `:empty` hides it until then. */}
      <p className="promotion-notice" role="status">
        {notice ?? ""}
      </p>
    </div>
  );
}
