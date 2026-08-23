"use client";

import { LevelsBrowser } from "../../levels/levels-browser";

export default function CoachLevelsPage() {
  return (
    <div className="coach-levels-container">
      <LevelsBrowser roleContext="coach" />
    </div>
  );
}
