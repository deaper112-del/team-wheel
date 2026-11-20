import * as XLSX from "xlsx";
import { countBlankMarkers } from "./blanks";
import { splitList } from "./text";
import type { AnswerEntry, AnswerKey, FileContent, Paper, Question, QuestionType } from "./types";

export type ParseOutcome = { ok: true; content: FileContent } | { ok: false; error: string };

const TYPE_MAP: Record<string, QuestionType> = {
  single: "single",
  multiple: "multiple",
  judge: "judge",
  blank: "blank",
  short: "short",
  单选: "single",
  单选题: "single",
  多选: "multiple",
  多选题: "multiple",
  判断: "judge",
  判断题: "judge",
  填空: "blank",
  填空题: "blank",
  简答: "short",
  简答题: "short",
};

const OPTION_HEADERS = ["选项A", "选项B", "选项C", "选项D", "选项E", "选项F"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeType(value: unknown): QuestionType | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return TYPE_MAP[text] ?? TYPE_MAP[text.toLowerCase()] ?? null;
}

function parseScore(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function parseDuration(value: unknown): number | null | "invalid" {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return "invalid";
  return parsed;
}

function positiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return parsed > 0 ? parsed : null;
  }
  return null;
}

function parseKeywords(value: unknown, id: string): { keywords: string[] } | { error: string } {
  if (value == null || value === "") return { keywords: [] };
  if (typeof value === "string") return { keywords: splitList(value) };
  if (Array.isArray(value)) return { keywords: value.map((item) => String(item).trim()).filter(Boolean) };
  return { error: `题号「${id}」的关键词格式无法识别。` };
}

function parseQuestion(raw: unknown, index: number): { question: Question } | { error: string } {
  const fallback = `第 ${index + 1} 题`;
  if (!isRecord(raw)) return { error: `${fallback}不是对象。` };
  const id = raw.id == null ? "" : String(raw.id).trim();
  const where = id ? `题号「${id}」` : fallback;
  if (!id) return { error: `${where}缺少题号 id。` };
  const type = normalizeType(raw.type);
  if (!type) return { error: `${where}的题型无法识别。` };
  if (typeof raw.stem !== "string" || !raw.stem.trim()) return { error: `${where}缺少题干。` };
  const stem = raw.stem.trim();
  const score = parseScore(raw.score);
  if (score == null) return { error: `${where}的分值无效。` };

  let options: string[] = [];
  if (type === "single" || type === "multiple") {
    if (!Array.isArray(raw.options) || raw.options.length < 2) return { error: `${where}至少需要两个选项。` };
    if (raw.options.length > 26) return { error: `${where}的选项超过 26 个。` };
    options = [];
    for (const item of raw.options) {
      if (item == null || (typeof item !== "string" && typeof item !== "number")) {
        return { error: `${where}的选项格式无法识别。` };
      }
      const text = String(item).trim();
      if (!text) return { error: `${where}有空选项。` };
      options.push(text);
    }
  }

  let blanks = 0;
  if (type === "blank") {
    if (raw.blanks == null || raw.blanks === "") {
      blanks = countBlankMarkers(stem);
    } else {
      const parsed = positiveInt(raw.blanks);
      if (parsed == null) return { error: `${where}的空数无效。` };
      blanks = parsed;
    }
    if (blanks < 1) return { error: `${where}的填空数量无效。` };
    if (blanks > 20) return { error: `${where}的空太多。` };
  }

  return { question: { id, type, stem, options, blanks, score } };
}

