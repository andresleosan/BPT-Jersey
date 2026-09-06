"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { DisclaimerAudience } from "@bpt-jersey/domain/consents/disclaimers";

import {
  disclaimerAudienceLabel,
  listDisclaimers,
  publishDisclaimer,
  withdrawDisclaimer,
  type DisclaimerAdoption,
} from "../../../lib/disclaimers-client";

/**
 * T117: the office side of disclaimers.
 *
 * No wording ships with the platform: this panel is the only way text gets in, and the academy owns
 * every word of it. Publishing a new version of a key supersedes the previous one and asks every
 * participant again, which the form says out loud rather than leaving office to discover.
 *
 * Adoption is a count. Office sees how many accepted a version, never who, because a list of names
 * beside a consent question is a different and much more sensitive thing than a total.
 */
const audienceOptions: readonly { value: DisclaimerAudience; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "adult", label: "Adults" },
  { value: "minor", label: "Minors" },
];

export function DisclaimerAdminPanel() {
  const [disclaimers, setDisclaimers] = useState<readonly DisclaimerAdoption[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [key, setKey] = useState("");
  const [versionLabel, setVersionLabel] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<DisclaimerAudience>("all");
  const [required, setRequired] = useState(true);
  const [effectiveAt, setEffectiveAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      setDisclaimers(await listDisclaimers());
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const replacing = disclaimers.find(
    (entry) => entry.disclaimer.key === key.trim() && entry.disclaimer.status === "published",
  );

  async function handlePublish(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const published = await publishDisclaimer({
        key: key.trim(),
        versionLabel: versionLabel.trim(),
        title: title.trim(),
        body: body.trim(),
        audience,
        required,
        effectiveAt: new Date(`${effectiveAt}T00:00:00.000Z`).toISOString(),
      });
      setMessage(`Published ${published.key} ${published.versionLabel}.`);
      setKey("");
      setVersionLabel("");
      setTitle("");
      setBody("");
      setEffectiveAt("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to publish that disclaimer.");
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw(disclaimerId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await withdrawDisclaimer(disclaimerId);
      setMessage("Withdrawn. Nobody will be asked to accept it again.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to withdraw that disclaimer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="disclaimer-admin-title">
      <h2 id="disclaimer-admin-title">Disclaimers</h2>
      <p>
        The platform ships no disclaimer wording. Everything below was written here. Publishing a
        new version of a key supersedes the previous one and asks every participant to read it
        again.
      </p>

      {loadState === "loading" ? (
        <p role="status">Loading disclaimers…</p>
      ) : loadState === "error" ? (
        <p role="alert">Unable to load disclaimers. Please try again.</p>
      ) : disclaimers.length === 0 ? (
        <p>No disclaimer has been published.</p>
      ) : (
        <table>
          <caption>Published disclaimers</caption>
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Version</th>
              <th scope="col">Audience</th>
              <th scope="col">Status</th>
              <th scope="col">Accepted</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {disclaimers.map((entry) => (
              <tr key={entry.disclaimer.disclaimerId}>
                <td>{entry.disclaimer.key}</td>
                <td>{entry.disclaimer.versionLabel}</td>
                <td>{disclaimerAudienceLabel(entry.disclaimer.audience)}</td>
                <td>{entry.disclaimer.status}</td>
                <td>{entry.acceptedCount}</td>
                <td>
                  {entry.disclaimer.status === "published" ? (
                    <button
                      disabled={busy}
                      onClick={() => void handleWithdraw(entry.disclaimer.disclaimerId)}
                      type="button"
                    >
                      Withdraw
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={(event) => void handlePublish(event)}>
        <h3>Publish a disclaimer</h3>
        <label htmlFor="disclaimer-key">
          Disclaimer key
          <input
            id="disclaimer-key"
            onChange={(event) => setKey(event.target.value)}
            required
            value={key}
          />
        </label>
        {replacing ? (
          <p role="status">
            This replaces {replacing.disclaimer.key} {replacing.disclaimer.versionLabel}. Everyone
            who accepted it will be asked again.
          </p>
        ) : null}
        <label htmlFor="disclaimer-version">
          Disclaimer version
          <input
            id="disclaimer-version"
            onChange={(event) => setVersionLabel(event.target.value)}
            required
            value={versionLabel}
          />
        </label>
        <label htmlFor="disclaimer-title">
          Disclaimer title
          <input
            id="disclaimer-title"
            onChange={(event) => setTitle(event.target.value)}
            required
            value={title}
          />
        </label>
        <label htmlFor="disclaimer-body">
          Disclaimer text
          <textarea
            id="disclaimer-body"
            onChange={(event) => setBody(event.target.value)}
            required
            rows={8}
            value={body}
          />
        </label>
        <label htmlFor="disclaimer-audience">
          Disclaimer audience
          <select
            id="disclaimer-audience"
            onChange={(event) => setAudience(event.target.value as DisclaimerAudience)}
            value={audience}
          >
            {audienceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="disclaimer-effective">
          Disclaimer effective from
          <input
            id="disclaimer-effective"
            onChange={(event) => setEffectiveAt(event.target.value)}
            required
            type="date"
            value={effectiveAt}
          />
        </label>
        <label htmlFor="disclaimer-required">
          <input
            checked={required}
            id="disclaimer-required"
            onChange={(event) => setRequired(event.target.checked)}
            type="checkbox"
          />
          Required for every participant it applies to
        </label>
        {error ? <p role="alert">{error}</p> : null}
        {message ? <p role="status">{message}</p> : null}
        <button disabled={busy} type="submit">
          {busy ? "Publishing..." : "Publish disclaimer"}
        </button>
      </form>
    </section>
  );
}
