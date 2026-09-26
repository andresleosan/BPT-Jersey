"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  PRIVATE_LESSON_OPTIONS,
  privateLessonOptionIds,
  type MyPrivateLessons,
  type PrivateLessonOptionId,
} from "@bpt-jersey/domain/private-lessons";

import { ClientAuthGate, ClientAuthProvider, useClientSession } from "../../../lib/client-auth";
import { getFamily } from "../../../lib/family-client";
import { listMyProfiles } from "../../../lib/family-plan-client";
import { uploadIntroMembershipProof } from "../../../lib/intro-conversion-client";
import { participantBand } from "../../../lib/participant-band";
import { privateLessonPriceLabel } from "../../../lib/plan-copy";
import {
  listMyPrivateLessons,
  submitPrivateLessonPurchase,
} from "../../../lib/private-lesson-client";
import { getClientProfile } from "../../../lib/profile-client";
import { EnrolmentBankDetails, useEnrolmentBankDetails } from "../../enrol/payment-instructions";

import "./private-lessons.css";

type Subject = Readonly<{ studentId: string; displayName: string; eligible: boolean }>;

const dayLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Jersey",
});
const statusLabels = {
  pending: "Waiting for the academy",
  approved: "Approved",
  rejected: "Not approved",
};

const optionNotes: Readonly<Record<PrivateLessonOptionId, string>> = {
  single: "One lesson, valid for 3 months.",
  monthly: "Four lessons, valid for one month. Renew with a new transfer.",
  "pack-10": "Ten lessons, valid for 6 months.",
};

/** 16+ only (D6 band "adult"); no date of birth counts as adult, as everywhere else. */
function eligible(dateOfBirth: string | undefined): boolean {
  return dateOfBirth === undefined || participantBand(dateOfBirth) === "adult";
}

