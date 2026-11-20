import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ParseOutcome } from "./parse";
import { isAnswerDocument, linesFromItems, parseExamLines, type PdfTextItem } from "./pdfPaper";

interface PdfTextRun {
  str: string;
  width: number;
  transform: number[];
}

function isTextRun(item: unknown): item is PdfTextRun {
  if (typeof item !== "object" || item === null) return false;
  const run = item as Partial<PdfTextRun>;
  return typeof run.str === "string" && typeof run.width === "number" && Array.isArray(run.transform);
}

export async function parsePdfBuffer(buffer: ArrayBuffer): Promise<ParseOutcome> {
  try {
    const document = await getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    const pages: PdfTextItem[][] = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const runs: PdfTextItem[] = [];
      for (const item of content.items) {
        if (!isTextRun(item)) continue;
        runs.push({
          str: item.str,
          x: item.transform[4] ?? 0,
          y: item.transform[5] ?? 0,
          width: item.width,
        });
      }
      pages.push(runs);
    }
    const plain = pages.flatMap((page) => linesFromItems(page, false));
    const lines = isAnswerDocument(plain) ? plain : pages.flatMap((page) => linesFromItems(page, true));
    return parseExamLines(lines);
  } catch {
    return { ok: false, error: "无法读取这份 PDF。请确认文件没有密码，或改用 JSON / Excel。" };
  }
}
