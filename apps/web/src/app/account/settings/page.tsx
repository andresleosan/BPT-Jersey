"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { AccountMemberProfile } from "@bpt-jersey/domain/members/access";
import { memberAgeOn } from "@bpt-jersey/domain/members/access";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";

import {
  approveProposedPhoto,
  createTeenAccess,
  getMySettings,
  removeProfilePhoto,
  revokeTeenAccess,
  setMemberVisibility,
  settingsMessages,
  uploadProfilePhoto,
  type MySettings,
} from "../../../lib/account-settings-client";
import { ClientAuthGate, ClientAuthProvider } from "../../../lib/client-auth";
import { getFamily } from "../../../lib/family-client";
import { listMyProfiles } from "../../../lib/family-plan-client";
import { cropToSquareWebp, type CroppedAvatar } from "./avatar-cropper";

import "../account.css";
import "./settings.css";

const consentText =
  "I agree that this photo will be shown to other BPT Jersey members in the academy's internal leaderboard and class lists";

type Person = Readonly<{ profile: AccountMemberProfile; age: number | null }>;

const errorText = (cause: unknown, fallback: string) => (cause instanceof Error && cause.message ? cause.message : fallback);

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/u);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

/** Account settings (T044V2): photo, visibility and, for a guardian, a 12–17 year old's own sign-in. */
function SettingsContent() {
  const [people, setPeople] = useState<readonly Person[] | null>();
  const [selected, setSelected] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const profiles = await listMyProfiles();
        // Children's dates of birth only narrow the own-access section; without them the server decides.
        const family = profiles.some((profile) => profile.via === "guardian") ? await getFamily().catch(() => undefined) : undefined;
        const today = dateKeyInJersey(new Date());
        const next = profiles.map((profile): Person => {
          const child = family?.students.find((student) => student.studentId === profile.studentId);
          return { profile, age: child ? memberAgeOn(child.dateOfBirth, today) : null };
        });
        if (!active) return;
        setPeople(next);
        setSelected(next[0]?.profile.studentId ?? "");
      } catch {
        if (active) setPeople(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const person = people?.find((item) => item.profile.studentId === selected);

  return (
    <main className="client-destination settings-page" aria-labelledby="settings-title">
      <p className="account-eyebrow">
        <Link href="/account">← Back to Account</Link>
      </p>
      <h1 id="settings-title">Account settings</h1>
      {people === undefined ? (
        <div aria-busy="true" role="status">
          <span className="visually-hidden">Loading your settings</span>
          <SectionSkeletons />
        </div>
      ) : people === null || people.length === 0 ? (
        <p className="client-destination-intro">Settings are not available right now.</p>
      ) : (
        <>
          {people.length > 1 ? (
            <div className="settings-field settings-person">
              <label htmlFor="settings-person">Settings for</label>
              <select id="settings-person" value={selected} onChange={(event) => setSelected(event.target.value)}>
                {people.map((item) => (
                  <option key={item.profile.studentId} value={item.profile.studentId}>
                    {item.profile.via === "self" ? "You" : item.profile.fullName}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {person ? <PersonSettings key={person.profile.studentId} person={person} /> : null}
        </>
      )}
    </main>
  );
}

function SectionSkeletons() {
  return (
    <div className="settings-sections">
      <div className="settings-section">
        <div className="skeleton-card settings-skeleton-title" />
        <div className="settings-skeleton-photo">
          <div className="skeleton-card settings-skeleton-avatar" />
          <div className="skeleton-card settings-skeleton-line" />
        </div>
        <div className="skeleton-card settings-skeleton-button" />
      </div>
      <div className="settings-section">
        <div className="skeleton-card settings-skeleton-title" />
        <div className="skeleton-card settings-skeleton-line" />
      </div>
    </div>
  );
}

function PersonSettings({ person }: Readonly<{ person: Person }>) {
  const { profile, age } = person;
  const [settings, setSettings] = useState<MySettings | null>();

  const reload = useCallback(async () => {
    try {
      setSettings(await getMySettings(profile.studentId));
    } catch {
      setSettings(null);
    }
  }, [profile.studentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (settings === undefined) {
    return (
      <div aria-busy="true" role="status">
        <span className="visually-hidden">Loading settings</span>
        <SectionSkeletons />
      </div>
    );
  }
  // A failed load hides every section that depends on it.
  if (settings === null) return null;

  const isTeen = profile.via === "self" && !settings.canManage;
  const ownAccess = profile.via === "guardian" && (age === null || (age >= 12 && age < 18));
  return (
    <div className="settings-sections">
      <PhotoSection profile={profile} settings={settings} isTeen={isTeen} onChanged={reload} />
      <VisibilitySection studentId={profile.studentId} settings={settings} />
      {ownAccess ? <OwnAccessSection profile={profile} settings={settings} onChanged={reload} /> : null}
    </div>
  );
}

function PhotoSection({
  profile,
  settings,
  isTeen,
  onChanged,
}: Readonly<{ profile: AccountMemberProfile; settings: MySettings; isTeen: boolean; onChanged: () => Promise<void> }>) {
  const ids = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState<CroppedAvatar>();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const confirm = useRef<HTMLDialogElement>(null);
  const confirmTrigger = useRef<HTMLButtonElement | null>(null);
  const [pendingAction, setPendingAction] = useState<"approve" | "remove">("remove");

  /** Approving or removing a photo changes what other members see, so it asks first. */
  function ask(action: "approve" | "remove", button: HTMLButtonElement) {
    confirmTrigger.current = button;
    setPendingAction(action);
    confirm.current?.showModal();
  }

  function confirmAction() {
    confirm.current?.close();
    if (pendingAction === "approve") {
      void run(() => approveProposedPhoto(profile.studentId), settingsMessages.approveFailed, "Photo approved.");
    } else {
      void run(() => removeProfilePhoto(profile.studentId), settingsMessages.removeFailed, "Photo removed.");
    }
  }

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    setError(undefined);
    setNotice(undefined);
    setCrop(undefined);
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setCrop(await cropToSquareWebp(file));
    } catch (cause) {
      const tooLarge = cause instanceof Error && cause.message === settingsMessages.photoTooLarge;
      setError(tooLarge ? settingsMessages.photoTooLarge : settingsMessages.photoType);
      event.target.value = "";
    }
  }

  async function run(action: () => Promise<unknown>, fallback: string, done?: string) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
      setCrop(undefined);
      setConsent(false);
      if (fileInput.current) fileInput.current.value = "";
      setNotice(done);
      await onChanged();
    } catch (cause) {
      setError(errorText(cause, fallback));
    } finally {
      setBusy(false);
    }
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!crop || !consent) return;
    void run(
      () => uploadProfilePhoto({ studentId: profile.studentId, base64: crop.base64, mime: crop.mime }),
      settingsMessages.photoFailed,
      isTeen ? "Photo sent. Your parent or guardian will approve it." : "Photo saved.",
    );
  }

  const [brokenSrc, setBrokenSrc] = useState<string>();
  const loaded = crop?.previewUrl ?? settings.photoUrl;
  // A signed URL expires after a few minutes: one that no longer loads falls back to initials.
  const shown = loaded === brokenSrc ? null : loaded;
  return (
    <section className="settings-section" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`}>Photo</h2>
      <div className="settings-photo">
        {shown ? (
          // A signed, short-lived URL or a local preview: next/image cannot optimise either in a static export.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="settings-avatar"
            src={shown}
            alt={crop ? "Preview of your new photo" : "Current photo"}
            width={96}
            height={96}
            onError={() => setBrokenSrc(shown)}
          />
        ) : (
          <span className="settings-avatar settings-avatar-initials" aria-hidden="true">
            {initials(profile.fullName)}
          </span>
        )}
        {settings.pendingPhotoUrl ? (
          <div className="settings-pending">
            <p className="settings-help settings-pending-label">Suggested photo</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="settings-avatar" src={settings.pendingPhotoUrl} alt="Suggested photo" width={96} height={96} />
            {settings.canManage ? (
              <button
                className="button button-primary"
                type="button"
                disabled={busy}
                onClick={(event) => ask("approve", event.currentTarget)}
              >
                Approve photo
              </button>
            ) : (
              <p className="settings-help">Waiting for your parent or guardian.</p>
            )}
          </div>
        ) : null}
      </div>
      <form className="settings-form" onSubmit={upload}>
        <div className="settings-field">
          <label htmlFor={`${ids}-file`}>Choose a photo</label>
          <input
            ref={fileInput}
            id={`${ids}-file`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(event) => void choose(event)}
          />
        </div>
        <label className="settings-check">
          <input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />
          <span>{consentText}</span>
        </label>
        {isTeen ? <p className="settings-help">Your parent or guardian will approve it.</p> : null}
        <div className="settings-actions">
          <button className="button button-primary" type="submit" disabled={busy || !crop || !consent}>
            {isTeen ? "Suggest photo" : "Upload photo"}
          </button>
          {settings.canManage && (settings.photoUrl || settings.pendingPhotoUrl) ? (
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={(event) => ask("remove", event.currentTarget)}
            >
              Remove photo
            </button>
          ) : null}
        </div>
      </form>
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
      {/* Mounted empty so each new notice is announced. */}
      <p className="settings-help settings-notice" role="status">
        {notice ?? ""}
      </p>
      <dialog
        ref={confirm}
        className="cancel-dialog"
        aria-labelledby={`${ids}-confirm`}
        onClose={() => confirmTrigger.current?.focus()}
      >
        <h2 id={`${ids}-confirm`}>{pendingAction === "approve" ? "Approve this photo?" : "Remove this photo?"}</h2>
        <p>
          {pendingAction === "approve"
            ? "It will be shown to other members in leaderboards and class lists."
            : "Other members will see initials instead."}
        </p>
        <div className="cancel-dialog-actions">
          <button className="button button-secondary" type="button" onClick={() => confirm.current?.close()}>
            Keep as it is
          </button>
          <button className="button button-primary" type="button" onClick={confirmAction}>
            {pendingAction === "approve" ? "Approve photo" : "Remove photo"}
          </button>
        </div>
      </dialog>
    </section>
  );
}

function VisibilitySection({ studentId, settings }: Readonly<{ studentId: string; settings: MySettings }>) {
  const ids = useId();
  const [on, setOn] = useState(settings.showToMembers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function toggle(next: boolean) {
    setBusy(true);
    setError(undefined);
    setOn(next);
    try {
      await setMemberVisibility(studentId, next);
    } catch (cause) {
      setOn(!next);
      setError(errorText(cause, settingsMessages.visibilityFailed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`}>Visibility</h2>
      <label className="settings-switch">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          disabled={busy || !settings.canManage}
          aria-describedby={`${ids}-help`}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span>Show me to other members</span>
      </label>
      <p className="settings-help" id={`${ids}-help`}>
        When off, you don&apos;t appear in other members&apos; leaderboards or class lists. You still see your own position.
        {settings.canManage ? null : " Your parent or guardian can change this."}
      </p>
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function OwnAccessSection({
  profile,
  settings,
  onChanged,
}: Readonly<{ profile: AccountMemberProfile; settings: MySettings; onChanged: () => Promise<void> }>) {
  const ids = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const access = settings.teenAccess?.active ? settings.teenAccess : null;

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await createTeenAccess({ studentId: profile.studentId, email, password });
      setEmail("");
      setPassword("");
      await onChanged();
    } catch (cause) {
      setError(errorText(cause, settingsMessages.createFailed));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await revokeTeenAccess(profile.studentId);
      dialog.current?.close();
      await onChanged();
      // The Revoke button is gone now; keep keyboard focus in this section.
      heading.current?.focus();
    } catch (cause) {
      dialog.current?.close();
      setError(errorText(cause, settingsMessages.revokeFailed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} ref={heading} tabIndex={-1}>
        Own access
      </h2>
      {access ? (
        <>
          <p className="settings-help">
            {profile.fullName} signs in with <strong className="settings-email">{access.email}</strong>.
          </p>
          <div className="settings-actions">
            <button ref={trigger} className="button button-secondary" type="button" onClick={() => dialog.current?.showModal()}>
              Revoke access
            </button>
          </div>
          <dialog
            ref={dialog}
            className="cancel-dialog"
            aria-labelledby={`${ids}-dialog`}
            onClose={() => trigger.current?.focus()}
          >
            <h2 id={`${ids}-dialog`}>Revoke access?</h2>
            <p>{profile.fullName} will be signed out and won&apos;t be able to sign in with this email.</p>
            <div className="cancel-dialog-actions">
              <button className="button button-secondary" type="button" disabled={busy} onClick={() => dialog.current?.close()}>
                Keep access
              </button>
              <button className="button button-primary" type="button" disabled={busy} onClick={() => void revoke()}>
                Revoke access
              </button>
            </div>
          </dialog>
        </>
      ) : (
        <form className="settings-form" onSubmit={(event) => void create(event)}>
          <p className="settings-help">Give {profile.fullName} their own sign-in. You stay their guardian.</p>
          <div className="settings-field">
            <label htmlFor={`${ids}-email`}>Email</label>
            <input
              id={`${ids}-email`}
              type="email"
              autoComplete="off"
              required
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="settings-field">
            <label htmlFor={`${ids}-password`}>Password</label>
            <input
              id={`${ids}-password`}
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={password}
              disabled={busy}
              aria-describedby={`${ids}-password-help`}
              onChange={(event) => setPassword(event.target.value)}
            />
            <small id={`${ids}-password-help`}>At least 10 characters.</small>
          </div>
          <div className="settings-actions">
            <button className="button button-primary" type="submit" disabled={busy}>
              Create access
            </button>
          </div>
        </form>
      )}
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export default function AccountSettingsPage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate returnPath="/account/settings">
        <SettingsContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
