"use client";

import { useCallback, useEffect, useState } from "react";
import type { EditableLevelCatalog } from "@bpt-jersey/domain/levels/editor";

import { getEditableLevelCatalog, saveLevelCatalog } from "../../../lib/level-editor-client";
import { LevelsBrowser } from "../../levels/levels-browser";
import { BeltEditor, type CatalogContent } from "./belt-editor";
import { TechniquesLibrary } from "./techniques-library";
import "./levels-editor.css";

type Notice = Readonly<{ kind: "success" | "error" | "stale"; message: string }>;

export function LevelsEditor({ tab }: { tab: "belts" | "techniques" }) {
  const [catalog, setCatalog] = useState<EditableLevelCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setCatalog(await getEditableLevelCatalog());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load the belt catalogue.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(next: CatalogContent): Promise<boolean> {
    if (catalog === null) return false;
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await saveLevelCatalog({ expectedUpdatedAt: catalog.updatedAt, ...next });
      if (outcome.kind === "stale") {
        setNotice({
          kind: "stale",
          message: "Someone else changed the levels. Reload to see their changes.",
        });
        return false;
      }
      setCatalog(outcome.catalog);
      setVersion((current) => current + 1);
      setNotice({ kind: "success", message: "Saved." });
      return true;
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to save.",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const banner = notice ? (
    <div
      className="levels-editor-notice"
      data-kind={notice.kind}
      role={notice.kind === "success" ? "status" : "alert"}
    >
      <p>{notice.message}</p>
      {notice.kind === "stale" ? (
        <button
          className="levels-editor-button"
          onClick={() => {
            setNotice(null);
            setEditing(null);
            setVersion((current) => current + 1);
            void load();
          }}
          type="button"
        >
          Reload
        </button>
      ) : null}
    </div>
  ) : null;

  if (loadError) {
    return (
      <div className="levels-editor-notice" data-kind="error" role="alert">
        <p>{loadError}</p>
        <button className="levels-editor-button" onClick={() => void load()} type="button">
          Retry
        </button>
      </div>
    );
  }

  if (tab === "techniques") {
    return catalog === null ? (
      <div aria-busy="true" aria-label="Loading techniques" className="levels-editor-skeleton" />
    ) : (
      <>
        {banner}
        <TechniquesLibrary busy={busy} catalog={catalog} onSave={save} />
      </>
    );
  }

  return (
    <>
      {banner}
      <LevelsBrowser
        renderBeltEditor={(beltKey) =>
          catalog === null ? null : (
            <BeltEditor
              beltKey={beltKey}
              busy={busy}
              catalog={catalog}
              editing={editing === beltKey}
              key={`${beltKey}-${catalog.updatedAt}`}
              locked={editing !== null && editing !== beltKey}
              onClose={() => setEditing(null)}
              onEdit={() => {
                setNotice(null);
                setEditing(beltKey);
              }}
              onSave={save}
            />
          )
        }
        roleContext="admin"
        version={version}
      />
    </>
  );
}
