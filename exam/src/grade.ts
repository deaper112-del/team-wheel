import { normalizeBlankToken, normalizeExact } from "./text";
import type {
  AnswerEntry,
  AnswerKey,
  FileContent,
  GradeItem,
  GradeReport,
  GradeStatus,
  Paper,
  Question,
  ResponseValue,
} from "./types";

export interface KeyProblems {
  missingIds: string[];
  invalidIds: string[];
  extraIds: string[];
}

function addPoints(left: number, right: number): number {
  return Math.round((left + right) * 100) / 100;
}

export function formatChoice(index: number, options: string[]): string {
  const letter = index >= 0 && index < 26 ? String.fromCharCode(65 + index) : `#${index}`;
  const text = options[index];
  return text ? `${letter}. ${text}` : letter;
}

export function formatChoiceList(indices: number[], options: string[]): string {
  return [...indices]
    .sort((left, right) => left - right)
    .map((index) => formatChoice(index, options))
    .join("、");
}

function sameSet(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Set(right);
  return left.every((index) => values.has(index));
}

function normalizeSingle(answer: unknown, options: string[]): number | null {
  const value = Array.isArray(answer) && answer.length === 1 ? answer[0] : answer;
  if (typeof value === "number" && Number.isInteger(value)) {
    return value >= 0 && value < options.length ? value : null;
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).normalize("NFKC").trim();
  if (!text) return null;
  // A single letter is an option letter. A pure integer is a zero-based index.
  // Anything else is matched against the option text.
  if (/^[A-Za-z]$/.test(text)) {
    const index = text.toUpperCase().charCodeAt(0) - 65;
    if (index >= 0 && index < options.length) return index;
  }
  if (/^\d+$/.test(text)) {
    const index = Number(text);
    if (index >= 0 && index < options.length) return index;
  }
  const norm = normalizeBlankToken(text);
  const found = options.findIndex((option) => normalizeBlankToken(option) === norm);
  return found >= 0 ? found : null;
}

