import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  findDuplicateSeries,
  firstFutureIndex,
  resumableSeries,
  resumeLine,
  shiftWeeksInZone,
  stoppedSeriesRevisions,
  summaryLine,
} from "./retire-duplicate-regyfit-series.mjs";

// Monday 28 September 2026, 18:30 in Jersey (BST, UTC+1).
const native = {
  id: "native-1",
  weeklySeriesId: "series-strive-west",
  createdBy: "owner-uid",
  locationId: "west",
  startAt: "2026-09-28T17:30:00.000Z",
  title: "STRIVE BJJ West",
  programId: "strive",
};

const imported = {
  id: "regyfit-1420-2026-09-28",
  weeklySeriesId: "regyfit-1420",
  createdBy: "regyfit-import",
  locationId: "west",
  startAt: "2026-09-28T17:30:00.000Z",
  title: "Strive  BJJ   west",
  programId: "regyfit-program-7",
};

describe("findDuplicateSeries", () => {
  it("pairs an imported series with the native one at the same place and time", () => {
    assert.deepEqual(findDuplicateSeries([native, imported]), [
      {
        importedSeriesId: "regyfit-1420",
        nativeSeriesId: "series-strive-west",
        locationId: "west",
        weekday: "Monday",
        localTime: "18:30",
        title: "Strive  BJJ   west",
      },
    ]);
  });

  it("matches on the programme when the titles differ", () => {
    const renamed = { ...imported, title: "Adults evening", programId: "strive" };
    assert.equal(findDuplicateSeries([native, renamed]).length, 1);
  });

  it("describes a series by its earliest session", () => {
    const later = { ...imported, id: "later", startAt: "2026-10-05T17:30:00.000Z" };
    assert.equal(findDuplicateSeries([later, native, imported]).length, 1);
  });

  it("ignores the same class at another time", () => {
    assert.deepEqual(
      findDuplicateSeries([native, { ...imported, startAt: "2026-09-28T18:30:00.000Z" }]),
      [],
    );
  });

  it("ignores the same class at another location", () => {
    assert.deepEqual(findDuplicateSeries([native, { ...imported, locationId: "town" }]), []);
  });

  it("ignores the same class on another weekday", () => {
    assert.deepEqual(
      findDuplicateSeries([native, { ...imported, startAt: "2026-09-29T17:30:00.000Z" }]),
      [],
    );
  });

  it("keeps imported series that have no native twin, and never pairs two imported ones", () => {
    const otherImport = { ...imported, id: "x", weeklySeriesId: "regyfit-1421" };
    assert.deepEqual(findDuplicateSeries([imported, otherImport]), []);
  });

  it("still treats a regyfit- series whose template lost createdBy as imported", () => {
    assert.equal(findDuplicateSeries([native, { ...imported, createdBy: undefined }]).length, 1);
    assert.equal(findDuplicateSeries([native, { ...imported, createdBy: "owner-uid" }]).length, 1);
  });

  it("skips sessions outside any weekly series", () => {
    assert.deepEqual(findDuplicateSeries([{ ...native, weeklySeriesId: undefined }, imported]), []);
  });

  it("reads the weekday and time in the academy timezone", () => {
    // 23:30 UTC on Sunday is 00:30 Monday in Jersey during BST.
    const late = { ...native, startAt: "2026-09-27T23:30:00.000Z" };
    const lateImport = { ...imported, startAt: "2026-09-27T23:30:00.000Z" };
    assert.equal(findDuplicateSeries([late, lateImport])[0].weekday, "Monday");
    assert.equal(findDuplicateSeries([late, lateImport], "UTC")[0].weekday, "Sunday");
  });
});

function seriesDoc(seriesId, template, extra = {}) {
  return {
    seriesId,
    academyId: "demo-academy",
    timezone: "Europe/Jersey",
    revisions: [{ fromIndex: 0, enabled: true, template: { ...template, sessionId: seriesId } }],
    ...extra,
  };
}

