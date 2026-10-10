import { createHash } from "node:crypto";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { expect, it } from "vitest";

import { extractMemberPdfText } from "./member-pdf-extractor.js";

it("extracts positioned text from every page without consuming the source bytes", async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([600, 800]);
  first.drawText("Member Name", { x: 40, y: 740, font, size: 12 });
  first.drawText("Synthetic Student", { x: 180, y: 740, font, size: 12 });
  const second = document.addPage([600, 800]);
  second.drawText("Training Centre", { x: 40, y: 740, font, size: 12 });
  second.drawText("St Helier", { x: 180, y: 740, font, size: 12 });
  const bytes = await document.save();
  const before = createHash("sha256").update(bytes).digest("hex");

  const text = await extractMemberPdfText(bytes);

  expect(text).toContain("Member Name");
  expect(text).toContain("Synthetic Student");
  expect(text).toContain("Training Centre");
  expect(text).toContain("St Helier");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(before);
});

it("rejects malformed PDF input", async () => {
  await expect(extractMemberPdfText(new TextEncoder().encode("%PDF-invalid"))).rejects.toThrow();
});
