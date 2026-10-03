import { warn as logWarn } from "firebase-functions/logger";
import {
  assessGraduation,
  type GraduationAssessment,
  type GraduationBoard,
  type GraduationBoardRow,
  type GraduationNotices,
  type GraduationReview,
} from "@bpt-jersey/domain/graduations";
import type { LevelCatalogProjection, LevelDefinitionRecord } from "@bpt-jersey/domain/levels";
import type { SessionRecord } from "@bpt-jersey/domain/schedule";

import { isoInstant, type GraduationFirestore, type Head } from "./graduation-firestore.js";

type Catalog = LevelCatalogProjection;
const celebrationWindowMs = 30 * 86_400_000;
// Response schemas cap names and titles; one long migrated value must not reject the whole reply.
const clamp = (value: string, max: number) => value.slice(0, max);
const clampLikely = (likely: GraduationAssessment["likelyNext"]) =>
  likely === null ? null : { ...likely, title: clamp(likely.title, 160) };
const chip = (d: LevelDefinitionRecord) => ({ definitionKey: d.definitionKey, name: d.name });

function levels(catalog: Catalog, head: Head) {
  const current = catalog.definitions.find((d) => d.definitionKey === head.currentDefinitionKey);
  if (!current || catalog.system.systemId !== head.systemId) return null;
  const target = catalog.definitions.find((d) => d.sequence === current.sequence + 1) ?? null;
  return { current, target };
}

type AssessContext = Readonly<{
  sessions: SessionRecord[];
  booked: Map<string, Set<string>>;
  reviews: Map<string, GraduationReview[]>;
  now: string;
}>;

export async function assessStudent(
  store: GraduationFirestore,
  catalog: Catalog,
  head: Head,
  context: AssessContext,
): Promise<{
  assessment: GraduationAssessment;
  current: LevelDefinitionRecord;
  target: LevelDefinitionRecord | null;
} | null> {
  const pair = levels(catalog, head);
  if (pair === null) return null;
  const assessment = assessGraduation({
    target: pair.target,
    currentLevelStartedAt: head.currentLevelStartedAt,
    importedBaseline: head.importedBaseline,
    counted: await store.counted(head.studentId),
    sessions: context.sessions,
    bookedSessionIds: context.booked.get(head.studentId) ?? new Set(),
    reviews: context.reviews.get(head.studentId) ?? [],
    now: context.now,
  });
  return { assessment, ...pair };
}

async function context(store: GraduationFirestore, now: string, studentId?: string) {
  const sessions = await store.sessions(now);
  const upcomingIds = sessions.filter((s) => s.startAt > now).map((s) => s.sessionId);
  const [booked, reviews] = await Promise.all([
    studentId === undefined
      ? store.bookings(upcomingIds)
      : store.studentBookings(studentId, upcomingIds),
    store.reviews(studentId),
  ]);
  return { sessions, booked, reviews, now };
}

/** ponytail: one counted-classes read per student (N reads); fine for one academy of ~100 heads,
 * batch the attendance read if the head count grows past a few hundred. */
export async function buildBoard(
  store: GraduationFirestore,
  catalog: Catalog,
  now: string,
  canDecide: boolean,
): Promise<GraduationBoard> {
  const heads = await store.heads();
  const [names, ctx] = await Promise.all([
    store.students(heads.map((h) => h.studentId)),
    context(store, now),
  ]);
  const titles = new Map(ctx.sessions.map((s) => [s.sessionId, s.title]));
  const rows: GraduationBoardRow[] = [];
  for (const head of heads) {
    const student = names.get(head.studentId);
    if (!student?.active) continue;
    let result: Awaited<ReturnType<typeof assessStudent>>;
    try {
      result = await assessStudent(store, catalog, head, ctx);
    } catch (error) {
      // Same refusals as the progress bars (record limit, invalid attendance); one member's
      // unreadable history must not hide everyone else's graduation.
      logWarn("Graduation board skipped a member", { studentId: head.studentId, error });
      continue;
    }
    if (!result || result.target === null) continue;
    const { assessment: a, current, target } = result;
    if (a.stage !== "approval" && a.stage !== "today" && a.stage !== "next") continue;
    let graduationClass: GraduationBoardRow["graduationClass"] = null;
    if (a.graduationClass?.sessionId) {
      const title =
        titles.get(a.graduationClass.sessionId) ??
        (await store.session(a.graduationClass.sessionId))?.title ??
        "Class";
      graduationClass = {
        sessionId: a.graduationClass.sessionId,
        occurredAt: a.graduationClass.occurredAt,
        title: clamp(title, 160),
      };
    }
    rows.push({
      studentId: head.studentId,
      fullName: clamp(student.fullName, 160),
      stage: a.stage,
      current: chip(current),
      target: chip(target),
      classesDone: a.classesDone,
      minClasses: a.minClasses,
      daysDone: a.daysDone,
      minDays: a.minDays,
      likelyNext: clampLikely(a.likelyNext),
      graduationClass,
      lastNotYetNote: a.lastNotYetNote,
    });
  }
  rows.sort((x, y) =>
    (x.likelyNext?.startAt ?? x.graduationClass?.occurredAt ?? "9").localeCompare(
      y.likelyNext?.startAt ?? y.graduationClass?.occurredAt ?? "9",
    ),
  );
  return { rows, canDecide, generatedAt: now };
}

export async function buildNotices(
  store: GraduationFirestore,
  catalog: Catalog,
  studentId: string,
  now: string,
): Promise<GraduationNotices | null> {
  const [head] = await store.heads(studentId);
  if (!head) return null;
  const [names, ctx] = await Promise.all([
    store.students([studentId]),
    context(store, now, studentId),
  ]);
  const result = await assessStudent(store, catalog, head, ctx);
  if (!result) return null;
  const { assessment: a, target } = result;
  let latestPromotion: GraduationNotices["latestPromotion"] = null;
  if (head.lastApprovedPromotionId) {
    const p = await store.latestPromotion(head.lastApprovedPromotionId);
    const from = catalog.definitions.find((d) => d.definitionKey === p?.fromDefinitionKey);
    const to = catalog.definitions.find((d) => d.definitionKey === p?.toDefinitionKey);
    // Recency follows the decision instant: promotedOn is the (possibly backdated) class day.
    const decidedAt = isoInstant(p?.decidedAt) ?? isoInstant(p?.createdAt);
    const recent =
      decidedAt !== null && Date.parse(now) - Date.parse(decidedAt) <= celebrationWindowMs;
    if (
      p &&
      from &&
      to &&
      recent &&
      typeof p.promotedOn === "string" &&
      p.decisionStatus !== "rejected"
    ) {
      latestPromotion = {
        promotionId: head.lastApprovedPromotionId,
        fromName: from.name,
        toName: to.name,
        promotedOn: p.promotedOn,
      };
    }
  }
  return {
    firstName: clamp((names.get(studentId)?.fullName ?? "").split(/\s+/u)[0] ?? "", 80),
    stage: a.stage,
    targetName: target?.name ?? null,
    likelyNext: clampLikely(a.likelyNext),
    missedLikely: a.missedLikely,
    lastNotYetNote: a.lastNotYetNote,
    classesLeft: a.minClasses === null ? null : Math.max(0, a.minClasses - a.classesDone),
    latestPromotion,
  };
}