describe("findDuplicateSeries from sessionSeries", () => {
  it("finds a duplicate from the series templates when no session exists yet", () => {
    const docs = [seriesDoc("series-strive-west", native), seriesDoc("regyfit-1420", imported)];
    assert.deepEqual(
      findDuplicateSeries([], "Europe/Jersey", docs).map((row) => row.importedSeriesId),
      ["regyfit-1420"],
    );
  });

  it("uses the latest revision and skips a series the office already stopped", () => {
    const moved = seriesDoc("regyfit-1420", imported);
    moved.revisions.push({
      fromIndex: 3,
      enabled: true,
      template: { ...imported, startAt: "2026-10-19T18:30:00.000Z" },
    });
    const docs = [seriesDoc("series-strive-west", native), moved];
    assert.deepEqual(findDuplicateSeries([], "Europe/Jersey", docs), []);

    const stopped = seriesDoc("regyfit-1420", imported);
    stopped.revisions.push({ fromIndex: 2, enabled: false, template: imported });
    assert.deepEqual(
      findDuplicateSeries([imported], "Europe/Jersey", [
        seriesDoc("series-strive-west", native),
        stopped,
      ]),
      [],
    );
  });

  it("falls back to sessions for a series id without a document", () => {
    assert.equal(
      findDuplicateSeries([imported], "Europe/Jersey", [seriesDoc("series-strive-west", native)])
        .length,
      1,
    );
  });
});

describe("stopping a duplicate series", () => {
  const series = seriesDoc("regyfit-1420", {
    ...imported,
    startAt: "2026-09-07T17:30:00.000Z",
    endAt: "2026-09-07T18:30:00.000Z",
  });

  it("starts from the first week that has not happened yet", () => {
    // Monday 28 September 10:00 UTC: weeks 0-2 are past, week 3 (28 Sep 18:30) is still ahead.
    assert.equal(firstFutureIndex(series, Date.parse("2026-09-28T10:00:00.000Z")), 3);
    assert.equal(firstFutureIndex(series, Date.parse("2026-09-01T00:00:00.000Z")), 0);
  });

  it("reads the index inside the revision in force", () => {
    const revised = {
      ...series,
      revisions: [
        series.revisions[0],
        {
          fromIndex: 2,
          enabled: true,
          template: { ...series.revisions[0].template, startAt: "2026-09-21T16:30:00.000Z" },
        },
      ],
    };
    assert.equal(firstFutureIndex(revised, Date.parse("2026-10-06T00:00:00.000Z")), 5);
  });

  it("appends the disabled revision the office's stop writes, keeping earlier ones", () => {
    const at = "2026-09-28T10:00:00.000Z";
    const revisions = stoppedSeriesRevisions(series, 3, at);
    assert.equal(revisions.length, 2);
    assert.deepEqual(revisions[0], series.revisions[0]);
    const { fromIndex, enabled, template } = revisions[1];
    assert.equal(fromIndex, 3);
    assert.equal(enabled, false);
    assert.equal(template.sessionId, "regyfit-1420__week_3");
    assert.equal(template.startAt, "2026-09-28T17:30:00.000Z");
    assert.equal(template.endAt, "2026-09-28T18:30:00.000Z");
    assert.equal(template.weeklyIndex, 3);
    assert.equal(template.status, "scheduled");
    assert.equal(template.cancellationReason, null);
    assert.equal(template.weeklyOverride, false);
    assert.equal(template.repeatWeekly, false);
    assert.equal(template.updatedBy, "retire-duplicate-regyfit-series");
    assert.equal(template.updatedAt, at);
    assert.equal(template.title, imported.title);
  });

  it("drops revisions from the stop onwards and does nothing to an already stopped series", () => {
    const later = {
      ...series,
      revisions: [
        ...series.revisions,
        { fromIndex: 6, enabled: true, template: series.revisions[0].template },
      ],
    };
    const revisions = stoppedSeriesRevisions(later, 4, "2026-09-28T10:00:00.000Z");
    assert.deepEqual(
      revisions.map((row) => [row.fromIndex, row.enabled]),
      [
        [0, true],
        [4, false],
      ],
    );
    assert.equal(
      stoppedSeriesRevisions({ ...later, revisions }, 5, "2026-09-29T10:00:00.000Z"),
      null,
    );
  });

  it("keeps the Jersey wall-clock time across the change to winter time", () => {
    // 18:30 BST on 19 October is 18:30 GMT on 26 October.
    assert.equal(
      shiftWeeksInZone("2026-10-19T17:30:00.000Z", 1, "Europe/Jersey"),
      "2026-10-26T18:30:00.000Z",
    );
  });
});

