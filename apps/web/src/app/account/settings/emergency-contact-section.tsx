"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { z } from "zod";

import type { EmergencyContact } from "@bpt-jersey/domain/members/directory";

import {
  getOwnEmergencyContact,
  saveOwnEmergencyContact,
} from "../../../lib/account-settings-client";
import {
  accountFailed,
  fieldErrors,
  SettingsField,
  StatusBand,
  type SectionStatus,
} from "./email-section";
import { phoneFormatMessage, phonePattern, phoneSchema } from "./phone-section";

export type ContactStudent = Readonly<{ studentId: string; label: string }>;

type Form = Readonly<{
  fullName: string;
  relationship: string;
  phoneNumber: string;
  alternatePhoneNumber: string;
}>;
type FormErrors = Partial<Record<keyof Form, string>>;

const emptyForm: Form = {
  fullName: "",
  relationship: "",
  phoneNumber: "",
  alternatePhoneNumber: "",
};
const loadFailed = "We couldn't load the emergency contact. Try again.";

function formFrom(contact: EmergencyContact | null): Form {
  return contact
    ? {
        fullName: contact.fullName,
        relationship: contact.relationship,
        phoneNumber: contact.phoneNumber,
        alternatePhoneNumber: contact.alternatePhoneNumber ?? "",
      }
    : emptyForm;
}

const contactFormSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Enter the contact's name.")
    .max(160, "Keep the name to 160 characters or fewer."),
  relationship: z
    .string()
    .trim()
    .min(1, "Enter how they are related to the member.")
    .max(64, "Keep the relationship to 64 characters or fewer."),
  phoneNumber: phoneSchema,
  alternatePhoneNumber: z
    .string()
    .trim()
    .refine((value) => value === "" || phonePattern.test(value), phoneFormatMessage),
});

export function EmergencyContactSection({
  students,
}: Readonly<{ students: readonly ContactStudent[] }>) {
  const ids = useId();
  const [selected, setSelected] = useState(students[0]?.studentId ?? "");
  const [form, setForm] = useState<Form>();
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<SectionStatus>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setForm(undefined);
    setErrors({});
    setStatus(undefined);
    getOwnEmergencyContact(selected)
      .then((contact) => {
        if (active) setForm(formFrom(contact));
      })
      .catch(() => {
        if (!active) return;
        setForm(emptyForm);
        setStatus({ kind: "error", message: loadFailed });
      });
    return () => {
      active = false;
    };
  }, [selected]);

  const update = (key: keyof Form, value: string) =>
    setForm((current) => ({ ...(current ?? emptyForm), [key]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !form) return;
    const parsed = contactFormSchema.safeParse(form);
    setErrors(parsed.success ? {} : fieldErrors<keyof Form>(parsed.error));
    setStatus(undefined);
    if (!parsed.success) return;
    const { alternatePhoneNumber, ...required } = parsed.data;
    const contact: EmergencyContact = {
      ...required,
      ...(alternatePhoneNumber ? { alternatePhoneNumber } : {}),
    };
    setSaving(true);
    const result = await saveOwnEmergencyContact(selected, contact).catch(() => ({
      ok: false as const,
      message: accountFailed,
    }));
    setSaving(false);
    if (result.ok) {
      setForm(formFrom(contact));
      setStatus({ kind: "success", message: "Emergency contact saved." });
    } else {
      setStatus({ kind: "error", message: result.message });
    }
  }

  if (students.length === 0) return null;
  return (
    <section className="settings-section" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`}>Emergency contact</h2>
      <p className="settings-help">Who the academy calls if something happens during a class.</p>
      {students.length > 1 ? (
        <div className="settings-field">
          <label htmlFor={`${ids}-member`}>Member</label>
          <select
            id={`${ids}-member`}
            value={selected}
            disabled={saving}
            onChange={(event) => setSelected(event.target.value)}
          >
            {students.map((student) => (
              <option key={student.studentId} value={student.studentId}>
                {student.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {form === undefined ? (
        <div aria-busy="true" role="status">
          <span className="visually-hidden">Loading the emergency contact</span>
          <div className="skeleton-card settings-skeleton-input" />
          <div className="skeleton-card settings-skeleton-input" />
        </div>
      ) : (
        <form className="settings-form" noValidate onSubmit={(event) => void submit(event)}>
          <SettingsField
            id={`${ids}-name`}
            label="Name"
            autoComplete="off"
            value={form.fullName}
            disabled={saving}
            error={errors.fullName}
            onChange={(event) => update("fullName", event.target.value)}
          />
          <SettingsField
            id={`${ids}-relationship`}
            label="Relationship"
            autoComplete="off"
            value={form.relationship}
            disabled={saving}
            error={errors.relationship}
            onChange={(event) => update("relationship", event.target.value)}
          />
          <SettingsField
            id={`${ids}-phone`}
            label="Phone number"
            type="tel"
            autoComplete="off"
            value={form.phoneNumber}
            disabled={saving}
            error={errors.phoneNumber}
            onChange={(event) => update("phoneNumber", event.target.value)}
          />
          <SettingsField
            id={`${ids}-alternate`}
            label="Other phone number (optional)"
            type="tel"
            autoComplete="off"
            value={form.alternatePhoneNumber}
            disabled={saving}
            error={errors.alternatePhoneNumber}
            onChange={(event) => update("alternatePhoneNumber", event.target.value)}
          />
          <div className="settings-actions">
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save emergency contact"}
            </button>
          </div>
        </form>
      )}
      <StatusBand status={status} />
    </section>
  );
}
