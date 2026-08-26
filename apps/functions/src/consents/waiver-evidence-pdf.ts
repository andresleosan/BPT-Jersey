import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

import type { WaiverEvidencePdfGenerator } from "./consent-service.js";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const TOP = 744;
const BOTTOM = 54;
const LINE_HEIGHT = 13;
const MAX_LINE_CHARACTERS = 88;

function safeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[\s\S]/gu, (character) => (character.codePointAt(0)! <= 0xff ? character : "?"))
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function linesFor(value: string): string[] {
  const words = safeText(value).split(" ").filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const pieces = word.match(new RegExp(`.{1,${MAX_LINE_CHARACTERS}}`, "gu")) ?? [word];
    for (const piece of pieces) {
      const current = lines.at(-1);
      if (!current || `${current} ${piece}`.length > MAX_LINE_CHARACTERS) lines.push(piece);
      else lines[lines.length - 1] = `${current} ${piece}`;
    }
  }
  return lines.length ? lines : [""];
}

function addPage(document: PDFDocument): { page: PDFPage; y: number } {
  return { page: document.addPage([PAGE_WIDTH, PAGE_HEIGHT]), y: TOP };
}

function drawLines(
  document: PDFDocument,
  state: { page: PDFPage; y: number },
  font: PDFFont,
  lines: readonly string[],
  size = 9,
): { page: PDFPage; y: number } {
  let { page, y } = state;
  for (const line of lines) {
    if (y < BOTTOM) ({ page, y } = addPage(document));
    page.drawText(line, { x: MARGIN, y, size, font });
    y -= LINE_HEIGHT;
  }
  return { page, y };
}

export const createWaiverEvidencePdf: WaiverEvidencePdfGenerator = async (input) => {
  const document = await PDFDocument.create();
  const bodyFont = await document.embedFont(StandardFonts.Helvetica);
  const headingFont = await document.embedFont(StandardFonts.HelveticaBold);
  document.setTitle(`BPT Jersey waiver evidence ${safeText(input.version.versionLabel)}`);
  document.setSubject(`Consent ${safeText(input.consentId)}`);
  document.setCreator("BPT Jersey Academy Platform");
  document.setProducer("BPT Jersey Academy Platform");

  let state = addPage(document);
  state = drawLines(document, state, headingFont, [safeText(input.version.title)], 16);
  state.y -= 5;
  state = drawLines(document, state, bodyFont, [
    `Version: ${safeText(input.version.versionLabel)}`,
    `Waiver version ID: ${safeText(input.version.waiverVersionId)}`,
    `Content SHA-256: ${safeText(input.version.contentHash)}`,
    `Effective at: ${safeText(input.version.effectiveAt)}`,
  ]);
  state.y -= 8;
  state = drawLines(document, state, bodyFont, linesFor(input.version.introduction));
  state.y -= 12;

  for (const clause of input.version.clauses) {
    state = drawLines(document, state, headingFont, [safeText(clause.heading)], 11);
    state = drawLines(document, state, bodyFont, linesFor(clause.body));
    state = drawLines(document, state, headingFont, [
      `Decision: ${safeText(input.clauseResponses[clause.key])}${clause.required ? " (required)" : " (optional)"}`,
    ]);
    state.y -= 10;
  }

  if (state.y < 190) state = addPage(document);
  state = drawLines(document, state, headingFont, ["Authenticated acceptance"], 12);
  state = drawLines(document, state, bodyFont, [
    `Consent ID: ${safeText(input.consentId)}`,
    `Subject: ${safeText(input.student.fullName)} (${safeText(input.student.participantType)})`,
    `Subject ID: ${safeText(input.student.studentId)}`,
    `Signed by: ${safeText(input.signer.displayName)}`,
    `Signer user ID: ${safeText(input.signer.userId)}`,
    "Signature method: authenticated typed name",
    `Server timestamp: ${safeText(input.signedAt)}`,
  ]);

  return document.save({ useObjectStreams: true });
};