function parsePaperObject(data: Record<string, unknown>): { paper: Paper } | { error: string } {
  if (!Array.isArray(data.questions)) return { error: "题目文件缺少 questions 数组。" };
  if (data.questions.length === 0) return { error: "题目文件中没有题目。" };
  const title = typeof data.title === "string" && data.title.trim() ? data.title.trim() : "在线考试";
  const duration = parseDuration(data.durationMinutes);
  if (duration === "invalid") return { error: "durationMinutes 需要是大于 0 的分钟数。" };
  const questions: Question[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < data.questions.length; index += 1) {
    const parsed = parseQuestion(data.questions[index], index);
    if ("error" in parsed) return parsed;
    if (seen.has(parsed.question.id)) return { error: `题号「${parsed.question.id}」重复。` };
    seen.add(parsed.question.id);
    questions.push(parsed.question);
  }
  return { paper: { title, durationMinutes: duration, questions } };
}

function parseKeyObject(data: Record<string, unknown>, excel: boolean): { key: AnswerKey } | { error: string } {
  if (!Array.isArray(data.answers)) return { error: "答案文件缺少 answers 数组。" };
  if (data.answers.length === 0) return { error: "答案文件中没有答案。" };
  const byId: Record<string, AnswerEntry> = {};
  for (let index = 0; index < data.answers.length; index += 1) {
    const raw: unknown = data.answers[index];
    if (!isRecord(raw)) return { error: `第 ${index + 1} 条答案不是对象。` };
    const id = raw.id == null ? "" : String(raw.id).trim();
    if (!id) return { error: `第 ${index + 1} 条答案缺少题号。` };
    if (byId[id]) return { error: `答案题号「${id}」重复。` };
    if (raw.answer === undefined) return { error: `题号「${id}」缺少 answer。` };
    const keywords = parseKeywords(raw.keywords, id);
    if ("error" in keywords) return keywords;
    byId[id] = { id, answer: raw.answer, keywords: keywords.keywords, excel };
  }
  return { key: { byId } };
}

export function parseJsonText(text: string): ParseOutcome {
  const source = text.replace(/^\uFEFF/, "").trim();
  if (!source) return { ok: false, error: "文件是空的。" };
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return { ok: false, error: "文件不是有效的 JSON。" };
  }
  if (!isRecord(data)) return { ok: false, error: "JSON 需要是包含 questions 或 answers 的对象。" };
  const hasQuestions = "questions" in data;
  const hasAnswers = "answers" in data;
  if (!hasQuestions && !hasAnswers) {
    return { ok: false, error: "文件里没有题目或答案。题目需要 questions，答案需要 answers。" };
  }
  let paper: Paper | null = null;
  let key: AnswerKey | null = null;
  if (hasQuestions) {
    const parsed = parsePaperObject(data);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    paper = parsed.paper;
  }
  if (hasAnswers) {
    const parsed = parseKeyObject(data, false);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    key = parsed.key;
  }
  return { ok: true, content: { paper, key } };
}

function normHeader(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function headerList(sheet: XLSX.WorkSheet): string[] {
  const ref = sheet["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const headers: string[] = [];
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: column })];
    headers.push(cell ? String((cell as XLSX.CellObject).v ?? "").trim() : "");
  }
  return headers;
}

function hasHeaders(headers: string[], required: string[]): boolean {
  const present = new Set(headers.map(normHeader));
  return required.every((item) => present.has(normHeader(item)));
}

function classifySheet(sheet: XLSX.WorkSheet): "question" | "answer" | "unknown" {
  const headers = headerList(sheet).map(normHeader);
  if (headers.includes(normHeader("题干")) || headers.includes(normHeader("题型"))) return "question";
  if (headers.includes(normHeader("答案")) || headers.includes(normHeader("关键词"))) return "answer";
  return "unknown";
}

function sheetRows(sheet: XLSX.WorkSheet): Record<string, unknown>[] {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
}

function pick(row: Record<string, unknown>, aliases: string[]): unknown {
  for (const [key, value] of Object.entries(row)) {
    const norm = normHeader(key);
    if (aliases.some((alias) => normHeader(alias) === norm)) return value;
  }
  return "";
}

function textOf(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return String(value).trim();
}

function plainAnswer(value: unknown): string | number | boolean {
  if (typeof value === "number" || typeof value === "boolean") return value;
  return textOf(value);
}

