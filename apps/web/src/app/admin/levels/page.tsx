"use client";

import { useState } from "react";

import { LevelsBrowser } from "../../levels/levels-browser";
import { useAdminOrStaffSession } from "../admin-gate";
import { AdminSectionHeader } from "../admin-ui";
import { LevelVersions } from "./level-versions";
import "../admin.css";
import "./levels-editor.css";

type LevelsTab = "active" | "versions";

export default function AdminLevelsPage() {
  const session = useAdminOrStaffSession();
  // T04: only the office edits the catalogue; coaches and head coaches read the active one.
  const canEdit = session.role === "owner" || session.role === "administrator";
  const [tab, setTab] = useState<LevelsTab>("active");
  const shown: LevelsTab = canEdit ? tab : "active";

  return (
    <div className="admin-page-container">
      <AdminSectionHeader
        eyebrow="Admin / Levels"
        title="IBJJF Levels & Belts"
        description="Belts by colour and age group, with the stripes, minimum classes and time behind each one."
      />
      <nav aria-label="Levels views" className="levels-tabs">
        <ul role="tablist">
          <li role="presentation">
            <button
              aria-selected={shown === "active"}
              className="levels-tab"
              onClick={() => setTab("active")}
              role="tab"
              type="button"
            >
              Active catalogue
            </button>
          </li>
          {canEdit ? (
            <li role="presentation">
              <button
                aria-selected={shown === "versions"}
                className="levels-tab"
                onClick={() => setTab("versions")}
                role="tab"
                type="button"
              >
                Versions
              </button>
            </li>
          ) : null}
        </ul>
      </nav>
      {shown === "versions" ? <LevelVersions /> : <LevelsBrowser roleContext="admin" />}
    </div>
  );
}
