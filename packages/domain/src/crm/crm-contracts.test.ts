import { describe, expect, it } from "vitest";

import {
  appendLeadTimelineEvent,
  canTransitionLead,
  leadStatuses,
  leadTransitionTargets,
  parseLeadDraft,
  parseLeadRecord,
  parseLeadTimelineEvent,
  type LeadRecord,
  type LeadTimelineEvent,
} from "./crm-contracts";

const validDraft = {
  academyId: "academy-1",
  contactReference: "lead-morgan-f",
  source: "website-f",
  ownerId: "reception-f",
  status: "trial_booked",
  nextActionAt: "2026-08-26T10:00:00Z",
  consentState: "unknown",
} as const;

function record(overrides: Partial<LeadRecord> = {}): LeadRecord {
  return {
    ...validDraft,
    leadId: "lead-1",
    schemaVersion: "1",
    createdAt: "2026-08-25T10:00:00Z",
    createdBy: "user-1",
    updatedAt: "2026-08-25T10:00:00Z",
    updatedBy: "user-1",
    ...overrides,
  };
}

function event(overrides: Partial<LeadTimelineEvent> = {}): LeadTimelineEvent {
  return {
    eventId: "event-1",
    academyId: "academy-1",
    leadId: "lead-1",
    eventKey: "status_changed:lead-1:trial_booked",
    kind: "status_changed",
    actorId: "user-1",
    occurredAt: "2026-08-25T10:00:00Z",
    summary: "Trial booked (synthetic)",
    ...overrides,
  };
}

describe("CRM lead contracts", () => {
  it("publishes the closed pipeline and transition table", () => {
    expect(leadStatuses).toEqual([
      "new_enquiry",
      "trial_booked",
      "trial_attended",
      "follow_up",
      "won",
      "lost",
    ]);
    expect(leadTransitionTargets).toEqual({
      new_enquiry: ["trial_booked", "lost"],
      trial_booked: ["trial_attended", "lost"],
      trial_attended: ["follow_up"],
      follow_up: ["won", "lost"],
      won: [],
      lost: [],
    });
    expect(Object.isFrozen(leadStatuses)).toBe(true);
    expect(Object.isFrozen(leadTransitionTargets)).toBe(true);
  });

  it("allows only explicit transitions and same-state updates", () => {
    expect(canTransitionLead("new_enquiry", "trial_booked")).toBe(true);
    expect(canTransitionLead("trial_booked", "trial_attended")).toBe(true);
    expect(canTransitionLead("follow_up", "won")).toBe(true);
    expect(canTransitionLead("won", "follow_up")).toBe(false);
    expect(canTransitionLead("lost", "new_enquiry")).toBe(false);
    expect(canTransitionLead("follow_up", "follow_up")).toBe(true);
  });

  it("parses exact drafts and records", () => {
    const draft = parseLeadDraft(validDraft);
    expect(draft).toEqual({ ok: true, value: validDraft });
    if (draft.ok) expect(Object.isFrozen(draft.value)).toBe(true);

    const parsedRecord = parseLeadRecord(record());
    expect(parsedRecord).toEqual({ ok: true, value: record() });
    if (parsedRecord.ok) expect(Object.isFrozen(parsedRecord.value)).toBe(true);
  });

  it("rejects unsafe or incomplete lead values", () => {
    expect(parseLeadDraft({ ...validDraft, extra: true }).ok).toBe(false);
    expect(parseLeadDraft({ ...validDraft, status: "unknown" }).ok).toBe(false);
    expect(parseLeadDraft({ ...validDraft, status: "follow_up", nextActionAt: null }).ok).toBe(
      false,
    );
    expect(parseLeadDraft({ ...validDraft, contactReference: "someone@example.com" }).ok).toBe(
      false,
    );
    expect(parseLeadRecord({ ...record(), schemaVersion: "2" }).ok).toBe(false);
  });

  it("parses timeline events and rejects PII-shaped or oversized summaries", () => {
    expect(parseLeadTimelineEvent(event()).ok).toBe(true);
    expect(parseLeadTimelineEvent({ ...event(), summary: "x".repeat(161) }).ok).toBe(false);
    expect(parseLeadTimelineEvent({ ...event(), eventKey: "lead/one" }).ok).toBe(false);
  });

  it("keeps timeline append idempotent and fails on conflicting duplicates", () => {
    const first = event();
    const added = appendLeadTimelineEvent([], first);
    expect(added).toEqual({ ok: true, value: [first] });
    if (!added.ok) return;

    const replay = appendLeadTimelineEvent(added.value, first);
    expect(replay).toEqual({ ok: true, value: [first] });

    const conflict = appendLeadTimelineEvent(
      added.value,
      event({ summary: "Different synthetic event" }),
    );
    expect(conflict).toEqual({
      ok: false,
      error: [{ path: ["eventKey"], code: "conflicting_duplicate_event" }],
    });
  });
});