function readOptions(
  row: Record<string, unknown>,
  type: QuestionType,
  where: string,
): { options: string[] } | { error: string } {
  if (type !== "single" && type !== "multiple") return { options: [] };
  const raw = OPTION_HEADERS.map((header) => textOf(pick(row, [header])));
  let last = -1;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index]) last = index;
  }
  const options = raw.slice(0, last + 1);
  if (options.length < 2) return { error: `${where}至少需要两个选项。` };
  if (options.some((option) => !option)) return { error: `${where}的选项请从 A 起连续填写。` };
  return { options };
}

function readBlanks(
  row: Record<string, unknown>,
  type: QuestionType,
  stem: string,
  where: string,
): { blanks: number } | { error: string } {
  if (type !== "blank") return { blanks: 0 };
  const text = textOf(pick(row, ["空数", "blanks"]));
  let blanks = 0;
  if (text) {
    const parsed = positiveInt(text);
    if (parsed == null) return { error: `${where}的空数无效。` };
    blanks = parsed;
  } else {
    blanks = countBlankMarkers(stem);
  }
  if (blanks < 1) return { error: `${where}的填空数量无效。` };
  if (blanks > 20) return { error: `${where}的空太多。` };
  return { blanks };
}

function parseQuestionSheet(sheet: XLSX.WorkSheet): { paper: Paper } | { error: string } {
  const headers = headerList(sheet);
  if (!hasHeaders(headers, ["题号", "题型", "题干", "分值"])) {
    return { error: "题目表缺少表头：题号、题型、题干、分值。" };
  }
  const rows = sheetRows(sheet);
  const questions: Question[] = [];
  const seen = new Set<string>();
  let durationMinutes: number | null = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const id = textOf(pick(row, ["题号", "id"]));
    const typeText = textOf(pick(row, ["题型", "type"]));
    const stem = textOf(pick(row, ["题干", "stem"]));
    if (!id && !typeText && !stem) continue;
    const where = id ? `题号「${id}」` : `题目表第 ${index + 2} 行`;
    if (!id) return { error: `${where}缺少题号。` };
    if (seen.has(id)) return { error: `题号「${id}」重复。` };
    const type = normalizeType(typeText);
    if (!type) return { error: `${where}的题型无法识别。请填写单选、多选、判断、填空或简答。` };
    if (!stem) return { error: `${where}缺少题干。` };
    const score = parseScore(pick(row, ["分值", "分数", "score"]));
    if (score == null) return { error: `${where}的分值无效。` };
    const optionResult = readOptions(row, type, where);
    if ("error" in optionResult) return optionResult;
    const blanksResult = readBlanks(row, type, stem, where);
    if ("error" in blanksResult) return blanksResult;
    if (durationMinutes == null) {
      const duration = parseDuration(pick(row, ["时长", "durationMinutes"]));
      if (duration === "invalid") return { error: "时长需要是大于 0 的分钟数。" };
      durationMinutes = duration;
    }
    seen.add(id);
    questions.push({
      id,
      type,
      stem,
      options: optionResult.options,
      blanks: blanksResult.blanks,
      score,
    });
  }
  if (questions.length === 0) return { error: "题目表中没有题目。" };
  return { paper: { title: "在线考试", durationMinutes, questions } };
}

function parseAnswerSheet(sheet: XLSX.WorkSheet): { key: AnswerKey } | { error: string } {
  const headers = headerList(sheet);
  if (!hasHeaders(headers, ["题号", "答案"])) {
    return { error: "答案表缺少表头：题号、答案。" };
  }
  const rows = sheetRows(sheet);
  const byId: Record<string, AnswerEntry> = {};
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const id = textOf(pick(row, ["题号", "id"]));
    const answerValue = pick(row, ["答案", "answer"]);
    const keywordText = textOf(pick(row, ["关键词", "keywords"]));
    const answerEmpty = textOf(answerValue) === "";
    if (!id && answerEmpty && !keywordText) continue;
    if (!id) return { error: `答案表第 ${index + 2} 行缺少题号。` };
    if (answerEmpty) return { error: `题号「${id}」缺少答案。` };
    if (byId[id]) return { error: `答案题号「${id}」重复。` };
    byId[id] = { id, answer: plainAnswer(answerValue), keywords: splitList(keywordText), excel: true };
  }
  if (Object.keys(byId).length === 0) return { error: "答案表中没有答案。" };
  return { key: { byId } };
}

