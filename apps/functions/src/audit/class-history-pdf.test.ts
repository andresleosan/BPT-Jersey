import zlib from "node:zlib";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type {
  ClassHistoryFilterSummary,
  ClassHistoryRow,
} from "@bpt-jersey/domain/audit/class-history";

import { buildClassHistoryPdf } from "./class-history-pdf.js";

const filters: ClassHistoryFilterSummary = {
  since: "2026-09-01T00:00:00.000Z",
  actorId: null,
  registrationType: "all",
  limit: 200,
};

const generatedAt = "2026-09-17T09:00:00.000Z";

function row(overrides: Partial<ClassHistoryRow> = {}): ClassHistoryRow {
  return {
    id: "event-1",
    occurredAt: "2026-09-16T10:00:00.000Z",
    action: "booking.created",
    actorId: "s1",
    actorRole: "adultStudent",
    actorGroup: "member",
    actorName: null,
    actorIp: "82.112.144.10",
    studentId: "s1",
    studentName: "Jane Doe",
    sessionId: "session-1",
    sessionStartAt: "2026-09-16T17:30:00.000Z",
    programId: "program-1",
    programName: "Adult BJJ",
    locationId: "location-1",
    source: "bpt",
    sentence: "Jane Doe booked the class of 16 Sep 2026 at 18:30",
    ...overrides,
  };
}

/**
 * pdf-lib exposes no text-extraction API, and standard-font drawText writes hex-encoded strings
 * (WinAnsi code points) inside `<...> Tj` operators, in streams that are Flate-compressed. This
 * decompresses every stream and decodes those hex strings back to text so a test can assert a
 * row's actual words - not just page count - made it into the document.
 */
function extractPdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const latin1 = raw.toString("latin1");
  let corpus = "";
  let cursor = 0;

  for (;;) {
    const streamAt = latin1.indexOf("stream", cursor);
    if (streamAt === -1) break;
    let start = streamAt + "stream".length;
    if (latin1[start] === "\r") start += 1;
    if (latin1[start] === "\n") start += 1;
    const endAt = latin1.indexOf("endstream", start);
    if (endAt === -1) break;
    const chunk = raw.subarray(start, endAt);
    try {
      corpus += zlib.inflateSync(chunk).toString("latin1");
    } catch {
      corpus += chunk.toString("latin1");
    }
    cursor = endAt + "endstream".length;
  }

  const hexStrings = corpus.match(/<[0-9A-Fa-f]+>/g) ?? [];
  return hexStrings
    .map((match) => {
      const hex = match.slice(1, -1);
      let text = "";
      for (let i = 0; i + 1 < hex.length; i += 2) {
        const byte = Number.parseInt(hex.slice(i, i + 2), 16);
        // 0x97 is the em dash in WinAnsiEncoding, the only non-ASCII code point this file emits.
        text += byte === 0x97 ? "—" : String.fromCharCode(byte);
      }
      return text;
    })
    .join(" ");
}

describe("buildClassHistoryPdf", () => {
  it("produces a PDF that carries the rows", async () => {
    const rows = [row()];
    const bytes = await buildClassHistoryPdf({ rows, filters, generatedAt });

    expect(bytes.subarray(0, 5)).toEqual(new TextEncoder().encode("%PDF-"));
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(0);

    const text = extractPdfText(bytes);
    expect(text).toContain("Jane Doe booked the class of 16 Sep 2026 at 18:30");
    expect(text).toContain("82.112.144.10");
    expect(text).toContain("16 Sep 2026 at 11:00");
  });

  it("paginates a thousand rows instead of overflowing one page", async () => {
    const thousandRows = Array.from({ length: 1000 }, (_, index) =>
      row({ id: `event-${index}`, sentence: `Jane Doe booked class number ${index}` }),
    );
    const bytes = await buildClassHistoryPdf({ rows: thousandRows, filters, generatedAt });

    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(10);
  });

  it("prints an em dash for a redacted IP instead of leaving the cell blank", async () => {
    const rows = [row({ actorIp: null })];
    const bytes = await buildClassHistoryPdf({ rows, filters, generatedAt });

    const text = extractPdfText(bytes);
    expect(text).toContain("—");
    // The row's own sentence must still be there - a null IP never blanks the whole row.
    expect(text).toContain("Jane Doe booked the class of 16 Sep 2026 at 18:30");
  });

  it("never invents a placeholder IP when the row carries a real one", async () => {
    const rows = [row({ actorIp: "203.0.113.7" })];
    const bytes = await buildClassHistoryPdf({ rows, filters, generatedAt });

    const text = extractPdfText(bytes);
    expect(text).toContain("203.0.113.7");
    expect(text).not.toContain("—");
  });

  it("wraps a long sentence across lines rather than dropping it", async () => {
    const longSentence =
      "Jane Doe was booked by a member of staff into a very long program name that goes on and on so it must wrap across more than one line of the details column without ever being truncated or dropped from the page";
    const rows = [row({ sentence: longSentence })];
    const bytes = await buildClassHistoryPdf({ rows, filters, generatedAt });

    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(1);

    const text = extractPdfText(bytes);
    // Wrapped fragments are re-joined with a single space, reproducing the original sentence.
    expect(text).toContain(longSentence);
  });

  it("never overflows the page width even for a single unbreakable long token", async () => {
    const rows = [row({ sentence: "x".repeat(400) })];

    // Must not throw (pdf-lib throws if a drawn line is wider than the page).
    const bytes = await buildClassHistoryPdf({ rows, filters, generatedAt });
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(0);

    const text = extractPdfText(bytes);
    expect(text).toContain("x".repeat(20));
  });

  it("renders the filter summary and generated-at date in Jersey local time", async () => {
    const rows = [row()];
    const bytes = await buildClassHistoryPdf({
      rows,
      filters: { ...filters, registrationType: "member-bookings", actorId: "coach-9", limit: 50 },
      generatedAt,
    });

    const text = extractPdfText(bytes);
    expect(text).toContain("coach-9");
    expect(text).toContain("member-bookings");
    expect(text).toContain("50");
    // generatedAt 2026-09-17T09:00:00.000Z is 10:00 in Jersey (BST, UTC+1) in September.
    expect(text).toContain("17 Sep 2026 at 10:00");
  });

  it("handles an empty row set without throwing", async () => {
    const bytes = await buildClassHistoryPdf({ rows: [], filters, generatedAt });
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(1);

    const text = extractPdfText(bytes);
    expect(text).toContain("No registrations found.");
    expect(text).toContain("Rows: 0");
  });
});
