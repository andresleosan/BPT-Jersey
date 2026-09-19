import type { Firestore } from "firebase-admin/firestore";
import type {
  ListSessionsQuery,
  SessionRecord,
  UpdateSessionInput,
} from "@bpt-jersey/domain/schedule";
import { shiftIsoInZone } from "@bpt-jersey/domain/schedule/classes-services";

const weekMs = 7 * 86_400_000;
const stoppedReason = "Weekly repetition stopped by the office";
export type WeeklySeries = Readonly<{
  seriesId: string;
  academyId: string;
  timezone: string;
  revisions: readonly Readonly<{ fromIndex: number; enabled: boolean; template: SessionRecord }>[];
}>;

export function newWeeklySeries(session: SessionRecord, timezone: string): WeeklySeries {
  return {
    seriesId: session.sessionId,
    academyId: session.academyId,
    timezone,
    revisions: [{ fromIndex: 0, enabled: true, template: session }],
  };
}

export function weeklyOccurrence(series: WeeklySeries, index: number): SessionRecord | null {
  const revision = [...series.revisions].reverse().find((row) => row.fromIndex <= index);
  if (!revision?.enabled) return null;
  const { template, fromIndex } = revision;
  const days = (index - fromIndex) * 7;
  return {
    ...template,
    sessionId: index === 0 ? series.seriesId : `${series.seriesId}__week_${index}`,
    startAt: shiftIsoInZone(template.startAt, days, series.timezone),
    endAt: shiftIsoInZone(template.endAt, days, series.timezone),
    weeklySeriesId: series.seriesId,
    weeklyIndex: index,
    weeklyOverride: false,
    repeatWeekly: true,
  };
}

/** Only the requested window is materialised; the rule has no end date or generation horizon. */
export function weeklyOccurrences(series: WeeklySeries, query: ListSessionsQuery): SessionRecord[] {
  const from = Date.parse(query.from),
    to = Date.parse(query.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 90 * 86_400_000) {
    throw new Error("Weekly sessions require a valid range of at most 90 days");
  }
  const rows: SessionRecord[] = [];
  for (const [position, revision] of series.revisions.entries()) {
    if (!revision.enabled) continue;
    const last = series.revisions[position + 1]?.fromIndex ?? Infinity;
    // One extra candidate on either side accounts for daylight-saving offsets.
    const firstIndex = Math.max(
      revision.fromIndex,
      revision.fromIndex + Math.floor((from - Date.parse(revision.template.startAt)) / weekMs) - 1,
    );
    const endIndex = Math.min(
      last - 1,
      revision.fromIndex + Math.ceil((to - Date.parse(revision.template.startAt)) / weekMs) + 1,
    );
    for (let index = firstIndex; index <= endIndex; index += 1) {
      const session = weeklyOccurrence(series, index);
      if (session && Date.parse(session.startAt) >= from && Date.parse(session.startAt) <= to)
        rows.push(session);
    }
  }
  return rows;
}

/** Keeps prior revisions, stable occurrence IDs, and individual cancellations. */
export function reviseWeeklySeries(
  series: WeeklySeries,
  current: SessionRecord,
  updated: SessionRecord,
  enabled: boolean,
): WeeklySeries {
  const fromIndex = current.weeklyIndex ?? 0;
  return {
    ...series,
    revisions: [
      ...series.revisions.filter((row) => row.fromIndex < fromIndex),
      {
        fromIndex,
        enabled,
        template: { ...updated, weeklyOverride: false, repeatWeekly: enabled },
      },
    ],
  };
}

export function reviseWeeklySession(
  series: WeeklySeries,
  session: SessionRecord,
  selectedId: string,
  updated: SessionRecord,
): SessionRecord {
  const index = session.weeklyIndex ?? 0;
  if (session.sessionId === selectedId)
    return { ...updated, repeatWeekly: series.revisions.at(-1)!.enabled, weeklyOverride: false };
  if (session.status !== "scheduled" || index < series.revisions.at(-1)!.fromIndex) return session;
  const next = weeklyOccurrence(series, index);
  // Stopping includes individually edited dates; modifying a series preserves those exceptions.
  if (!next)
    return {
      ...session,
      repeatWeekly: false,
      status: "cancelled",
      cancellationReason: stoppedReason,
      updatedAt: updated.updatedAt,
      updatedBy: updated.updatedBy,
    };
  if (session.weeklyOverride) return session;
  return {
    ...next,
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    createdBy: session.createdBy,
    updatedAt: updated.updatedAt,
    updatedBy: updated.updatedBy,
  };
}

type MergeUpdate = (
  current: SessionRecord,
  input: UpdateSessionInput,
  actor: string,
  now: string,
) => SessionRecord;