function findNamed(workbook: XLSX.WorkBook, names: string[]): string | null {
  const wanted = new Set(names.map(normHeader));
  return workbook.SheetNames.find((name) => wanted.has(normHeader(name))) ?? null;
}

export function parseWorkbook(workbook: XLSX.WorkBook): ParseOutcome {
  if (workbook.SheetNames.length === 0) return { ok: false, error: "Excel 里没有工作表。" };
  let questionName = findNamed(workbook, ["题目", "questions"]);
  let answerName = findNamed(workbook, ["答案", "answers"]);
  const used = new Set([questionName, answerName].filter((name): name is string => Boolean(name)));
  for (const name of workbook.SheetNames) {
    if (used.has(name)) continue;
    const kind = classifySheet(workbook.Sheets[name]);
    if (!questionName && kind === "question") {
      questionName = name;
      used.add(name);
    } else if (!answerName && kind === "answer") {
      answerName = name;
      used.add(name);
    }
  }
  if (!questionName && !answerName) {
    return {
      ok: false,
      error: "无法识别工作表。题目表需要表头「题号、题型、题干、分值」，答案表需要表头「题号、答案」。",
    };
  }
  let paper: Paper | null = null;
  let key: AnswerKey | null = null;
  if (questionName) {
    const parsed = parseQuestionSheet(workbook.Sheets[questionName]);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    paper = parsed.paper;
  }
  if (answerName) {
    const parsed = parseAnswerSheet(workbook.Sheets[answerName]);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    key = parsed.key;
  }
  return { ok: true, content: { paper, key } };
}

export function parseXlsxBuffer(buffer: ArrayBuffer): ParseOutcome {
  const bytes = new Uint8Array(buffer);
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf;
  if (!zip && !ole) return { ok: false, error: "无法读取这份 Excel，请确认它是 .xlsx 文件。" };
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "array", cellDates: false });
  } catch {
    return { ok: false, error: "无法读取这份 Excel，请确认它是 .xlsx 文件。" };
  }
  return parseWorkbook(workbook);
}

function detectKind(name: string, buffer: ArrayBuffer): "json" | "xlsx" | "unknown" {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "xlsx";
  const bytes = new Uint8Array(buffer.slice(0, 8));
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "xlsx";
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return "xlsx";
  const head = new TextDecoder()
    .decode(new Uint8Array(buffer.slice(0, 64)))
    .replace(/^\uFEFF/, "")
    .trim();
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  return "unknown";
}

function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").trim();
  return base || "在线考试";
}

export async function parseExamFile(file: File): Promise<ParseOutcome> {
  if (file.size === 0) return { ok: false, error: "文件是空的。" };
  if (file.size > 8 * 1024 * 1024) return { ok: false, error: "文件超过 8MB，请换一份更小的文件。" };
  const buffer = await file.arrayBuffer();
  const kind = detectKind(file.name, buffer);
  if (kind === "json") return parseJsonText(new TextDecoder().decode(buffer));
  if (kind === "xlsx") {
    const parsed = parseXlsxBuffer(buffer);
    if (parsed.ok && parsed.content.paper) {
      parsed.content.paper = { ...parsed.content.paper, title: titleFromFileName(file.name) };
    }
    return parsed;
  }
  return { ok: false, error: "无法识别文件。请上传 JSON 或 Excel（.xlsx）。" };
}
