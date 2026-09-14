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
        description="Belts by colour and age group, with the stripes, minimum classes and time behind each one."
      />
      <LevelsBrowser roleContext="admin" />
    </div>
  );
}
