"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  LevelCatalogMissingKey,
  LevelCatalogVersionContent,
  LevelCatalogVersionSummary,
} from "@bpt-jersey/domain/levels/editor";

import {
  activateLevelCatalog,
  createLevelCatalogDraft,
  getLevelCatalogVersion,
  listLevelCatalogVersions,
  publishLevelCatalogDraft,
} from "../../../lib/level-editor-client";
import { getLevelCatalog } from "../../../lib/levels-client";
import { LevelDraftEditor } from "./level-draft-editor";
import "./levels-editor.css";

type Notice = Readonly<{ kind: "success" | "error"; message: string }>;

/** "2 students hold White belt · stripe 2, which this version removes. Keep that level or …" */
export function describeMissingLevels(
  missing: readonly LevelCatalogMissingKey[],
  names: ReadonlyMap<string, string>,
): string {
  const parts = missing.map(
    ({ definitionKey, students }) =>
      `${students} ${students === 1 ? "student holds" : "students hold"} ${
        names.get(definitionKey) ?? definitionKey
      }, which this version removes.`,
  );
  const levels = missing.length === 1 ? "that level" : "those levels";
  return `${parts.join(" ")} Keep ${levels} or move those students first.`;
}

function statusLabel(version: LevelCatalogVersionSummary): string {
  if (version.active) return "Active";
  return version.status === "draft" ? "Draft" : "Published";
}

export function LevelVersions() {
  const [versions, setVersions] = useState<readonly LevelCatalogVersionSummary[] | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editing, setEditing] = useState<LevelCatalogVersionContent | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [list, catalogue] = await Promise.all([
        listLevelCatalogVersions(),
        getLevelCatalog().catch(() => null),
      ]);
      setVersions(list.versions);
      if (catalogue) {
        setNames(
          new Map(
            catalogue.definitions.map((definition) => [definition.definitionKey, definition.name]),
          ),
        );
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load catalogue versions.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Something went wrong.",
      });
    } finally {
      setBusy(false);
    }
  }

  const active = versions?.find((version) => version.active) ?? null;

  if (editing) {
    return (
      <LevelDraftEditor
        draft={editing}
        onClose={() => {
          setEditing(null);
          void load();
        }}
        onSaved={(saved) => setEditing(saved)}
      />
    );
  }

  return (
    <section aria-labelledby="levels-versions-title" className="levels-versions">
      <div className="levels-versions-header">
        <h2 id="levels-versions-title">Catalogue versions</h2>
        <p className="levels-editor-muted">
          Code versions stay as they are. Copy one into a draft, edit it, publish it, then activate
          it. Students keep their current level when a version is activated.
        </p>
        {active ? (
          <button
            className="levels-editor-button"
            data-variant="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => setEditing(await createLevelCatalogDraft(active.systemId)))
            }
            type="button"
          >
            Create draft from active
          </button>
        ) : null}
      </div>

      {notice ? (
        <p
          className="levels-editor-notice"
          data-kind={notice.kind}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}

      {loadError ? (
        <p className="levels-editor-notice" data-kind="error" role="alert">
          {loadError}
        </p>
      ) : versions === null ? (
        <div aria-busy="true" aria-label="Loading versions" className="levels-versions-skeleton" />
      ) : (
        <div className="levels-versions-table-wrap">
          <table className="levels-versions-table">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Name</th>
                <th scope="col">Origin</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr data-active={version.active || undefined} key={version.systemId}>
                  <td>{version.systemId}</td>
                  <td>{version.displayName}</td>
                  <td>{version.origin === "code" ? "Code" : "Custom"}</td>
                  <td>{statusLabel(version)}</td>
                  <td>
                    <div className="levels-editor-row">
                      {version.status === "draft" ? (
                        <>
                          <button
                            className="levels-editor-button"
                            disabled={busy}
                            onClick={() =>
                              void run(async () =>
                                setEditing(await getLevelCatalogVersion(version.systemId)),
                              )
                            }
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            className="levels-editor-button"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await publishLevelCatalogDraft(version.systemId);
                                setNotice({
                                  kind: "success",
                                  message: `${version.systemId} is published and can no longer be edited.`,
                                });
                                await load();
                              })
                            }
                            type="button"
                          >
                            Publish
                          </button>
                        </>
                      ) : null}
                      {version.status === "published" && !version.active ? (
                        confirming === version.systemId ? (
                          <>
                            <button
                              className="levels-editor-button"
                              data-variant="primary"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  setConfirming(null);
                                  const outcome = await activateLevelCatalog(version.systemId);
                                  if (outcome.kind === "missing") {
                                    setNotice({
                                      kind: "error",
                                      message: describeMissingLevels(outcome.missing, names),
                                    });
                                    return;
                                  }
                                  setNotice({
                                    kind: "success",
                                    message: `${version.systemId} is now the active catalogue.`,
                                  });
                                  await load();
                                })
                              }
                              type="button"
                            >
                              Confirm activation
                            </button>
                            <button
                              className="levels-editor-button"
                              onClick={() => setConfirming(null)}
                              type="button"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className="levels-editor-button"
                            disabled={busy}
                            onClick={() => setConfirming(version.systemId)}
                            type="button"
                          >
                            Activate
                          </button>
                        )
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
