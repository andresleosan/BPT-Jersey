"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { SessionRecord } from "@bpt-jersey/domain/schedule";

import { ClientAuthGate, ClientAuthProvider, useClientSession } from "../../../lib/client-auth";
import { getFamily } from "../../../lib/family-client";
import { listSessions } from "../../../lib/schedule-client";
import {
  acceptClientWaitlistOffer,
  cancelClientWaitlist,
  declineClientWaitlistOffer,
  joinClientWaitlist,
  listClientMemberships,
  listStudentWaitlist,
  type ClientMembership,
  type ClientWaitlistItem,
} from "../../../lib/waitlist-client";

type Participant = Readonly<{
  studentId: string;
  membershipId: string;
  name: string;
}>;

type LoadState = "loading" | "ready" | "error";

const statusLabels: Readonly<Record<ClientWaitlistItem["status"], string>> = {
  waiting: "Waiting",
  offered: "Offered",
  accepted: "Accepted",
  expired: "Expired",
  cancelled: "Cancelled",
};

const jerseyDateTime = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Jersey",
});

const jerseyOfferDeadline = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Jersey",
  timeZoneName: "short",
});

function formatDateTime(value: string): string {
  return jerseyDateTime.format(new Date(value));
}

function locationLabel(locationId: SessionRecord["locationId"]): string {
  return locationId === "town" ? "Town" : "West";
}

function OfferCountdown({ expiresAt }: { expiresAt: string }) {
  const expiry = Date.parse(expiresAt);
  const [clock, setClock] = useState(() => Date.now());
  const minutesRemaining = Math.max(0, Math.ceil((expiry - clock) / 60_000));

  useEffect(() => {
    const remaining = expiry - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setClock(Date.now()), Math.min(60_000, remaining));
    return () => window.clearTimeout(timer);
  }, [clock, expiry]);

  return (
    <p className="waitlist-offer-deadline">
      <span>
        Respond by{" "}
        <time dateTime={expiresAt}>{jerseyOfferDeadline.format(new Date(expiresAt))}</time>
      </span>
      <span aria-hidden="true">{minutesRemaining} min remaining</span>
      <span className="waitlist-visually-hidden">
        The countdown is informational. The academy confirms whether the offer is still available.
      </span>
    </p>
  );
}

function currentMembership(membership: ClientMembership, now: number): boolean {
  return (
    (membership.status === "active" || membership.status === "trial") &&
    Date.parse(membership.startsAt) <= now &&
    (membership.endsAt === null || Date.parse(membership.endsAt) > now)
  );
}