describe("resuming an interrupted --apply", () => {
  const stoppedByScript = (id, extra = {}) => ({
    ...seriesDoc(id, imported),
    retiredBy: "retire-duplicate-regyfit-series",
    retiredAt: "2026-09-28T10:00:00.000Z",
    ...extra,
  });
  const leftover = { ...imported, id: "regyfit-1420__week_4", weeklyIndex: 4 };

  it("picks up a series this script stopped that still has sessions to cancel", () => {
    const series = stoppedByScript("regyfit-1420");
    series.revisions.push({ fromIndex: 3, enabled: false, template: imported });
    const docs = [seriesDoc("series-strive-west", native), series];
    assert.deepEqual(resumableSeries(docs, [leftover]), ["regyfit-1420"]);
    // Detection alone no longer sees it: the stopped series has no live slot.
    assert.deepEqual(findDuplicateSeries([leftover], "Europe/Jersey", docs), []);
    // And no second stop is written for it.
    assert.equal(stoppedSeriesRevisions(series, 4, "2026-09-29T10:00:00.000Z"), null);
  });

  it("does not resume a series whose weekly repetition was switched back on", () => {
    const series = stoppedByScript("regyfit-1420");
    series.revisions.push({ fromIndex: 3, enabled: false, template: imported });
    series.revisions.push({ fromIndex: 5, enabled: true, template: imported });
    assert.deepEqual(resumableSeries([series], [leftover]), []);
    // Marked by the script but its latest revision is still enabled: not resumed either.
    assert.deepEqual(resumableSeries([stoppedByScript("regyfit-1420")], [leftover]), []);
  });

  it("counts series to stop and series resumed apart in the summary", () => {
    const rows = [
      { series: "regyfit-1420", bookings: 0 },
      { series: "regyfit-1420", bookings: 1 },
      { series: "regyfit-1421", bookings: 0 },
    ];
    assert.equal(
      summaryLine(1, 1, rows),
      "1 series to stop, 1 already stopped; 3 future sessions in 2 series; 2 without bookings, 1 with bookings.",
    );
  });

  it("ignores series stopped by the office, native series and series with nothing left", () => {
    assert.deepEqual(resumableSeries([seriesDoc("regyfit-1420", imported)], [leftover]), []);
    assert.deepEqual(
      resumableSeries(
        [
          {
            ...seriesDoc("series-strive-west", native),
            retiredBy: "retire-duplicate-regyfit-series",
          },
        ],
        [{ ...native, weeklySeriesId: "series-strive-west" }],
      ),
      [],
    );
    assert.deepEqual(resumableSeries([stoppedByScript("regyfit-1420")], []), []);
  });

  it("reports what is left to cancel and what stays because it is booked", () => {
    const rows = [
      { sessionId: "a", series: "regyfit-1420", bookings: 0 },
      { sessionId: "b", series: "regyfit-1420", bookings: 2 },
      { sessionId: "c", series: "regyfit-1420", bookings: 0 },
      { sessionId: "d", series: "regyfit-1421", bookings: 0 },
    ];
    assert.equal(
      resumeLine("regyfit-1420", rows),
      "regyfit-1420: already stopped, 2 sessions left to cancel (1 booked, kept)",
    );
  });
});

