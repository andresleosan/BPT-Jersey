"use client";
import { useEffect, useState } from "react";
import { coachBioMaxLength, type SetCoachWebsiteProfileInput } from "@bpt-jersey/domain/staff/team-access";
import { getCoachWebsiteProfile, setCoachWebsiteProfile } from "../../../lib/team-access-client";
import { cropToSquareWebp, type CroppedAvatar } from "../../account/settings/avatar-cropper";
import { CoachCard } from "../../coach-card";

/** The landing card's photo: 3:4, cropped from the centre here and re-encoded on the server. */
const coachPhotoSize = { width: 600, height: 800 };

/** undefined = keep the saved photo, null = remove it, a crop = replace it. */
export type CoachPhotoChange = CroppedAvatar | null | undefined;

export function coachWebsiteInput(userId: string, bio: string, photo: CoachPhotoChange): SetCoachWebsiteProfileInput {
  return { userId, bio: bio.trim(), ...(photo === undefined ? {} : { photo: photo && { base64: photo.base64, mime: photo.mime } }) };
}

/** Bio, photo and a live preview at the narrowest landing width, so the owner sees the five lines. */
export function CoachCardFields({ name, beltLabel, bio, onBio, savedPhotoUrl, photo, onPhoto, disabled }: {
  name: string; beltLabel: string; bio: string; onBio: (bio: string) => void;
  savedPhotoUrl: string | null; photo: CoachPhotoChange; onPhoto: (photo: CoachPhotoChange) => void; disabled?: boolean;
}) {
  const [photoError, setPhotoError] = useState("");
  const shownPhoto = photo === undefined ? savedPhotoUrl : photo?.previewUrl ?? null;

  async function choose(file: File | undefined) {
    if (!file) return;
    setPhotoError("");
    try {
      onPhoto(await cropToSquareWebp(file, coachPhotoSize));
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "Choose a JPEG, PNG or WebP photo.");
    }
  }

  return (
    <div className="coach-card-fields">
      <div className="coach-card-fields-inputs">
        <label className="staff-field">
          <span>Photo for the website (cropped to 3:4 from the centre)</span>
          <input accept="image/jpeg,image/png,image/webp" disabled={disabled} type="file" onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        {shownPhoto ? (
          <button className="staff-secondary-button" disabled={disabled} type="button" onClick={() => onPhoto(null)}>
            Remove photo
          </button>
        ) : null}
        {photoError ? <p className="staff-message staff-message-error" role="alert">{photoError}</p> : null}
        <label className="staff-field">
          <span>Coaching experience (up to five lines on the website)</span>
          <textarea disabled={disabled} maxLength={coachBioMaxLength} rows={4} value={bio} onChange={(event) => onBio(event.target.value)} />
        </label>
        <p className="staff-hint">{bio.trim().length}/{coachBioMaxLength} characters. Shorter text is shown larger.</p>
      </div>
      <div className="coach-card-preview" aria-label="Website preview">
        <CoachCard coach={{ name: name.trim() || "Coach name", beltLabel: beltLabel || "Belt", ...(bio.trim() ? { bio: bio.trim() } : {}), ...(shownPhoto ? { photoUrl: shownPhoto } : {}) }} />
      </div>
    </div>
  );
}

/** Edits the website card of a coach (or an owner who teaches) from the Manage panel. */
export function CoachWebsiteCard({ userId, name, beltLabel, onSaved }: { userId: string; name: string; beltLabel: string; onSaved: (message: string) => void }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [bio, setBio] = useState("");
  const [savedPhotoUrl, setSavedPhotoUrl] = useState<string | null>(null);
  const [photo, setPhoto] = useState<CoachPhotoChange>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getCoachWebsiteProfile(userId)
      .then((profile) => {
        if (!active) return;
        setBio(profile.bio);
        setSavedPhotoUrl(profile.photoUrl);
        setState("ready");
      })
      .catch(() => active && setState("failed"));
    return () => {
      active = false;
    };
  }, [userId]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const saved = await setCoachWebsiteProfile(coachWebsiteInput(userId, bio, photo));
      setBio(saved.bio);
      setSavedPhotoUrl(saved.photoUrl);
      setPhoto(undefined);
      onSaved(`Website card saved for ${name}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save this website card.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <p className="staff-hint">Loading the website card…</p>;
  if (state === "failed") return <p className="staff-message staff-message-error" role="alert">Unable to load this coach&apos;s website card. Refresh and try again.</p>;
  return (
    <div className="coach-website-card">
      <CoachCardFields beltLabel={beltLabel} bio={bio} disabled={busy} name={name} onBio={setBio} onPhoto={setPhoto} photo={photo} savedPhotoUrl={savedPhotoUrl} />
      <button className="staff-primary-button" disabled={busy} type="button" onClick={() => void save()}>
        {busy ? "Saving…" : "Save website card"}
      </button>
      {error ? <p className="staff-message staff-message-error" role="alert">{error}</p> : null}
    </div>
  );
}
