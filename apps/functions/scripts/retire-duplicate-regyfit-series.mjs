#!/usr/bin/env node

/**
 * Finds weekly series imported from Regyfit (series id `regyfit-*`, or a template created by
 * "regyfit-import") that repeat a native series: same location, weekday and local start time, and
 * the same programme or title. Series are read from `sessionSeries` (their latest revision, when it
 * is still enabled); a series id seen only on sessions is described by its earliest future session.
 *
 * Dry-run by default: prints the pairs, the series it would stop and from which date, and every
 * future session of those series with its live bookings. `--apply` first stops each duplicate
 * series from its first future week, with the same disabled revision the office's "stop weekly
 * repetition" writes, so the calendar does not recreate the weeks; then it cancels only the future
 * sessions without a live booking and reports the rest untouched. It never deletes a document. The
 * imported series that have no native twin are the live adult timetable and are never listed.
 *
 *   node apps/functions/scripts/retire-duplicate-regyfit-series.mjs --project=<id> --academy=<id> [--apply]
 *
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS pointing at the project's service-account key; its
 * project_id must equal --project.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const actor = "retire-duplicate-regyfit-series";
const importer = "regyfit-import";
const liveBookingStatuses = ["requested", "confirmed"];
const weekMs = 7 * 86_400_000;
// A daylight-saving change moves an occurrence by at most an hour against a plain UTC week.
const dstSlackMs = 2 * 3_600_000;

class CliError extends Error {}

export function normaliseTitle(title) {
  return String(title ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

/** The `regyfit-` id prefix alone is enough: some imported templates lost their createdBy. */
function isImported(entry) {
  return entry.seriesId.startsWith("regyfit-") || entry.createdBy === importer;
}

/** Weekday and 24-hour start time of an instant in the academy's timezone. */
export function localSlot(startAt, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(startAt))
      .map((part) => [part.type, part.value]),
  );
  return { weekday: parts.weekday, localTime: `${parts.hour}:${parts.minute}` };
}

function offsetMs(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return local - Math.floor(instant / 1000) * 1000;
}

/** Moves an instant by whole weeks keeping its wall-clock time in `timeZone`. */
export function shiftWeeksInZone(iso, weeks, timeZone) {
  const start = Date.parse(iso);
  const naive = start + weeks * weekMs;
  return new Date(naive + offsetMs(start, timeZone) - offsetMs(naive, timeZone)).toISOString();
}

function entryOf(seriesId, template) {
  return {
    seriesId,
    createdBy: template.createdBy,
    locationId: template.locationId,
    startAt: template.startAt,
    title: template.title,
    programId: template.programId,
  };
}

/**
 * One entry per weekly series: from its `sessionSeries` document when there is one (latest
 * revision, skipped when that revision stopped the series), otherwise from its earliest session.
 */
export function describeSeries(sessions, seriesDocuments = []) {
  const entries = new Map();
  const documented = new Set();
  for (const series of seriesDocuments) {
    documented.add(series.seriesId);
    const latest = series.revisions?.at(-1);
    if (latest?.enabled && latest.template) {
      entries.set(series.seriesId, entryOf(series.seriesId, latest.template));
    }
  }
  for (const session of [...sessions].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    const id = session.weeklySeriesId;
    if (typeof id !== "string" || id.length === 0 || documented.has(id) || entries.has(id))
      continue;
    entries.set(id, entryOf(id, session));
  }
  return [...entries.values()];
}

/**
 * Returns one row per imported/native pair; an imported series matching two native ones appears
 * twice.
 */
export function findDuplicateSeries(sessions, timeZone = "Europe/Jersey", seriesDocuments = []) {
  const series = describeSeries(sessions, seriesDocuments).map((entry) => ({
    entry,
    ...localSlot(entry.startAt, timeZone),
    title: normaliseTitle(entry.title),
  }));
  const natives = series.filter(({ entry }) => !isImported(entry));
  const duplicates = [];
  for (const imported of series.filter(({ entry }) => isImported(entry))) {
    for (const native of natives) {
      const sameSlot =
        imported.entry.locationId === native.entry.locationId &&
        imported.weekday === native.weekday &&
        imported.localTime === native.localTime;
      const sameClass =
        imported.entry.programId === native.entry.programId || imported.title === native.title;
      if (!sameSlot || !sameClass) continue;
      duplicates.push({
        importedSeriesId: imported.entry.seriesId,
        nativeSeriesId: native.entry.seriesId,
        locationId: imported.entry.locationId,
        weekday: imported.weekday,
        localTime: imported.localTime,
        title: imported.entry.title,
      });
    }
  }
  return duplicates;
}

/**
 * The first weekly index of `series` that is not yet in the past at `nowMs`. It may land one week
 * early around a daylight-saving change, which only stops an occurrence that has already happened.
 */
export function firstFutureIndex(series, nowMs) {
  const revisions = series.revisions;
  for (const [position, revision] of revisions.entries()) {
    const elapsed = nowMs - Date.parse(revision.template.startAt) - dstSlackMs;
    const index = revision.fromIndex + Math.max(0, Math.ceil(elapsed / weekMs));
    if (index < (revisions[position + 1]?.fromIndex ?? Infinity)) return index;
  }
  return revisions.at(-1).fromIndex;
}

