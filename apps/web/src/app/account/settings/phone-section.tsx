"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { z } from "zod";

import type { ClientProfileProjection } from "@bpt-jersey/domain";

import {
  createGuardianProfileRequestId,
  getGuardianProfile,
  saveGuardianProfile,
} from "../../../lib/guardian-profile-client";
import {
  createProfileRequestId,
  getClientProfile,
  saveClientProfile,
} from "../../../lib/profile-client";
import { SettingsField, StatusBand, type SectionStatus } from "./email-section";

export const phonePattern = /^\+?[0-9 ()-]{7,20}$/u;
export const phoneFormatMessage = "Enter a phone number using digits, spaces, +, ( ) or -.";
/** A required phone number: empty and badly formed read differently. */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, "Enter a phone number.")
  .regex(phonePattern, phoneFormatMessage);

/** What a save must send back unchanged: the member's training profile, or the guardian's name. */
type Source =
  | Readonly<{ kind: "member"; student: ClientProfileProjection["student"] }>
  | Readonly<{ kind: "guardian"; displayName: string }>;

const loadFailed = "We couldn't load your phone number. Try again.";

export function PhoneSection({ mode }: Readonly<{ mode: "member" | "guardian" }>) {
  const ids = useId();
  const [source, setSource] = useState<Source | null>();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<SectionStatus>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (mode === "member") {
          const profile = await getClientProfile();
          if (!active) return;
          setSource(profile ? { kind: "member", student: profile.student } : null);
          setPhone(profile?.student.phoneNumber ?? "");
        } else {
          const profile = await getGuardianProfile();
          if (!active) return;
          setSource(profile ? { kind: "guardian", displayName: profile.displayName } : null);
          setPhone(profile?.phoneNumber ?? "");
        }
      } catch {
        if (!active) return;
        setSource(null);
        setStatus({ kind: "error", message: loadFailed });
      }
    })();
    return () => {
      active = false;
    };
  }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !source) return;
    const parsed = phoneSchema.safeParse(phone);
    setStatus(undefined);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      if (source.kind === "member") {
        const { student } = source;
        const saved = await saveClientProfile({
          requestId: createProfileRequestId(),
          fullName: student.fullName,
          dateOfBirth: student.dateOfBirth ?? "",
          phoneNumber: parsed.data,
          trainingCenter: student.trainingCenter,
          trainingTimePreferences: [...student.trainingTimePreferences],
        });
        setSource({ kind: "member", student: saved.student });
      } else {
        await saveGuardianProfile({
          requestId: createGuardianProfileRequestId(),
          displayName: source.displayName,
          phoneNumber: parsed.data,
        });
      }
      setPhone(parsed.data);
      setStatus({ kind: "success", message: "Phone number saved." });
    } catch (cause) {
      setStatus({
        kind: "error",
        message: cause instanceof Error && cause.message ? cause.message : loadFailed,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-section" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`}>Phone</h2>
      {source === undefined ? (
        <div aria-busy="true" role="status">
          <span className="visually-hidden">Loading your phone number</span>
          <div className="skeleton-card settings-skeleton-input" />
        </div>
      ) : source === null ? (
        status ? null : (
          <p className="settings-help">Complete your profile first to add a phone number.</p>
        )
      ) : (
        <form className="settings-form" noValidate onSubmit={(event) => void submit(event)}>
          <SettingsField
            id={`${ids}-phone`}
            label="Phone number"
            type="tel"
            autoComplete="tel"
            value={phone}
            disabled={saving}
            error={error}
            onChange={(event) => setPhone(event.target.value)}
          />
          <div className="settings-actions">
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save phone"}
            </button>
          </div>
        </form>
      )}
      <StatusBand status={status} />
    </section>
  );
}
