import { PDFDocument, StandardFonts, type PDFPage } from "pdf-lib";

import type { MemberReportKey } from "@bpt-jersey/domain";
import type { MemberProjection } from "./member-service.js";

export type MemberReportPdfGenerator = (
  report: MemberReportKey,
  members: readonly MemberProjection[],
) => Promise<Uint8Array>;

const reportColumns = [
  ["membershipNumber", "Membership number"],
  ["fullName", "Name"],
  ["email", "Email"],
  ["idCardNumber", "ID card number"],
  ["vatNumber", "VAT number"],
  ["birthDate", "Birth date"],
  ["mobileNumber", "Mobile number"],
  ["frequency", "Frequency"],
  ["paymentStatus", "Payment status"],
  ["gender", "Gender"],
  ["trainingCenter", "Training center"],
  ["membershipStatus", "Membership status"],
  ["createdAt", "Registration date"],
] as const satisfies readonly (readonly [keyof MemberProjection, string])[];

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT_MARGIN = 42;
const TOP_MARGIN = 748;
const LINE_HEIGHT = 14;
const MAX_TEXT_LENGTH = 80;

function safeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s\S]/gu, (character) => (character.codePointAt(0)! <= 0xff ? character : "?"))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function drawMember(
  page: PDFPage,
  member: MemberProjection,
  y: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
): number {
  const values = reportColumns.map(([field, label]) => `${label}: ${safeText(member[field])}`);
  const lines = values.reduce<string[]>((result, value) => {
    if (result.length === 0) {
      result.push(value);
      return result;
    }
    const previous = result[result.length - 1] ?? "";
    if (`${previous} | ${value}`.length <= 115) {
      result[result.length - 1] = `${previous} | ${value}`;
    } else {
      result.push(value);
    }
    return result;
  }, []);

  for (const line of lines) {
    page.drawText(line, { x: LEFT_MARGIN, y, size: 7, font });
    y -= LINE_HEIGHT;
  }
  return y - 8;
}

export const createMemberReportPdf: MemberReportPdfGenerator = async (report, members) => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.setTitle(`BPT Jersey member report: ${report}`);
  document.setCreator("BPT Jersey Academy Platform");

  let page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = TOP_MARGIN;
  page.drawText(`BPT Jersey member report: ${report}`, { x: LEFT_MARGIN, y, size: 16, font });
  y -= 28;
  page.drawText(`Members: ${members.length}`, { x: LEFT_MARGIN, y, size: 9, font });
  y -= 24;

  if (members.length === 0) {
    page.drawText("No members found.", { x: LEFT_MARGIN, y, size: 9, font });
  }

  for (const member of members) {
    if (y < 80) {
      page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = TOP_MARGIN;
    }
    page.drawText("Member", { x: LEFT_MARGIN, y, size: 9, font });
    y = drawMember(page, member, y - LINE_HEIGHT, font);
  }

  return document.save({ useObjectStreams: true });
};
