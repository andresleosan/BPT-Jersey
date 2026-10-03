"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { LevelsBrowser } from "../../levels/levels-browser";
import { useAdminOrStaffSession } from "../admin-gate";
import { AdminSectionHeader } from "../admin-ui";
import "../admin.css";
import "./levels-editor.css";

// Only the office edits, so everyone else never downloads the editor.
const LevelsEditor = dynamic(() => import("./levels-editor").then((m) => m.LevelsEditor), {
  loading: () => (
    <div aria-busy="true" aria-label="Loading editor" className="levels-editor-skeleton" />
  ),
});

type LevelsTab = "belts" | "techniques";

export default function AdminLevelsPage() {
  const session = useAdminOrStaffSession();
  const canEdit = session.role === "owner" || session.role === "administrator";
  const [tab, setTab] = useState<LevelsTab>("belts");

  return (
    <div className="admin-page-container">
      <AdminSectionHeader
        eyebrow="Admin / Levels"
        title="IBJJF Levels & Belts"
        description="Belts by colour and age group, with the stripes, minimum classes and time behind each one."
      />
      {canEdit ? (
        <>
          <nav aria-label="Levels views" className="levels-tabs">
            <ul role="tablist">
              {(["belts", "techniques"] as const).map((value) => (
                <li key={value} role="presentation">
                  <button
                    aria-selected={tab === value}
                    className="levels-tab"
                    onClick={() => setTab(value)}
                    role="tab"
                    type="button"
                  >
                    {value === "belts" ? "Belts" : "Techniques"}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <LevelsEditor tab={tab} />
        </>
      ) : (
        <LevelsBrowser roleContext="admin" />
      )}
    </div>
  );
}
