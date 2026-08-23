"use client";

import { LevelsBrowser } from "../../levels/levels-browser";
import { AdminSectionHeader } from "../admin-ui";
import "../admin.css";

export default function AdminLevelsPage() {
  return (
    <div className="admin-page-container">
      <AdminSectionHeader
        eyebrow="Admin / Levels"
        title="IBJJF Levels & Belts"
        description="Canonical progression catalog, age limits, minimum classes, time requirements, and technical requirements."
      />
      <LevelsBrowser roleContext="admin" />
    </div>
  );
}