export function createWeeklySessionStore(firestore: Firestore) {
  const seriesCollection = (academy: string) =>
    firestore.collection(`academies/${academy}/sessionSeries`);
  const sessionsCollection = (academy: string) =>
    firestore.collection(`academies/${academy}/sessions`);
  return {
    async create(session: SessionRecord, timezone: string): Promise<SessionRecord> {
      const series = newWeeklySeries(session, timezone);
      const first = weeklyOccurrence(series, 0)!;
      const batch = firestore.batch();
      batch.create(seriesCollection(session.academyId).doc(series.seriesId), series);
      batch.create(sessionsCollection(session.academyId).doc(session.sessionId), first);
      await batch.commit();
      return first;
    },
    async update(
      academy: string,
      input: UpdateSessionInput,
      actor: string,
      timezone: string,
      merge: MergeUpdate,
    ): Promise<SessionRecord> {
      const sessionRef = sessionsCollection(academy).doc(input.sessionId);
      return firestore.runTransaction(async (tx) => {
        const snapshot = await tx.get(sessionRef);
        if (!snapshot.exists) throw new Error("Session does not exist");
        const current = snapshot.data() as SessionRecord;
        if (current.status !== "scheduled")
          throw new Error("Only scheduled sessions can be edited");
        const updated = merge(current, input, actor, new Date().toISOString());
        if (!current.weeklySeriesId) {
          if (!input.repeatWeekly) {
            tx.set(sessionRef, updated);
            return updated;
          }
          const series = newWeeklySeries(updated, timezone);
          const first = weeklyOccurrence(series, 0)!;
          tx.create(seriesCollection(academy).doc(series.seriesId), series);
          tx.set(sessionRef, first);
          return first;
        }
        const seriesRef = seriesCollection(academy).doc(current.weeklySeriesId);
        const seriesSnapshot = await tx.get(seriesRef);
        if (!seriesSnapshot.exists) throw new Error("Weekly series does not exist");
        const series = seriesSnapshot.data() as WeeklySeries;
        if (input.repeatScope !== "following") {
          if (input.repeatWeekly !== undefined && input.repeatWeekly !== current.repeatWeekly)
            throw new Error("Choose this and following sessions to change weekly repetition");
          const single = { ...updated, weeklyOverride: true };
          tx.set(sessionRef, single);
          return single;
        }
        // One atomic update protects reservations from concurrent materialisation and edits.
        const existing = await tx.get(
          sessionsCollection(academy).where("weeklySeriesId", "==", series.seriesId),
        );
        const future = existing.docs
          .map((doc) => doc.data() as SessionRecord)
          .filter((row) => (row.weeklyIndex ?? 0) >= (current.weeklyIndex ?? 0));
        if (future.length > 400)
          throw new Error("Too many saved occurrences to edit together; contact the office");
        const next = reviseWeeklySeries(
          series,
          current,
          updated,
          input.repeatWeekly ?? current.repeatWeekly ?? true,
        );
        tx.set(seriesRef, next);
        for (const row of future) {
          const changed = reviseWeeklySession(next, row, current.sessionId, updated);
          if (changed !== row) tx.set(sessionsCollection(academy).doc(row.sessionId), changed);
        }
        return reviseWeeklySession(next, current, current.sessionId, updated);
      });
    },
    async materialise(
      academy: string,
      query: ListSessionsQuery,
      onSeriesError?: (error: unknown) => void,
    ): Promise<void> {
      const occurrences = (series: WeeklySeries) => {
        try {
          return weeklyOccurrences(series, query);
        } catch {
          // Only pure occurrence calculation is bad data; SDK/transaction errors keep their code.
          throw Object.assign(new Error("Invalid weekly series"), { code: "malformed-series" });
        }
      };
      const series = await seriesCollection(academy).get();
      for (const document of series.docs) {
        try {
          const initial = document.data() as WeeklySeries;
          if (occurrences(initial).length === 0) continue;
          await firestore.runTransaction(async (tx) => {
            // Re-read inside the transaction: a concurrent series edit must invalidate this plan.
            const snapshot = await tx.get(document.ref);
            if (!snapshot.exists) return;
            const current = snapshot.data() as WeeklySeries;
            const candidates = occurrences(current);
            if (candidates.length === 0) return;
            const refs = candidates.map((row) => sessionsCollection(academy).doc(row.sessionId));
            const existing = await tx.getAll(...refs);
            for (const [index, row] of candidates.entries()) {
              if (!existing[index]!.exists) tx.create(refs[index]!, row);
            }
          });
        } catch (error) {
          if (!onSeriesError) throw error;
          onSeriesError(error);
        }
      }
    },
  };
}