function PrivateLessonsContent() {
  const { session } = useClientSession();
  const [subjects, setSubjects] = useState<readonly Subject[]>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [studentId, setStudentId] = useState("");
  const [lessons, setLessons] = useState<MyPrivateLessons>();
  const [optionId, setOptionId] = useState<PrivateLessonOptionId>();
  const [reference, setReference] = useState("");
  const [proof, setProof] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Readonly<{ kind: "success" | "error"; text: string }>>();
  const bank = useEnrolmentBankDetails(session?.uid);

  const load = useCallback(async () => {
    if (!session) return;
    setState("loading");
    try {
      const profiles = await listMyProfiles();
      const [own, family] = await Promise.all([
        profiles.some((profile) => profile.via === "self") ? getClientProfile() : undefined,
        profiles.some((profile) => profile.via === "guardian") ? getFamily() : undefined,
      ]);
      const next = profiles.flatMap((profile): Subject[] => {
        if (profile.via === "self") {
          const student = own?.student.studentId === profile.studentId ? own.student : undefined;
          return student
            ? [
                {
                  studentId: profile.studentId,
                  displayName: "You",
                  eligible: eligible(student.dateOfBirth),
                },
              ]
            : [];
        }
        const child = family?.students.find((student) => student.studentId === profile.studentId);
        return child
          ? [
              {
                studentId: child.studentId,
                displayName: child.fullName,
                eligible: eligible(child.dateOfBirth),
              },
            ]
          : [];
      });
      setSubjects(next);
      setStudentId((current) =>
        next.some((subject) => subject.studentId === current)
          ? current
          : (next[0]?.studentId ?? ""),
      );
      setState("ready");
    } catch {
      setState("error");
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const subject = subjects?.find((item) => item.studentId === studentId);

  useEffect(() => {
    setLessons(undefined);
    setOptionId(undefined);
    setReference("");
    setProof(undefined);
    if (!subject?.eligible) return;
    let active = true;
    void listMyPrivateLessons(subject.studentId).then(
      (value) => {
        if (active) setLessons(value);
      },
      (error: unknown) => {
        if (active)
          setNotice({
            kind: "error",
            text:
              error instanceof Error
                ? error.message
                : "Private lessons are unavailable. Try again.",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [subject?.studentId, subject?.eligible]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!subject || !optionId || busy) return;
    if (!proof || reference.trim().length < 2) {
      setNotice({
        kind: "error",
        text: "Add the transfer reference and a PNG or JPEG screenshot before sending.",
      });
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      const requestId = crypto.randomUUID();
      const proofId = await uploadIntroMembershipProof(requestId, proof);
      await submitPrivateLessonPurchase({
        requestId,
        studentId: subject.studentId,
        optionId,
        proofId,
        bankReference: reference.trim(),
      });
      setOptionId(undefined);
      setReference("");
      setProof(undefined);
      setNotice({
        kind: "success",
        text: "Sent. Your lessons are ready once the academy confirms the transfer.",
      });
      setLessons(await listMyPrivateLessons(subject.studentId).catch(() => lessons));
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "We could not save the private lesson request. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className="client-destination private-lessons-page"
      aria-labelledby="private-lessons-title"
    >
      <Link className="private-lessons-back" href="/account">
        <span aria-hidden="true">&larr;</span> Back to calendar
      </Link>
      <p className="account-eyebrow">BPT Jersey / Private lessons</p>
      <h1 id="private-lessons-title">Private lessons</h1>
      <p className="client-destination-intro">
        Buy one-to-one lessons by bank transfer. The academy confirms the transfer and then arranges
        each lesson with you.
      </p>

      {state === "loading" ? (
        <div
          className="private-lessons-skeleton"
          aria-busy="true"
          aria-label="Loading private lessons"
        >
          <div />
          <div />
        </div>
      ) : null}
      {state === "error" ? (
        <section className="private-lessons-panel" role="alert">
          <h2>Private lessons are unavailable</h2>
          <p>We could not load your details. Please try again.</p>
          <button className="button button-secondary" onClick={() => void load()} type="button">
            Try again
          </button>
        </section>
      ) : null}

      {state === "ready" && subjects?.length === 0 ? (
        <section className="private-lessons-panel">
          <h2>No member on this account</h2>
          <p>Ask the academy to link your account to your member profile.</p>
        </section>
      ) : null}

      {state === "ready" && subjects && subjects.length > 1 ? (
        <fieldset className="private-lessons-people">
          <legend>Lessons for</legend>
          {subjects.map((item) => (
            <label key={item.studentId}>
              <input
                checked={studentId === item.studentId}
                name="private-lessons-student"
                onChange={() => {
                  setStudentId(item.studentId);
                  setNotice(undefined);
                }}
                type="radio"
                value={item.studentId}
              />
              {item.displayName}
            </label>
          ))}
        </fieldset>
      ) : null}

      {subject && !subject.eligible ? (
        <section className="private-lessons-panel">
          <p>Private lessons are for members aged 16 or over.</p>
        </section>
      ) : null}

      {subject?.eligible ? (
        <>
          <section className="private-lessons-panel" aria-labelledby="private-lessons-credits">
            <h2 id="private-lessons-credits">Your lessons</h2>
            {lessons === undefined ? (
              <p aria-busy="true">Loading your lessons…</p>
            ) : (
              <>
                <p className="private-lessons-credits">
                  {lessons.creditsAvailable === 1
                    ? "1 private lesson available"
                    : `${lessons.creditsAvailable} private lessons available`}
                </p>
                {lessons.nextExpiry ? (
                  <p>Expires {dayLabel.format(new Date(lessons.nextExpiry))}</p>
                ) : null}
                {lessons.purchases.length > 0 ? (
                  <ul className="private-lessons-history">
                    {lessons.purchases.map((purchase) => (
                      <li data-status={purchase.status} key={purchase.purchaseId}>
                        <span>{PRIVATE_LESSON_OPTIONS[purchase.optionId].displayName}</span>
                        <span>{statusLabels[purchase.status]}</span>
                        <span>{dayLabel.format(new Date(purchase.submittedAt))}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </section>

          <form className="private-lessons-form" onSubmit={(event) => void submit(event)}>
            <fieldset className="private-lessons-options">
              <legend>Choose lessons</legend>
              {privateLessonOptionIds.map((id) => (
                <label className="private-lessons-option" key={id}>
                  <input
                    checked={optionId === id}
                    name="private-lesson-option"
                    onChange={() => setOptionId(id)}
                    type="radio"
                    value={id}
                  />
                  <span className="private-lessons-option-name">
                    {PRIVATE_LESSON_OPTIONS[id].displayName}
                  </span>
                  <span className="private-lessons-option-price">
                    {privateLessonPriceLabel(id)}
                  </span>
                  <span className="private-lessons-option-note">{optionNotes[id]}</span>
                </label>
              ))}
            </fieldset>
            {optionId ? (
              <fieldset className="private-lessons-payment">
                <legend>Pay by bank transfer</legend>
                <EnrolmentBankDetails {...bank} />
                <label htmlFor="private-lesson-reference">Transfer reference</label>
                <input
                  id="private-lesson-reference"
                  maxLength={80}
                  onChange={(event) => setReference(event.target.value)}
                  value={reference}
                />
                <label htmlFor="private-lesson-proof">Transfer screenshot</label>
                <input
                  accept="image/png,image/jpeg"
                  id="private-lesson-proof"
                  onChange={(event) => setProof(event.target.files?.[0])}
                  type="file"
                />
                <p>Only academy administrators see your screenshot.</p>
                <button className="button button-primary" disabled={busy} type="submit">
                  {busy ? "Sending..." : "Send to the academy"}
                </button>
              </fieldset>
            ) : null}
          </form>
        </>
      ) : null}

      {notice ? (
        <p
          className={`private-lessons-notice private-lessons-notice-${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}
    </main>
  );
}

export default function ClientPrivateLessonsPage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate allow={["guardian", "adultStudent"]} returnPath="/account/private-lessons">
        <PrivateLessonsContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
