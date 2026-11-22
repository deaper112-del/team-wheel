import * as XLSX from "xlsx";

export const QUESTION_HEADERS = [
  "题号",
  "题型",
  "题干",
  "选项A",
  "选项B",
  "选项C",
  "选项D",
  "选项E",
  "选项F",
  "分值",
  "空数",
] as const;

export const ANSWER_HEADERS = ["题号", "答案", "关键词"] as const;

export function questionTemplateText(): string {
  return `${JSON.stringify({ title: "", durationMinutes: null, questions: [] }, null, 2)}\n`;
}

export function answerTemplateText(): string {
  return `${JSON.stringify({ answers: [] }, null, 2)}\n`;
}

export function templateXlsxBytes(): Uint8Array {
  const questions = XLSX.utils.aoa_to_sheet([[...QUESTION_HEADERS]]);
  const answers = XLSX.utils.aoa_to_sheet([[...ANSWER_HEADERS]]);
  questions["!cols"] = [
    { wch: 10 },
    { wch: 10 },
    { wch: 36 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 8 },
    { wch: 8 },
  ];
  answers["!cols"] = [{ wch: 10 }, { wch: 28 }, { wch: 24 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, questions, "题目");
  XLSX.utils.book_append_sheet(workbook, answers, "答案");
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  if (output instanceof Uint8Array) return output;
  if (output instanceof ArrayBuffer) return new Uint8Array(output);
  return Uint8Array.from(output as number[]);
}

export function templateWorkbook(): ArrayBuffer {
  const bytes = templateXlsxBytes();
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