function tokenizeMultiple(answer: unknown, options: string[]): unknown[] | null {
  if (Array.isArray(answer)) {
    const tokens: unknown[] = [];
    for (const item of answer) {
      if (typeof item === "string" && /[,，、;；|]/.test(item)) {
        tokens.push(
          ...item
            .split(/[,，、;；|]+/)
            .map((part) => part.trim())
            .filter(Boolean),
        );
      } else if (item != null && item !== "") {
        tokens.push(item);
      }
    }
    return tokens;
  }
  if (typeof answer === "number") return [answer];
  if (typeof answer !== "string") return null;
  const text = answer.normalize("NFKC").trim();
  if (!text) return null;
  if (options.some((option) => normalizeBlankToken(option) === normalizeBlankToken(text))) return [text];
  if (/^[A-Za-z]{2,}$/.test(text)) return text.split("");
  if (/[,，、;；|]/.test(text)) {
    return text
      .split(/[,，、;；|]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (/\s+/.test(text)) return text.split(/\s+/).filter(Boolean);
  return [text];
}

function normalizeMultiple(answer: unknown, options: string[]): number[] | null {
  const tokens = tokenizeMultiple(answer, options);
  if (!tokens || tokens.length === 0) return null;
  const indices: number[] = [];
  for (const token of tokens) {
    const index = normalizeSingle(token, options);
    if (index == null) return null;
    if (!indices.includes(index)) indices.push(index);
  }
  return indices.length > 0 ? indices : null;
}

const TRUE_WORDS = new Set(["对", "正确", "是", "true", "t", "yes", "y", "√", "✓", "1"]);
const FALSE_WORDS = new Set(["错", "错误", "否", "false", "f", "no", "n", "×", "✗", "0"]);

function normalizeJudge(answer: unknown): boolean | null {
  if (typeof answer === "boolean") return answer;
  if (typeof answer === "number") {
    if (answer === 1) return true;
    if (answer === 0) return false;
    return null;
  }
  if (typeof answer !== "string") return null;
  const text = answer.normalize("NFKC").trim().toLowerCase();
  if (TRUE_WORDS.has(text)) return true;
  if (FALSE_WORDS.has(text)) return false;
  return null;
}

function parseBlankAnswer(answer: unknown, count: number, excel: boolean): string[][] | null {
  if (typeof answer === "string" || typeof answer === "number" || typeof answer === "boolean") {
    const text = String(answer).trim();
    if (!text) return null;
    if (excel && (text.includes("|") || text.includes("/"))) {
      const slots = text.split("|").map((part) =>
        part
          .split("/")
          .map((item) => item.trim())
          .filter(Boolean),
      );
      if (slots.length !== count || slots.some((slot) => slot.length === 0)) return null;
      return slots;
    }
    if (count !== 1) return null;
    return [[text]];
  }
  if (!Array.isArray(answer)) return null;

  if (answer.some((item) => Array.isArray(item))) {
    if (answer.length !== count) return null;
    const slots = answer.map((item) => {
      if (Array.isArray(item)) return item.map((value) => String(value).trim()).filter(Boolean);
      const text = String(item ?? "").trim();
      return text ? [text] : [];
    });
    if (slots.some((slot) => slot.length === 0)) return null;
    return slots;
  }

  const texts = answer.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (texts.length === 0) return null;
  if (texts.length === count) return texts.map((text) => [text]);
  if (count === 1) return [texts];
  return null;
}

function blankMatches(candidate: string, accepted: string[]): boolean {
  const norm = normalizeBlankToken(candidate);
  if (!norm) return false;
  return accepted.some((item) => normalizeBlankToken(item) === norm);
}

function referenceText(answer: unknown): string {
  if (typeof answer === "string") return answer.trim();
  if (typeof answer === "number" || typeof answer === "boolean") return String(answer);
  return "";
}

function keywordsOf(entry: AnswerEntry): string[] {
  return entry.keywords.map((keyword) => keyword.trim()).filter(Boolean);
}

function shortReference(entry: AnswerEntry): string | null {
  const text = referenceText(entry.answer);
  const keywords = keywordsOf(entry);
  if (!text && keywords.length === 0) return null;
  if (keywords.length === 0) return text;
  return text ? `${text}\n关键词：${keywords.join("、")}` : `关键词：${keywords.join("、")}`;
}

export function isAnswered(question: Question, response: ResponseValue | undefined): boolean {
  if (!response || response.type !== question.type) return false;
  switch (response.type) {
    case "single":
      return response.index != null;
    case "multiple":
      return response.indices.length > 0;
    case "judge":
      return response.value != null;
    case "blank":
      return response.values.some((value) => value.trim() !== "");
    case "short":
      return response.text.trim() !== "";
  }
}

export function countAnswered(
  questions: Question[],
  responses: Record<string, ResponseValue | undefined>,
): number {
  return questions.filter((question) => isAnswered(question, responses[question.id])).length;
}

function yoursText(question: Question, response: ResponseValue | undefined): string {
  if (!isAnswered(question, response) || !response) return "未作答";
  switch (response.type) {
    case "single":
      return response.index == null ? "未作答" : formatChoice(response.index, question.options);
    case "multiple":
      return response.indices.length === 0 ? "未作答" : formatChoiceList(response.indices, question.options);
    case "judge":
      return response.value == null ? "未作答" : response.value ? "对" : "错";
    case "blank":
      return response.values.map((value) => value.trim() || "（空）").join("；");
    case "short":
      return response.text.trim();
  }
}

interface Graded {
  earned: number;
  status: GradeStatus;
  reference: string;
  note: string;
}

function gradeQuestion(
  question: Question,
  entry: AnswerEntry,
  response: ResponseValue | undefined,
): Graded | null {
  const answered = isAnswered(question, response);
  if (question.type === "single") {
    const index = normalizeSingle(entry.answer, question.options);
    if (index == null) return null;
    const reference = formatChoice(index, question.options);
    if (!answered || !response || response.type !== "single" || response.index == null) {
      return { earned: 0, status: "blank", reference, note: "" };
    }
    const perfect = response.index === index;
    return { earned: perfect ? question.score : 0, status: perfect ? "correct" : "incorrect", reference, note: "" };
  }

  if (question.type === "multiple") {
    const indices = normalizeMultiple(entry.answer, question.options);
    if (!indices) return null;
    const reference = formatChoiceList(indices, question.options);
    if (!answered || !response || response.type !== "multiple") {
      return { earned: 0, status: "blank", reference, note: "" };
    }
    const perfect = sameSet(response.indices, indices);
    return { earned: perfect ? question.score : 0, status: perfect ? "correct" : "incorrect", reference, note: "" };
  }

  if (question.type === "judge") {
    const expected = normalizeJudge(entry.answer);
    if (expected == null) return null;
    const reference = expected ? "对" : "错";
    if (!answered || !response || response.type !== "judge" || response.value == null) {
      return { earned: 0, status: "blank", reference, note: "" };
    }
    const perfect = response.value === expected;
    return { earned: perfect ? question.score : 0, status: perfect ? "correct" : "incorrect", reference, note: "" };
  }

  if (question.type === "blank") {
    const slots = parseBlankAnswer(entry.answer, question.blanks, entry.excel);
    if (!slots) return null;
    const reference = slots.map((slot) => slot.join(" / ")).join("；");
    if (!answered || !response || response.type !== "blank") {
      return { earned: 0, status: "blank", reference, note: "" };
    }
    const perfect = slots.every((slot, index) => blankMatches(response.values[index] ?? "", slot));
    return { earned: perfect ? question.score : 0, status: perfect ? "correct" : "incorrect", reference, note: "" };
  }

  const reference = shortReference(entry);
  if (reference == null) return null;
  if (!answered || !response || response.type !== "short") {
    return { earned: 0, status: "blank", reference, note: "" };
  }
  const keywords = keywordsOf(entry);
  if (keywords.length > 0) {
    const haystack = normalizeExact(response.text);
    const hits = keywords.filter((keyword) => haystack.includes(normalizeExact(keyword)));
    const ratio = Math.round((hits.length / keywords.length) * question.score);
    const earned =
      hits.length === keywords.length
        ? question.score
        : Math.min(question.score, Math.max(0, ratio));
    const perfect = hits.length === keywords.length || (question.score > 0 && earned >= question.score);
    const status: GradeStatus = perfect ? "correct" : earned <= 0 ? "incorrect" : "partial";
    return {
      earned,
      status,
      reference,
      note: `命中 ${hits.length}/${keywords.length} 个关键词`,
    };
  }
  const perfect = normalizeExact(response.text) === normalizeExact(referenceText(entry.answer));
  return {
    earned: perfect ? question.score : 0,
    status: perfect ? "correct" : "incorrect",
    reference,
    note: "",
  };
}

export function gradePaper(
  paper: Paper,
  key: AnswerKey,
  responses: Record<string, ResponseValue | undefined>,
): GradeReport {
  const items: GradeItem[] = [];
  const missingIds: string[] = [];
  const invalidIds: string[] = [];
  let total = 0;
  let gradedMax = 0;
  let paperMax = 0;

  for (const question of paper.questions) {
    paperMax = addPoints(paperMax, question.score);
    const response = responses[question.id];
    const yours = yoursText(question, response);
    const entry = key.byId[question.id];
    const base = {
      id: question.id,
      type: question.type,
      stem: question.stem,
      score: question.score,
      yours,
    };
    if (!entry) {
      missingIds.push(question.id);
      items.push({
        ...base,
        earned: 0,
        status: "ungraded",
        reference: "答案文件中没有这道题",
        note: "",
      });
      continue;
    }
    const graded = gradeQuestion(question, entry, response);
    if (!graded) {
      invalidIds.push(question.id);
      items.push({
        ...base,
        earned: 0,
        status: "ungraded",
        reference: "答案无法识别",
        note: "",
      });
      continue;
    }
    total = addPoints(total, graded.earned);
    gradedMax = addPoints(gradedMax, question.score);
    items.push({ ...base, ...graded });
  }

  return { total, gradedMax, paperMax, items, missingIds, invalidIds };
}

export function describeKeyProblems(paper: Paper, key: AnswerKey): KeyProblems {
  const missingIds: string[] = [];
  const invalidIds: string[] = [];
  for (const question of paper.questions) {
    const entry = key.byId[question.id];
    if (!entry) {
      missingIds.push(question.id);
      continue;
    }
    if (gradeQuestion(question, entry, undefined) == null) invalidIds.push(question.id);
  }
  const known = new Set(paper.questions.map((question) => question.id));
  const extraIds = Object.keys(key.byId).filter((id) => !known.has(id));
  return { missingIds, invalidIds, extraIds };
}

export function warningText(problems: KeyProblems): string {
  const lines: string[] = [];
  if (problems.missingIds.length > 0) {
    lines.push(`答案文件缺少这些题号，交卷后无法评分：${problems.missingIds.join("、")}。`);
  }
  if (problems.invalidIds.length > 0) {
    lines.push(`这些题号的答案无法识别，交卷后无法评分：${problems.invalidIds.join("、")}。`);
  }
  if (problems.extraIds.length > 0) {
    lines.push(`答案里有题目中不存在的题号，已忽略：${problems.extraIds.join("、")}。`);
  }
  return lines.join("");
}

export type CombineOutcome =
  | { ok: true; paper: Paper; key: AnswerKey; warning: string }
  | { ok: false; error: string; paper: Paper | null; key: AnswerKey | null; pending: boolean };

export function combineUploads(
  questionFile: FileContent | null,
  answerFile: FileContent | null,
): CombineOutcome {
  const paper = questionFile?.paper ?? answerFile?.paper ?? null;
  const key = answerFile?.key ?? questionFile?.key ?? null;
  if (!paper && !key) {
    return { ok: false, error: "请上传题目文件和答案文件。", paper: null, key: null, pending: true };
  }
  if (!paper) {
    return { ok: false, error: "还需要上传题目文件。", paper: null, key, pending: true };
  }
  if (!key) {
    return {
      ok: false,
      error: "还需要上传答案文件。如果题目 Excel 里已经有「答案」表，可以只上传那一个文件。",
      paper,
      key: null,
      pending: true,
    };
  }
  const problems = describeKeyProblems(paper, key);
  if (problems.missingIds.length === paper.questions.length) {
    return {
      ok: false,
      error: "答案文件与题目的题号对不上，没有可以评分的题。",
      paper,
      key,
      pending: false,
    };
  }
  return { ok: true, paper, key, warning: warningText(problems) };
}
