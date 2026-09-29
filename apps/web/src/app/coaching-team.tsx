"use client";
import { useEffect, useState } from "react";
import { publicCoachesResponseSchema, type PublicCoach } from "@bpt-jersey/domain/staff/team-access";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const emulatorPort = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT;
const endpoint =
  process.env.NEXT_PUBLIC_COACHES_API_URL ??
  (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" && projectId && emulatorPort
    ? `http://127.0.0.1:${emulatorPort}/${projectId}/europe-west9/coachesPublic`
    : projectId
      ? `https://europe-west9-${projectId}.cloudfunctions.net/coachesPublic`
      : "");

/** undefined = loading, null = hide the block (error, not configured or no coaches). */
export function CoachingTeam() {
  const [coaches, setCoaches] = useState<readonly PublicCoach[] | null | undefined>(endpoint ? undefined : null);

  useEffect(() => {
    if (!endpoint) return;
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((body) => {
        const { coaches: rows } = publicCoachesResponseSchema.parse(body);
        setCoaches(rows.length > 0 ? rows : null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCoaches(null);
      });
    return () => controller.abort();
  }, []);

  if (coaches === null) return null;
  return (
    <div className="instructors-block" aria-busy={coaches === undefined}>
      <div className="section-heading">
        <h3>The coaching team</h3>
      </div>
      <ul className="instructor-list">
        {coaches === undefined
          ? [0, 1, 2].map((index) => (
              <li className="instructor-card" key={index} aria-hidden="true">
                <strong>&nbsp;</strong>
                <span>&nbsp;</span>
              </li>
            ))
          : coaches.map((coach) => (
              <li className="instructor-card" key={`${coach.belt}:${coach.name}`}>
                <strong>{coach.name}</strong>
                <span>{coach.beltLabel}</span>
              </li>
            ))}
      </ul>
    </div>
  );
}
