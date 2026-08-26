import {
  canTransitionLead,
  parseLeadRecord,
  parseLeadTimelineEvent,
  type LeadDraft,
  type LeadRecord,
  type LeadStatus,
  type LeadTimelineEvent,
} from "@bpt-jersey/domain/crm";

export class CrmStoreError extends Error {
  public readonly code: "invalid" | "tenant" | "not-found" | "conflict";

  public constructor(code: "invalid" | "tenant" | "not-found" | "conflict", message: string) {
    super(message);
    this.name = "CrmStoreError";
    this.code = code;
  }
}

export type LeadListFilter = Readonly<{
  status?: LeadStatus;
  ownerId?: string;
}>;

export type LeadMutationResult = Readonly<{
  lead: LeadRecord;
  event: LeadTimelineEvent;
}>;

export type CrmStore = Readonly<{
  createLead: (params: {
    academyId: string;
    input: LeadDraft;
    createdBy: string;
    now?: string;
  }) => Promise<LeadMutationResult>;
  getLead: (academyId: string, leadId: string) => Promise<LeadRecord | null>;
  listLeads: (academyId: string, filter?: LeadListFilter) => Promise<readonly LeadRecord[]>;
  updateLead: (params: {
    academyId: string;
    leadId: string;
    ownerId?: string;
    nextActionAt?: string | null;
    updatedBy: string;
    now?: string;
  }) => Promise<LeadMutationResult>;
  transitionLead: (params: {
    academyId: string;
    leadId: string;
    targetStatus: LeadStatus;
    updatedBy: string;
    now?: string;
  }) => Promise<LeadMutationResult>;
  listTimeline: (academyId: string, leadId: string) => Promise<readonly LeadTimelineEvent[]>;
}>;

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;

function assertIdentifier(value: string, field: string): void {
  if (!safeIdentifierPattern.test(value)) {
    throw new CrmStoreError("invalid", `Invalid ${field}`);
  }
}

function assertDateTime(value: string, field: string): void {
  if (!dateTimePattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new CrmStoreError("invalid", `Invalid ${field}`);
  }
}