/**
 * The revisions after stopping `series` from `fromIndex`, shaped like `reviseWeeklySeries(...,
 * enabled = false)`: earlier revisions kept, later ones replaced by one disabled revision whose
 * template is the occurrence at `fromIndex`. Null when the series is already stopped by then.
 */
export function stoppedSeriesRevisions(series, fromIndex, at, timeZone = series.timezone) {
  const revisions = series.revisions;
  const latest = revisions.at(-1);
  if (latest && !latest.enabled && latest.fromIndex <= fromIndex) return null;
  const effective =
    [...revisions].reverse().find((row) => row.fromIndex <= fromIndex) ?? revisions[0];
  const weeks = fromIndex - effective.fromIndex;
  const template = effective.template;
  return [
    ...revisions.filter((row) => row.fromIndex < fromIndex),
    {
      fromIndex,
      enabled: false,
      template: {
        ...template,
        sessionId: fromIndex === 0 ? series.seriesId : `${series.seriesId}__week_${fromIndex}`,
        startAt: shiftWeeksInZone(template.startAt, weeks, timeZone),
        endAt: shiftWeeksInZone(template.endAt, weeks, timeZone),
        weeklySeriesId: series.seriesId,
        weeklyIndex: fromIndex,
        status: "scheduled",
        cancellationReason: null,
        weeklyOverride: false,
        repeatWeekly: false,
        updatedAt: at,
        updatedBy: actor,
      },
    },
  ];
}

/**
 * Imported series this script already stopped, and still stopped (someone may have switched weekly
 * repetition back on since), that still have future sessions not cancelled: a
 * rerun after an interrupted `--apply` only has to cancel those. `futureSessions` are the
 * academy's future, non-cancelled sessions.
 */
export function resumableSeries(seriesDocuments, futureSessions) {
  const pending = new Set(futureSessions.map((row) => row.weeklySeriesId));
  return seriesDocuments
    .filter(
      (series) =>
        series.retiredBy === actor &&
        series.revisions?.at(-1)?.enabled === false &&
        isImported({
          seriesId: series.seriesId,
          createdBy: series.revisions?.at(-1)?.template?.createdBy,
        }) &&
        pending.has(series.seriesId),
    )
    .map((series) => series.seriesId);
}

/** "already stopped" line for one resumed series, from its future session rows with bookings. */
export function resumeLine(seriesId, rows) {
  const own = rows.filter((row) => row.series === seriesId);
  const booked = own.filter((row) => row.bookings > 0).length;
  return `${seriesId}: already stopped, ${own.length - booked} sessions left to cancel (${booked} booked, kept)`;
}

/** The one-line summary: series to stop and series resumed are counted apart. */
export function summaryLine(stopCount, resumedCount, rows) {
  const series = new Set(rows.map((row) => row.series)).size;
  const booked = rows.filter((row) => row.bookings > 0).length;
  return (
    `${stopCount} series to stop, ${resumedCount} already stopped; ` +
    `${rows.length} future sessions in ${series} series; ` +
    `${rows.length - booked} without bookings, ${booked} with bookings.`
  );
}

/** Where to stop a series: its first future week, or an earlier future session already on file. */
function stopIndex(series, sessions, nowMs) {
  const indexes = sessions
    .filter((row) => row.weeklySeriesId === series.seriesId && Number.isInteger(row.weeklyIndex))
    .map((row) => row.weeklyIndex);
  return Math.min(firstFutureIndex(series, nowMs), ...indexes);
}

function parseArguments(values) {
  const options = { apply: false };
  for (const value of values) {
    if (value === "--apply") {
      options.apply = true;
      continue;
    }
    const match = /^--(project|academy)=([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/u.exec(value);
    if (!match || Object.hasOwn(options, match[1])) {
      throw new CliError(`Unexpected argument: ${value}`);
    }
    options[match[1]] = match[2];
  }
  if (!options.project) throw new CliError("Missing --project=<firebase project id>.");
  if (!options.academy) throw new CliError("Missing --academy=<academy id>.");
  return options;
}

async function liveBookingCount(query) {
  const snapshot = await query.where("status", "in", liveBookingStatuses).get();
  return snapshot.size;
}

function assertCredentials(project) {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) {
    throw new CliError(
      "Set GOOGLE_APPLICATION_CREDENTIALS to the project's service-account key file (see the runbook).",
    );
  }
  let projectId;
  try {
    projectId = JSON.parse(readFileSync(path, "utf8")).project_id;
  } catch {
    throw new CliError("GOOGLE_APPLICATION_CREDENTIALS does not point at a readable key file.");
  }
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new CliError("The key file has no project_id; use the project's service-account key.");
  }
  if (projectId !== project) {
    throw new CliError(`The key file belongs to ${projectId}, not to --project=${project}.`);
  }
}

