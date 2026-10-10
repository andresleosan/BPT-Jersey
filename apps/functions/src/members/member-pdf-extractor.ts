import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { formatMemberPdfTextItems } from "./member-pdf-text.js";

const pdfjsRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));

export async function extractMemberPdfText(bytes: Uint8Array): Promise<string> {
  // Loaded on demand: every function imports this bundle, and PDF.js at startup pushed them past 256MiB.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    // PDF.js may transfer ownership of typed arrays to its worker. Keep the source intact because
    // the import flow hashes it after parsing to bind the preview to the uploaded object.
    data: bytes.slice(),
    cMapUrl: join(pdfjsRoot, "cmaps") + "/",
    cMapPacked: true,
    standardFontDataUrl: join(pdfjsRoot, "standard_fonts") + "/",
    stopAtErrors: true,
    useWorkerFetch: false,
    wasmUrl: join(pdfjsRoot, "wasm") + "/",
  });
  try {
    const document = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: true });
      pages.push(
        formatMemberPdfTextItems(
          content.items.flatMap((item) => {
            if (!("str" in item)) return [];
            const x = item.transform[4];
            const y = item.transform[5];
            return typeof x === "number" &&
              typeof y === "number" &&
              Number.isFinite(x) &&
              Number.isFinite(y)
              ? [{ page: pageNumber, str: item.str, x, y }]
              : [];
          }),
        ),
      );
    }
    return pages.map((page) => `\n\n${page}`).join("");
  } finally {
    await loadingTask.destroy();
  }
}