describe("credentials", () => {
  const script = fileURLToPath(new URL("./retire-duplicate-regyfit-series.mjs", import.meta.url));
  const run = (credentials) => {
    const env = { ...process.env };
    delete env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credentials !== undefined) env.GOOGLE_APPLICATION_CREDENTIALS = credentials;
    return spawnSync(
      process.execPath,
      [script, "--project=bptjersey-f5a25", "--academy=demo-academy"],
      {
        env,
        encoding: "utf8",
      },
    );
  };
  const key = (content) => {
    const path = join(mkdtempSync(join(tmpdir(), "retire-key-")), "key.json");
    writeFileSync(path, content);
    return path;
  };

  it("refuses to fall back to ambient credentials", () => {
    const result = run(undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Set GOOGLE_APPLICATION_CREDENTIALS/);
  });

  it("refuses a key without project_id or for another project", () => {
    assert.match(run(key("{}")).stderr, /no project_id/);
    assert.match(run(key('{"project_id":"other"}')).stderr, /belongs to other/);
    assert.match(run(key("not json")).stderr, /readable key file/);
  });
});

describe("run-retire-duplicates.sh", () => {
  const wrapper = fileURLToPath(new URL("./run-retire-duplicates.sh", import.meta.url));
  const setup = (keyCount) => {
    const root = mkdtempSync(join(tmpdir(), "retire-wrapper-"));
    const secrets = join(root, "secrets");
    const bin = join(root, "bin");
    mkdirSync(secrets);
    mkdirSync(bin);
    for (let index = 0; index < keyCount; index += 1) {
      writeFileSync(join(secrets, `p-adminsdk-${index}.json`), '{"private_key":"NEVER-PRINTED"}');
    }
    // A stand-in for node that only echoes what it was given.
    writeFileSync(
      join(bin, "node"),
      '#!/bin/sh\necho "ARGS $*"\necho "KEY $GOOGLE_APPLICATION_CREDENTIALS"\n',
    );
    chmodSync(join(bin, "node"), 0o755);
    return { root, secrets, bin, out: join(root, "out") };
  };
  const run = (paths, args, input = "") =>
    spawnSync("bash", [wrapper, ...args], {
      input,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${paths.bin}:${process.env.PATH}`,
        BPT_SECRETS_DIR: paths.secrets,
        BPT_RUNBOOK_DIR: paths.out,
      },
    });

  it("refuses an unknown mode", () => {
    const paths = setup(1);
    assert.equal(run(paths, ["nope"]).status, 1);
    assert.equal(run(paths, []).status, 1);
  });

  it("needs exactly one key", () => {
    assert.match(run(setup(0), ["dryrun"]).stderr, /exactly one .* found 0/);
    assert.match(run(setup(2), ["dryrun"]).stderr, /exactly one .* found 2/);
  });

  it("runs the dry-run with the fixed target, the key only in the environment, and a private log", () => {
    const paths = setup(1);
    const result = run(paths, ["dryrun"]);
    assert.equal(result.status, 0);
    assert.match(
      result.stdout,
      /ARGS \S+retire-duplicate-regyfit-series\.mjs --project=bptjersey-f5a25 --academy=demo-academy\n/,
    );
    assert.match(result.stdout, new RegExp(`KEY ${join(paths.secrets, "p-adminsdk-0.json")}`));
    assert.doesNotMatch(result.stdout, /NEVER-PRINTED/);
    const [log] = readdirSync(paths.out);
    assert.match(log, /^dryrun-\d{8}T\d{6}Z\.txt$/);
    assert.match(readFileSync(join(paths.out, log), "utf8"), /--academy=demo-academy/);
    assert.equal(statSync(paths.out).mode & 0o777, 0o700);
  });

  it("asks before apply and passes --apply only after a yes", () => {
    const paths = setup(1);
    const refused = run(paths, ["apply"], "n\n");
    assert.equal(refused.status, 1);
    assert.match(refused.stdout, /Cancelled\. Nothing written\./);
    assert.doesNotMatch(refused.stdout, /ARGS/);
    const accepted = run(paths, ["apply"], "y\n");
    assert.equal(accepted.status, 0);
    assert.match(accepted.stdout, /--academy=demo-academy --apply\n/);
  });
});