function makeId(prefix: string, now: string): string {
  const suffix = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${now.replace(/[^0-9]/gu, "").slice(-14)}-${suffix}`;
}

function buildEvent(params: {
  academyId: string;
  leadId: string;
  kind: LeadTimelineEvent["kind"];
  actorId: string;
  occurredAt: string;
  summary: string;
  discriminator: string;
}): LeadTimelineEvent {
  const eventKey = `${params.kind}:${params.leadId}:${params.discriminator}`;
  const candidate = {
    eventId: `evt-${eventKey}`,
    academyId: params.academyId,
    leadId: params.leadId,
    eventKey,
    kind: params.kind,
    actorId: params.actorId,
    occurredAt: params.occurredAt,
    summary: params.summary,
  };
  const parsed = parseLeadTimelineEvent(candidate);
  if (!parsed.ok) throw new CrmStoreError("invalid", "Generated CRM timeline event is invalid");
  return parsed.value;
}

function assertRecordScope(record: LeadRecord, academyId: string, leadId: string): void {
  if (record.academyId !== academyId) throw new CrmStoreError("tenant", "Lead tenant mismatch");
  if (record.leadId !== leadId) throw new CrmStoreError("conflict", "Lead identity mismatch");
}

function applyMutation(params: {
  record: LeadRecord;
  event: LeadTimelineEvent;
  now: string;
  updatedBy: string;
  patch?: Partial<LeadRecord>;
}): LeadMutationResult {
  const next: LeadRecord = Object.freeze({
    ...params.record,
    ...params.patch,
    updatedAt: params.now,
    updatedBy: params.updatedBy,
  });
  const parsed = parseLeadRecord(next);
  if (!parsed.ok) throw new CrmStoreError("invalid", "CRM lead mutation is invalid");
  return Object.freeze({ lead: parsed.value, event: params.event });
}

export type GenericCrmFirestore = Readonly<{
  doc: (path: string) => {
    get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
    set: (data: Record<string, unknown>, options?: unknown) => Promise<unknown>;
  };
  collection: (path: string) => {
    get: () => Promise<{
      docs: readonly { id: string; data: () => Record<string, unknown> }[];
    }>;
  };
  batch: () => {
    set: (ref: unknown, data: unknown, options?: unknown) => void;
    commit: () => Promise<unknown>;
  };
}>;

function createStoreCore(): {
  leads: Map<string, LeadRecord>;
  events: Map<string, LeadTimelineEvent>;
} {
  return { leads: new Map(), events: new Map() };
}

function leadKey(academyId: string, leadId: string): string {
  return `${academyId}/${leadId}`;
}

function eventKey(academyId: string, leadId: string, key: string): string {
  return `${academyId}/${leadId}/${key}`;
}

function createMemoryStore(): CrmStore {
  const state = createStoreCore();
  return {
    async createLead({ academyId, input, createdBy, now = new Date().toISOString() }) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(createdBy, "createdBy");
      assertDateTime(now, "now");
      const leadId = makeId("lead", now);
      const parsed = parseLeadRecord({
        ...input,
        leadId,
        schemaVersion: "1",
        createdAt: now,
        createdBy,
        updatedAt: now,
        updatedBy: createdBy,
      });
      if (!parsed.ok) throw new CrmStoreError("invalid", "CRM lead input is invalid");
      const event = buildEvent({
        academyId,
        leadId,
        kind: "lead_created",
        actorId: createdBy,
        occurredAt: now,
        summary: "Lead created (synthetic-safe)",
        discriminator: now,
      });
      state.leads.set(leadKey(academyId, leadId), parsed.value);
      state.events.set(eventKey(academyId, leadId, event.eventKey), event);
      return Object.freeze({ lead: parsed.value, event });
    },
    async getLead(academyId, leadId) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(leadId, "leadId");
      return state.leads.get(leadKey(academyId, leadId)) ?? null;
    },
    async listLeads(academyId, filter = {}) {
      assertIdentifier(academyId, "academyId");
      if (filter.ownerId !== undefined) assertIdentifier(filter.ownerId, "ownerId");
      return Object.freeze(
        [...state.leads.values()]
          .filter(
            (lead) =>
              lead.academyId === academyId &&
              (filter.status === undefined || lead.status === filter.status) &&
              (filter.ownerId === undefined || lead.ownerId === filter.ownerId),
          )
          .sort((left, right) =>
            (left.nextActionAt ?? "9999").localeCompare(right.nextActionAt ?? "9999"),
          ),
      );
    },
    async updateLead({
      academyId,
      leadId,
      ownerId,
      nextActionAt,
      updatedBy,
      now = new Date().toISOString(),
    }) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(leadId, "leadId");
      assertIdentifier(updatedBy, "updatedBy");
      assertDateTime(now, "now");
      if (ownerId !== undefined) assertIdentifier(ownerId, "ownerId");
      if (nextActionAt !== undefined && nextActionAt !== null)
        assertDateTime(nextActionAt, "nextActionAt");
      const existing = await this.getLead(academyId, leadId);
      if (existing === null) throw new CrmStoreError("not-found", "Lead not found");
      const nextOwner = ownerId ?? existing.ownerId;
      const nextAction = nextActionAt === undefined ? existing.nextActionAt : nextActionAt;
      const event = buildEvent({
        academyId,
        leadId,
        kind:
          ownerId !== undefined && ownerId !== existing.ownerId
            ? "owner_assigned"
            : "next_action_set",
        actorId: updatedBy,
        occurredAt: now,
        summary: "CRM follow-up updated (synthetic-safe)",
        discriminator: now,
      });
      const result = applyMutation({
        record: existing,
        event,
        now,
        updatedBy,
        patch: { ownerId: nextOwner, nextActionAt: nextAction },
      });
      state.leads.set(leadKey(academyId, leadId), result.lead);
      state.events.set(eventKey(academyId, leadId, event.eventKey), event);
      return result;
    },
    async transitionLead({
      academyId,
      leadId,
      targetStatus,
      updatedBy,
      now = new Date().toISOString(),
    }) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(leadId, "leadId");
      assertIdentifier(updatedBy, "updatedBy");
      assertDateTime(now, "now");
      const existing = await this.getLead(academyId, leadId);
      if (existing === null) throw new CrmStoreError("not-found", "Lead not found");
      if (!canTransitionLead(existing.status, targetStatus)) {
        throw new CrmStoreError("conflict", "Lead transition is not allowed");
      }
      const event = buildEvent({
        academyId,
        leadId,
        kind: "status_changed",
        actorId: updatedBy,
        occurredAt: now,
        summary: `Lead status changed to ${targetStatus}`,
        discriminator: `${existing.status}:${targetStatus}:${now}`,
      });
      const result = applyMutation({
        record: existing,
        event,
        now,
        updatedBy,
        patch: { status: targetStatus },
      });
      state.leads.set(leadKey(academyId, leadId), result.lead);
      state.events.set(eventKey(academyId, leadId, event.eventKey), event);
      return result;
    },
    async listTimeline(academyId, leadId) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(leadId, "leadId");
      const lead = await this.getLead(academyId, leadId);
      if (lead === null) throw new CrmStoreError("not-found", "Lead not found");
      return Object.freeze(
        [...state.events.values()]
          .filter((event) => event.academyId === academyId && event.leadId === leadId)
          .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
      );
    },
  };
}

export function createInMemoryCrmStore(): CrmStore {
  return createMemoryStore();
}

export function createFirestoreCrmStore({
  firestore,
}: {
  firestore: GenericCrmFirestore;
}): CrmStore {
  return {
    async createLead({ academyId, input, createdBy, now = new Date().toISOString() }) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(createdBy, "createdBy");
      assertDateTime(now, "now");
      const leadId = makeId("lead", now);
      const parsed = parseLeadRecord({
        ...input,
        leadId,
        schemaVersion: "1",
        createdAt: now,
        createdBy,
        updatedAt: now,
        updatedBy: createdBy,
      });
      if (!parsed.ok) throw new CrmStoreError("invalid", "CRM lead input is invalid");
      const event = buildEvent({
        academyId,
        leadId,
        kind: "lead_created",
        actorId: createdBy,
        occurredAt: now,
        summary: "Lead created (synthetic-safe)",
        discriminator: now,
      });
      const batch = firestore.batch();
      batch.set(firestore.doc(`academies/${academyId}/leads/${leadId}`), parsed.value);
      batch.set(firestore.doc(`academies/${academyId}/leadTimeline/${event.eventId}`), event);
      await batch.commit();
      return Object.freeze({ lead: parsed.value, event });
    },
    async getLead(academyId, leadId) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(leadId, "leadId");
      const snapshot = await firestore.doc(`academies/${academyId}/leads/${leadId}`).get();
      if (!snapshot.exists) return null;
      const parsed = parseLeadRecord(snapshot.data());
      if (!parsed.ok) throw new CrmStoreError("invalid", "Stored CRM lead is invalid");
      assertRecordScope(parsed.value, academyId, leadId);
      return parsed.value;
    },
    async listLeads(academyId, filter = {}) {
      assertIdentifier(academyId, "academyId");
      if (filter.ownerId !== undefined) assertIdentifier(filter.ownerId, "ownerId");
      const snapshot = await firestore.collection(`academies/${academyId}/leads`).get();
      return Object.freeze(
        snapshot.docs
          .map((document) => {
            const parsed = parseLeadRecord(document.data());
            if (!parsed.ok) throw new CrmStoreError("invalid", "Stored CRM lead is invalid");
            assertRecordScope(parsed.value, academyId, document.id);
            return parsed.value;
          })
          .filter(
            (lead) =>
              (filter.status === undefined || lead.status === filter.status) &&
              (filter.ownerId === undefined || lead.ownerId === filter.ownerId),
          )
          .sort((left, right) =>
            (left.nextActionAt ?? "9999").localeCompare(right.nextActionAt ?? "9999"),
          ),
      );
    },
    async updateLead(params) {
      assertIdentifier(params.academyId, "academyId");
      assertIdentifier(params.leadId, "leadId");
      assertIdentifier(params.updatedBy, "updatedBy");
      const existing = await this.getLead(params.academyId, params.leadId);
      if (existing === null) throw new CrmStoreError("not-found", "Lead not found");
      const now = params.now ?? new Date().toISOString();
      assertDateTime(now, "now");
      if (params.ownerId !== undefined) assertIdentifier(params.ownerId, "ownerId");
      if (params.nextActionAt !== undefined && params.nextActionAt !== null)
        assertDateTime(params.nextActionAt, "nextActionAt");
      const event = buildEvent({
        academyId: params.academyId,
        leadId: params.leadId,
        kind:
          params.ownerId !== undefined && params.ownerId !== existing.ownerId
            ? "owner_assigned"
            : "next_action_set",
        actorId: params.updatedBy,
        occurredAt: now,
        summary: "CRM follow-up updated (synthetic-safe)",
        discriminator: now,
      });
      const result = applyMutation({
        record: existing,
        event,
        now,
        updatedBy: params.updatedBy,
        patch: {
          ownerId: params.ownerId ?? existing.ownerId,
          nextActionAt:
            params.nextActionAt === undefined ? existing.nextActionAt : params.nextActionAt,
        },
      });
      const batch = firestore.batch();
      batch.set(firestore.doc(`academies/${params.academyId}/leads/${params.leadId}`), result.lead);
      batch.set(
        firestore.doc(`academies/${params.academyId}/leadTimeline/${event.eventId}`),
        event,
      );
      await batch.commit();
      return result;
    },
    async transitionLead(params) {
      assertIdentifier(params.academyId, "academyId");
      assertIdentifier(params.leadId, "leadId");
      assertIdentifier(params.updatedBy, "updatedBy");
      const existing = await this.getLead(params.academyId, params.leadId);
      if (existing === null) throw new CrmStoreError("not-found", "Lead not found");
      if (!canTransitionLead(existing.status, params.targetStatus)) {
        throw new CrmStoreError("conflict", "Lead transition is not allowed");
      }
      const now = params.now ?? new Date().toISOString();
      assertDateTime(now, "now");
      const event = buildEvent({
        academyId: params.academyId,
        leadId: params.leadId,
        kind: "status_changed",
        actorId: params.updatedBy,
        occurredAt: now,
        summary: `Lead status changed to ${params.targetStatus}`,
        discriminator: `${existing.status}:${params.targetStatus}:${now}`,
      });
      const result = applyMutation({
        record: existing,
        event,
        now,
        updatedBy: params.updatedBy,
        patch: { status: params.targetStatus },
      });
      const batch = firestore.batch();
      batch.set(firestore.doc(`academies/${params.academyId}/leads/${params.leadId}`), result.lead);
      batch.set(
        firestore.doc(`academies/${params.academyId}/leadTimeline/${event.eventId}`),
        event,
      );
      await batch.commit();
      return result;
    },
    async listTimeline(academyId, leadId) {
      const lead = await this.getLead(academyId, leadId);
      if (lead === null) throw new CrmStoreError("not-found", "Lead not found");
      const snapshot = await firestore.collection(`academies/${academyId}/leadTimeline`).get();
      return Object.freeze(
        snapshot.docs
          .map((document) => {
            const parsed = parseLeadTimelineEvent(document.data());
            if (!parsed.ok)
              throw new CrmStoreError("invalid", "Stored CRM timeline event is invalid");
            return parsed.value;
          })
          .filter((event) => event.academyId === academyId && event.leadId === leadId)
          .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
      );
    },
  };
}
