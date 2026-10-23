#!/usr/bin/env node
// Back-fill: registration notices created before notices closed themselves. Open actionable
// notices whose request was already decided (or deleted) are resolved; open informational ones
// ("Registration approved/returned/withdrawn") are closed. Prints counts only, never names or ids.
// Dry-run by default; it prints a confirm code bound to the project, academy and counts, and only
// `--apply --confirm=<code>` writes, after recomputing the counts and checking the code still matches. Needs the built artifact
// (node apps/functions/scripts/build-deploy-artifact.mjs) and GCLOUD_PROJECT.
//   GCLOUD_PROJECT=bptjersey-f5a25 node apps/functions/scripts/resolve-registration-notices.mjs [--academy-id=demo-academy] [--apply --confirm=<code>]

import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = args.includes("--apply");
const academyId = option("academy-id") ?? "demo-academy";
const confirm = option("confirm");
const projectId = process.env.GCLOUD_PROJECT;
if (!projectId) throw new Error("Set GCLOUD_PROJECT.");
if (apply && !confirm) throw new Error("--apply needs --confirm=<code> from a dry run.");

const lib = "../../../.firebase-functions/lib/src/notifications/";
const { classifyRegistrationNotice, enrolmentRequestIdOf, noticeIdForAuditEvent, requestStillWaiting } =
  await import(`${lib}registration-notices.js`);
const artifactRequire = createRequire(new URL(`${lib}registration-notices.js`, import.meta.url));
const firebaseApp = artifactRequire("firebase-admin/app");
const app = firebaseApp.initializeApp({ projectId });
const db = artifactRequire("firebase-admin/firestore").getFirestore(app);

const ACTIONABLE = ["enrolment.request.submitted", "enrolment.request.approval.failed"];
const OUTCOMES = ["resolve", "keep", "close-informational", "ignore"];

try {
  const now = new Date().toISOString();
  const base = `academies/${academyId}`;
  const [notices, events] = await Promise.all([
    db.collection(`${base}/adminNotifications`)
      .where("kind", "==", "registration").where("resolvedAt", "==", null).get(),
    db.collection(`${base}/auditEvents`).where("action", "in", ACTIONABLE).get(),
  ]);
  // notice id -> enrolment request id, for notices born from an actionable audit event.
  const requestOf = new Map();
  for (const event of events.docs) {
    const targetRef = event.get("targetRef");
    const requestId = typeof targetRef === "string" ? enrolmentRequestIdOf(academyId, targetRef) : null;
    if (requestId) requestOf.set(noticeIdForAuditEvent(event.id), requestId);
  }
  const waiting = new Map(); // request id -> still waiting; each request read once.
  const counts = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0]));
  const toClose = [];
  for (const notice of notices.docs) {
    const requestId = requestOf.get(notice.id);
    if (requestId && !waiting.has(requestId)) {
      const request = await db.doc(`${base}/enrolmentRequests/${requestId}`).get();
      waiting.set(requestId, request.exists && requestStillWaiting(request.get("status")));
    }
    const title = notice.get("title");
    const outcome = classifyRegistrationNotice({
      title: typeof title === "string" ? title : "",
      resolvedAt: notice.get("resolvedAt") ?? null,
      requestWaiting: requestId ? waiting.get(requestId) : null,
    });
    counts[outcome] += 1;
    if (outcome === "resolve" || outcome === "close-informational") toClose.push(notice);
  }
  const countsLine = `counts: ${OUTCOMES.map((outcome) => `${outcome}=${counts[outcome]}`).join(" ")}`;
  const code = createHash("sha256")
    .update(`${projectId}/${academyId} ${countsLine}`)
    .digest("hex")
    .slice(0, 6);
  for (const outcome of OUTCOMES) console.log(`${outcome}: ${counts[outcome]}`);
  console.log(`total: ${notices.size}`);
  console.log(countsLine);
  if (!apply) {
    console.log(`confirm code: ${code}`);
  } else if (confirm !== code) {
    console.log("apply refused: the confirm code does not match these counts; run the dry run again.");
    process.exitCode = 1;
  } else {
    // Each update is conditional on the notice being unchanged since it was read, so a notice
    // closed meanwhile (trigger or another run) is skipped, never overwritten.
    let written = 0;
    let skipped = 0;
    let failed = 0;
    const writer = db.bulkWriter();
    writer.onWriteError(() => false);
    for (const notice of toClose) {
      const readAt = notice.get("readAt");
      writer
        .update(
          notice.ref,
          { resolvedAt: now, readAt: typeof readAt === "string" ? readAt : now },
          { lastUpdateTime: notice.updateTime },
        )
        .then(
          () => { written += 1; },
          (error) => {
            if (error?.code === 9) { skipped += 1; return; } // FAILED_PRECONDITION
            failed += 1;
            console.log(`write failed: code ${error?.code ?? "unknown"}`);
            process.exitCode = 1;
          },
        );
    }
    await writer.close();
    console.log(`apply: closed ${written}, skipped ${skipped} (changed since read), failed ${failed}`);
  }
} finally {
  await firebaseApp.deleteApp(app);
}