function chooseParticipants(
  memberships: readonly ClientMembership[],
  names: ReadonlyMap<string, string>,
  now: number,
): readonly Participant[] {
  const selected = new Map<string, ClientMembership>();
  for (const membership of [...memberships]
    .filter((item) => currentMembership(item, now))
    .sort((left, right) => right.startsAt.localeCompare(left.startsAt))) {
    if (!selected.has(membership.studentId)) selected.set(membership.studentId, membership);
  }

  return Object.freeze(
    [...selected.values()]
      .map((membership, index) =>
        Object.freeze({
          studentId: membership.studentId,
          membershipId: membership.membershipId,
          name: names.get(membership.studentId)?.trim() || `Participant ${index + 1}`,
        }),
      )
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
}

async function participantNames(
  memberships: readonly ClientMembership[],
  session: Readonly<{ uid: string; displayName: string }>,
): Promise<ReadonlyMap<string, string>> {
  const names = new Map<string, string>();
  if (memberships.some((membership) => membership.studentId === session.uid)) {
    names.set(session.uid, session.displayName.trim() || "Your account");
  }
  if (memberships.every((membership) => membership.studentId === session.uid)) return names;

  try {
    const family = await getFamily();
    if (family) {
      for (const student of family.students) names.set(student.studentId, student.fullName);
    }
  } catch {
    // Identity lookup is optional; participant IDs are never used as visible fallbacks.
  }
  return names;
}
function WaitlistContent() {
  const { session } = useClientSession();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [entriesState, setEntriesState] = useState<LoadState>("loading");
  const [participants, setParticipants] = useState<readonly Participant[]>([]);
  const [sessions, setSessions] = useState<readonly SessionRecord[]>([]);
  const [entries, setEntries] = useState<readonly ClientWaitlistItem[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [loadMessage, setLoadMessage] = useState("");
  const [mutationMessage, setMutationMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [confirmingSessionId, setConfirmingSessionId] = useState("");
  const selectionGenerationRef = useRef(0);

  useEffect(() => {
    if (!session) return;
    let active = true;
    const now = new Date();
    const rangeEnd = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);

    void Promise.all([
      listClientMemberships(),
      listSessions({ from: now.toISOString(), to: rangeEnd.toISOString() }),
    ])
      .then(async ([memberships, loadedSessions]) => {
        if (!active) return;
        const names = await participantNames(memberships, session);
        if (!active) return;
        const nextParticipants = chooseParticipants(memberships, names, now.getTime());
        const nextSessions = Object.freeze(
          [...loadedSessions]
            .filter(
              (item) => item.status === "scheduled" && Date.parse(item.startAt) > now.getTime(),
            )
            .sort((left, right) => left.startAt.localeCompare(right.startAt)),
        );
        setParticipants(nextParticipants);
        setSessions(nextSessions);
        setEntriesState(nextParticipants.length === 0 ? "ready" : "loading");
        setSelectedStudentId(nextParticipants[0]?.studentId ?? "");
        setSelectedSessionId(nextSessions[0]?.sessionId ?? "");
        setLoadState("ready");
      })
      .catch(() => {
        if (!active) return;
        setLoadMessage("Unable to load your waitlist options. Please try again.");
        setLoadState("error");
      });

    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    if (!selectedStudentId) return;
    let active = true;
    const generation = selectionGenerationRef.current;
    void listStudentWaitlist(selectedStudentId)
      .then((result) => {
        if (!active || generation !== selectionGenerationRef.current) return;
        setEntries(result);
        setEntriesState("ready");
      })
      .catch(() => {
        if (active && generation === selectionGenerationRef.current) setEntriesState("error");
      });
    return () => {
      active = false;
    };
  }, [selectedStudentId]);

  const selectedParticipant = participants.find(
    (participant) => participant.studentId === selectedStudentId,
  );
  const sessionsById = useMemo(
    () => new Map(sessions.map((item) => [item.sessionId, item])),
    [sessions],
  );
  const requestedSessionIds = useMemo(
    () => new Set(entries.map((item) => item.sessionId)),
    [entries],
  );
  const selectedAlreadyRequested = requestedSessionIds.has(selectedSessionId);

  async function refreshEntries(studentId: string, generation: number): Promise<void> {
    try {
      const refreshed = await listStudentWaitlist(studentId);
      if (generation !== selectionGenerationRef.current) return;
      setEntries(refreshed);
      setEntriesState("ready");
    } catch {
      if (generation !== selectionGenerationRef.current) return;
      setEntriesState("error");
    }
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedParticipant || !selectedSessionId || selectedAlreadyRequested) return;
    const generation = selectionGenerationRef.current;
    setMutationMessage("");
    setNotice("");
    setConfirmingSessionId("");
    setBusyKey("join");
    try {
      const entry = await joinClientWaitlist({
        sessionId: selectedSessionId,
        studentId: selectedParticipant.studentId,
        membershipId: selectedParticipant.membershipId,
      });
      if (generation !== selectionGenerationRef.current) return;
      setNotice(`Joined the waitlist at position ${entry.position}.`);
      await refreshEntries(selectedParticipant.studentId, generation);
    } catch (error) {
      if (generation !== selectionGenerationRef.current) return;
      setMutationMessage(
        error instanceof Error
          ? error.message
          : "Unable to update your waitlist. Please try again.",
      );
    } finally {
      if (generation === selectionGenerationRef.current) setBusyKey("");
    }
  }

  async function handleCancel(entry: ClientWaitlistItem): Promise<void> {
    if (!selectedParticipant) return;
    const generation = selectionGenerationRef.current;
    setMutationMessage("");
    setNotice("");
    setBusyKey(`cancel:${entry.sessionId}`);
    try {
      await cancelClientWaitlist({
        sessionId: entry.sessionId,
        studentId: selectedParticipant.studentId,
      });
      if (generation !== selectionGenerationRef.current) return;
      setNotice("Waitlist place cancelled.");
      setConfirmingSessionId("");
      await refreshEntries(selectedParticipant.studentId, generation);
    } catch (error) {
      if (generation !== selectionGenerationRef.current) return;
      setMutationMessage(
        error instanceof Error
          ? error.message
          : "Unable to update your waitlist. Please try again.",
      );
    } finally {
      if (generation === selectionGenerationRef.current) setBusyKey("");
    }
  }

  async function handleOffer(
    entry: ClientWaitlistItem,
    action: "accept" | "decline",
  ): Promise<void> {
    if (!selectedParticipant) return;
    const generation = selectionGenerationRef.current;
    setMutationMessage("");
    setNotice("");
    setBusyKey(`${action}:${entry.sessionId}`);
    try {
      const input = {
        sessionId: entry.sessionId,
        studentId: selectedParticipant.studentId,
      };
      if (action === "accept") {
        await acceptClientWaitlistOffer(input);
      } else {
        await declineClientWaitlistOffer(input);
      }
      if (generation !== selectionGenerationRef.current) return;
      setNotice(action === "accept" ? "Place accepted." : "Offer declined.");
      setConfirmingSessionId("");
      await refreshEntries(selectedParticipant.studentId, generation);
    } catch (error) {
      if (generation !== selectionGenerationRef.current) return;
      setMutationMessage(
        error instanceof Error
          ? error.message
          : "Unable to update your waitlist. Please try again.",
      );
    } finally {
      if (generation === selectionGenerationRef.current) setBusyKey("");
    }
  }

  if (!session) return null;

  if (loadState === "loading") {
    return (
      <main className="waitlist-page waitlist-page-loading" aria-busy="true">
        <p className="account-eyebrow">BPT Jersey / Waitlist</p>
        <h1>Loading the mat queue</h1>
      </main>
    );
  }

  return (
    <main className="waitlist-page" id="main-content">
      <header className="waitlist-hero">
        <a className="profile-back-link" href="/account">
          <span aria-hidden="true">&larr;</span> Back to account
        </a>
        <p className="account-eyebrow">BPT Jersey / Class waitlist</p>
        <h1>Hold your place on the mat.</h1>
        <p>
          If a class is full, join its queue. Your position records your request; it does not
          confirm a booking yet.
        </p>
      </header>

      {loadState === "error" ? (
        <p className="waitlist-message waitlist-message-error" role="alert">
          {loadMessage}
        </p>
      ) : (
        <div className="waitlist-layout">
          <section className="waitlist-join-card" aria-labelledby="waitlist-join-title">
            <div>
              <p className="account-eyebrow">Join a queue</p>
              <h2 id="waitlist-join-title">Choose your class</h2>
              <p>
                Only full, future classes with an eligible membership can accept a waitlist request.
              </p>
            </div>

            {participants.length === 0 ? (
              <p className="waitlist-empty">
                No active or trial membership is available for this account.
              </p>
            ) : (
              <form className="waitlist-form" onSubmit={(event) => void handleJoin(event)}>
                <div className="waitlist-field">
                  <label htmlFor="waitlist-participant">Participant</label>
                  <select
                    id="waitlist-participant"
                    onChange={(event) => {
                      selectionGenerationRef.current += 1;
                      setBusyKey("");
                      setEntriesState("loading");
                      setSelectedStudentId(event.target.value);
                      setMutationMessage("");
                      setNotice("");
                      setConfirmingSessionId("");
                    }}
                    value={selectedStudentId}
                  >
                    {participants.map((participant) => (
                      <option key={participant.studentId} value={participant.studentId}>
                        {participant.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="waitlist-field">
                  <label htmlFor="waitlist-session">Class</label>
                  <select
                    disabled={sessions.length === 0}
                    id="waitlist-session"
                    onChange={(event) => {
                      setSelectedSessionId(event.target.value);
                      setMutationMessage("");
                      setNotice("");
                    }}
                    value={selectedSessionId}
                  >
                    {sessions.length === 0 ? <option value="">No upcoming classes</option> : null}
                    {sessions.map((item) => (
                      <option key={item.sessionId} value={item.sessionId}>
                        {item.title} — {formatDateTime(item.startAt)} —{" "}
                        {locationLabel(item.locationId)}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  className="button button-primary waitlist-submit"
                  disabled={
                    busyKey !== "" ||
                    !selectedSessionId ||
                    selectedAlreadyRequested ||
                    sessions.length === 0
                  }
                  type="submit"
                >
                  {busyKey === "join"
                    ? "Joining waitlist..."
                    : selectedAlreadyRequested
                      ? "Request already recorded"
                      : "Join waitlist"}
                </button>
              </form>
            )}
          </section>

          <section
            aria-busy={busyKey !== ""}
            className="waitlist-queue"
            aria-labelledby="waitlist-queue-title"
          >
            <div className="waitlist-queue-heading">
              <div>
                <p className="account-eyebrow">Your mat queue</p>
                <h2 id="waitlist-queue-title">Requested places</h2>
              </div>
              {selectedParticipant ? <span>{selectedParticipant.name}</span> : null}
            </div>

            {mutationMessage ? (
              <p className="waitlist-message waitlist-message-error" role="alert">
                {mutationMessage}
              </p>
            ) : null}
            {notice ? (
              <p className="waitlist-message waitlist-message-success" role="status">
                {notice}
              </p>
            ) : null}

            {entriesState === "loading" ? (
              <p className="waitlist-empty" aria-live="polite">
                Loading requested places...
              </p>
            ) : entriesState === "error" ? (
              <p className="waitlist-message waitlist-message-error" role="alert">
                Unable to refresh requested places. Please try again.
              </p>
            ) : entries.length === 0 ? (
              <p className="waitlist-empty">No waitlist requests for this participant yet.</p>
            ) : (
              <ol className="waitlist-list">
                {entries.map((entry) => {
                  const waitlistSession = sessionsById.get(entry.sessionId);
                  const isConfirming = confirmingSessionId === entry.sessionId;
                  return (
                    <li
                      className={`waitlist-item waitlist-item-${entry.status}`}
                      key={entry.sessionId}
                    >
                      <span className="waitlist-position" aria-label={`Position ${entry.position}`}>
                        {String(entry.position).padStart(2, "0")}
                      </span>
                      <div className="waitlist-item-body">
                        <div className="waitlist-item-title">
                          <h3>{waitlistSession?.title ?? "Scheduled class"}</h3>
                          <span>{statusLabels[entry.status]}</span>
                        </div>
                        <p>
                          {waitlistSession
                            ? `${formatDateTime(waitlistSession.startAt)} · ${locationLabel(waitlistSession.locationId)}`
                            : `Requested ${formatDateTime(entry.requestedAt)}`}
                        </p>
                        {entry.status === "offered" && entry.offerExpiresAt ? (
                          <OfferCountdown expiresAt={entry.offerExpiresAt} />
                        ) : null}
                        {entry.status === "offered" ? (
                          <div className="waitlist-offer-actions">
                            <button
                              className="button waitlist-offer-accept"
                              disabled={busyKey !== ""}
                              onClick={() => void handleOffer(entry, "accept")}
                              type="button"
                            >
                              {busyKey === `accept:${entry.sessionId}`
                                ? "Accepting place..."
                                : "Accept place"}
                            </button>
                            {isConfirming ? (
                              <div
                                aria-label="Confirm offer decline"
                                className="waitlist-confirm"
                                role="group"
                              >
                                <span>Decline this offered place?</span>
                                <button
                                  className="button waitlist-action-danger"
                                  disabled={busyKey !== ""}
                                  onClick={() => void handleOffer(entry, "decline")}
                                  type="button"
                                >
                                  {busyKey === `decline:${entry.sessionId}`
                                    ? "Declining offer..."
                                    : "Confirm decline"}
                                </button>
                                <button
                                  className="button waitlist-action-secondary"
                                  disabled={busyKey !== ""}
                                  onClick={() => setConfirmingSessionId("")}
                                  type="button"
                                >
                                  Keep offer
                                </button>
                              </div>
                            ) : (
                              <button
                                className="button waitlist-action-secondary"
                                disabled={busyKey !== ""}
                                onClick={() => {
                                  setConfirmingSessionId(entry.sessionId);
                                  setMutationMessage("");
                                }}
                                type="button"
                              >
                                Decline offer
                              </button>
                            )}
                          </div>
                        ) : null}
                        {entry.status === "waiting" ? (
                          isConfirming ? (
                            <div
                              className="waitlist-confirm"
                              role="group"
                              aria-label="Confirm cancellation"
                            >
                              <span>Cancel this waitlist place?</span>
                              <button
                                className="button waitlist-action-danger"
                                disabled={busyKey !== ""}
                                onClick={() => void handleCancel(entry)}
                                type="button"
                              >
                                {busyKey === `cancel:${entry.sessionId}`
                                  ? "Cancelling..."
                                  : "Confirm cancellation"}
                              </button>
                              <button
                                className="button waitlist-action-secondary"
                                disabled={busyKey !== ""}
                                onClick={() => setConfirmingSessionId("")}
                                type="button"
                              >
                                Keep place
                              </button>
                            </div>
                          ) : (
                            <button
                              className="button waitlist-action-secondary"
                              disabled={busyKey !== ""}
                              onClick={() => {
                                setConfirmingSessionId(entry.sessionId);
                                setMutationMessage("");
                              }}
                              type="button"
                            >
                              Cancel place
                            </button>
                          )
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

export default function WaitlistPage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate returnPath="/account/waitlist">
        <WaitlistContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