async function main(argv) {
  const options = parseArguments(argv);
  assertCredentials(options.project);
  const { deleteApp, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp({ projectId: options.project }, actor);
  try {
    const firestore = getFirestore(app);
    const academy = firestore.doc(`academies/${options.academy}`);
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const snapshot = await academy.collection("sessions").where("startAt", ">=", now).get();
    const future = snapshot.docs
      .map((doc) => ({ ...doc.data(), id: doc.id }))
      .filter((session) => session.status !== "cancelled");
    const seriesSnapshot = await academy.collection("sessionSeries").get();
    const seriesDocuments = seriesSnapshot.docs.map((doc) => ({ ...doc.data(), seriesId: doc.id }));
    const locations = await academy.collection("locations").get();
    const timeZone = locations.docs[0]?.get("timezone") ?? "Europe/Jersey";

    const duplicates = findDuplicateSeries(future, timeZone, seriesDocuments);
    const resumed = resumableSeries(seriesDocuments, future);
    process.stdout.write(
      `Project ${options.project}, academy ${options.academy}, timezone ${timeZone}, ` +
        `${options.apply ? "APPLY" : "dry-run"}\n`,
    );
    if (duplicates.length === 0 && resumed.length === 0) {
      process.stdout.write("No duplicate Regyfit series found. Nothing to do.\n");
      return;
    }
    if (duplicates.length > 0) console.table(duplicates);

    const retired = new Set([...duplicates.map((row) => row.importedSeriesId), ...resumed]);
    const stops = [];
    // A series this script already stopped only needs its remaining sessions cancelled.
    const toStop = seriesDocuments.filter(
      (row) => retired.has(row.seriesId) && !resumed.includes(row.seriesId),
    );
    for (const series of toStop) {
      const fromIndex = stopIndex(series, future, nowMs);
      const revisions = stoppedSeriesRevisions(series, fromIndex, now, series.timezone ?? timeZone);
      if (revisions) {
        stops.push({
          seriesId: series.seriesId,
          fromIndex,
          from: revisions.at(-1).template.startAt,
        });
      }
    }
    if (stops.length > 0) {
      process.stdout.write("Weekly series to stop (no new weeks from this date):\n");
      console.table(stops);
    }

    const sessions = future
      .filter((session) => retired.has(session.weeklySeriesId))
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    const rows = [];
    for (const session of sessions) {
      const bookings = await liveBookingCount(
        academy.collection("bookings").where("sessionId", "==", session.id),
      );
      rows.push({
        sessionId: session.id,
        series: session.weeklySeriesId,
        startAt: session.startAt,
        title: session.title,
        bookings,
      });
    }
    console.table(rows);
    for (const seriesId of resumed) process.stdout.write(`${resumeLine(seriesId, rows)}\n`);
    process.stdout.write(`${summaryLine(stops.length, resumed.length, rows)}\n`);
    if (!options.apply) {
      process.stdout.write(
        "Dry-run: nothing written. Re-run with --apply to stop the series and cancel the sessions without bookings.\n",
      );
      return;
    }

    // Stop the series first, so the calendar cannot recreate a week while its sessions are cancelled.
    let stopped = 0;
    for (const stop of stops) {
      const ref = academy.collection("sessionSeries").doc(stop.seriesId);
      const changed = await firestore.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        if (!current.exists) return false;
        const series = { ...current.data(), seriesId: current.id };
        const at = new Date().toISOString();
        const revisions = stoppedSeriesRevisions(
          series,
          stop.fromIndex,
          at,
          series.timezone ?? timeZone,
        );
        if (!revisions) return false;
        transaction.update(ref, { revisions, retiredBy: actor, retiredAt: at });
        return true;
      });
      if (changed) stopped += 1;
    }
    process.stdout.write(`Stopped ${stopped} weekly series.\n`);

    let cancelled = 0;
    const kept = [];
    for (const row of rows) {
      const ref = academy.collection("sessions").doc(row.sessionId);
      const outcome = await firestore.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        if (!current.exists || current.get("status") === "cancelled") return "skipped";
        const live = await transaction.get(
          academy
            .collection("bookings")
            .where("sessionId", "==", row.sessionId)
            .where("status", "in", liveBookingStatuses),
        );
        if (live.size > 0) return "booked";
        const at = new Date().toISOString();
        transaction.update(ref, {
          status: "cancelled",
          cancellationReason: "Duplicate of a native weekly series",
          cancelledBy: actor,
          cancelledAt: at,
          updatedAt: at,
          updatedBy: actor,
        });
        return "cancelled";
      });
      if (outcome === "cancelled") cancelled += 1;
      if (outcome === "booked") kept.push(row);
    }
    process.stdout.write(`Cancelled ${cancelled} sessions.\n`);
    if (kept.length > 0) {
      process.stdout.write(
        "Left untouched because they have bookings (move or cancel them by hand):\n",
      );
      console.table(kept);
    }
  } finally {
    await deleteApp(app);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof CliError ? error.message : "Retirement failed."}\n`);
    if (!(error instanceof CliError)) process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
