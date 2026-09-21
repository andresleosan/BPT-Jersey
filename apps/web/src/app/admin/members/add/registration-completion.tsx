"use client";

import { useEffect, useState } from "react";
import { jerseyDateOf, type LevelCatalogProjection } from "@bpt-jersey/domain/levels";
import {
  getLevelCatalog,
  getStudentLevelCard,
  type StudentLevelCard,
} from "../../../../lib/levels-client";
import { OpenLevelForm } from "../profile/open-level-form";
import { MemberSubscriptionEditor } from "../member-subscription-editor";

type LevelState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; catalog: LevelCatalogProjection; card: StudentLevelCard };

export function RegistrationCompletion({
  studentId,
  onRestart,
}: {
  studentId: string;
  onRestart: () => void;
}) {
  const [level, setLevel] = useState<LevelState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [subscriptionSaved, setSubscriptionSaved] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([getLevelCatalog(), getStudentLevelCard(studentId)]).then(
      ([catalog, card]) => {
        if (active) setLevel({ status: "ready", catalog, card });
      },
      () => {
        if (active) setLevel({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [studentId, attempt]);
  const levelSaved = level.status === "ready" && level.card.state === "initialized";
  const definitionKey =
    level.status === "ready" && level.card.state === "initialized"
      ? level.card.currentDefinition.definitionKey
      : null;
  const complete = levelSaved && subscriptionSaved;
  function refreshLevel() {
    setLevel({ status: "loading" });
    setAttempt((value) => value + 1);
  }
  return (
    <div className="admin-registration-completion">
      <section aria-label="Registration progress" className="member-subscription-editor">
        <h3>{complete ? "Registration complete" : "Finish member registration"}</h3>
        <p role="status">
          {complete
            ? "Personal details, level and subscription are saved."
            : "The member record is saved. Complete the remaining steps below; do not add this person again."}
        </p>
        <ul>
          <li>Personal details: saved</li>
          <li>Initial level: {levelSaved ? "saved" : "pending"}</li>
          <li>Subscription: {subscriptionSaved ? "saved" : "pending"}</li>
        </ul>
        <div className="member-subscription-actions">
          <a
            className="admin-auth-button"
            href={`/admin/members/profile/?id=${encodeURIComponent(studentId)}`}
          >
            Open member record
          </a>
          {complete ? (
            <button className="admin-auth-button" type="button" onClick={onRestart}>
              Add another member
            </button>
          ) : null}
        </div>
      </section>
      <section aria-label="Initial level" className="member-subscription-editor">
        <h3>Initial level</h3>
        {level.status === "loading" ? <p role="status">Loading level…</p> : null}
        {level.status === "error" ? (
          <p role="alert">Unable to load the level. Retry to check what has been saved.</p>
        ) : null}
        {level.status === "ready" ? (
          level.card.state === "initialized" ? (
            <p>
              Saved:{" "}
              {level.catalog.definitions.find((item) => item.definitionKey === definitionKey)
                ?.name ?? definitionKey}
            </p>
          ) : (
            <OpenLevelForm
              studentId={studentId}
              catalog={level.catalog}
              today={jerseyDateOf(new Date().toISOString())}
              onDone={refreshLevel}
            />
          )
        ) : null}
        <button
          className="admin-auth-button"
          type="button"
          disabled={level.status === "loading"}
          onClick={refreshLevel}
        >
          Check saved level
        </button>
      </section>
      <MemberSubscriptionEditor studentId={studentId} onStatusChange={setSubscriptionSaved} />
    </div>
  );
}
