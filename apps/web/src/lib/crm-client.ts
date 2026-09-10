import { httpsCallable } from "firebase/functions";

import {
  parseLeadRecord,
  parseLeadTimelineEvent,
  type LeadRecord,
  type LeadStatus,
  type LeadTimelineEvent,
} from "@bpt-jersey/domain/crm";
import { getFirebaseFunctions } from "./firebase-client";

const safeListError = "Unable to load CRM leads. Please try again.";
const safeUpdateError = "Unable to update CRM lead. Please try again.";
const safeTransitionError = "Unable to transition CRM lead. Please try again.";
const safeTimelineError = "Unable to load CRM timeline. Please try again.";

type LeadFilter = Readonly<{ status?: LeadStatus; ownerId?: string }>;

function parseRecords(value: unknown): readonly LeadRecord[] {
  if (!Array.isArray(value)) throw new Error(safeListError);
  const records = value.map((item) => parseLeadRecord(item));
  if (records.some((result) => !result.ok)) throw new Error(safeListError);
  return records.map((result) => (result as { ok: true; value: LeadRecord }).value);
}

export async function listCrmLeads(filter: LeadFilter = {}): Promise<readonly LeadRecord[]> {
  const callable = httpsCallable<LeadFilter, { leads: unknown }>(
    getFirebaseFunctions(),
    "listCrmLeads",
  );
  try {
    const response = await callable(filter);
    return parseRecords(response.data.leads);
  } catch {
    throw new Error(safeListError);
  }
}

export async function updateCrmLead(input: {
  leadId: string;
  ownerId?: string;
  nextActionAt?: string | null;
}): Promise<LeadRecord> {
  const callable = httpsCallable<typeof input, { lead: unknown }>(
    getFirebaseFunctions(),
    "updateCrmLead",
  );
  try {
    const response = await callable(input);
    const parsed = parseLeadRecord(response.data.lead);
    if (!parsed.ok) throw new Error(safeUpdateError);
    return parsed.value;
  } catch {
    throw new Error(safeUpdateError);
  }
}

export async function transitionCrmLead(input: {
  leadId: string;
  targetStatus: LeadStatus;
}): Promise<LeadRecord> {
  const callable = httpsCallable<typeof input, { lead: unknown }>(
    getFirebaseFunctions(),
    "transitionCrmLead",
  );
  try {
    const response = await callable(input);
    const parsed = parseLeadRecord(response.data.lead);
    if (!parsed.ok) throw new Error(safeTransitionError);
    return parsed.value;
  } catch {
    throw new Error(safeTransitionError);
  }
}

export async function listCrmLeadTimeline(leadId: string): Promise<readonly LeadTimelineEvent[]> {
  const callable = httpsCallable<{ leadId: string }, { events: readonly LeadTimelineEvent[] }>(
    getFirebaseFunctions(),
    "listCrmLeadTimeline",
  );
  try {
    const response = await callable({ leadId });
    if (!Array.isArray(response.data.events)) throw new Error(safeTimelineError);
    const parsed = response.data.events.map((event) => parseLeadTimelineEvent(event));
    if (parsed.some((result) => !result.ok)) throw new Error(safeTimelineError);
    return parsed.map((result) => (result as { ok: true; value: LeadTimelineEvent }).value);
  } catch {
    throw new Error(safeTimelineError);
  }
}
