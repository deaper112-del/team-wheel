import type { AnswerEntry, AnswerKey, Paper, Question, QuestionType } from "./types";
import type { ParseOutcome } from "./parse";

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

const SECTION_RE = /^([一二三四五六七八九十]+)、\s*(.+)$/;
const QUESTION_RE = /^(\d{1,3})[.．、]\s*(.*)$/;
const OPTION_RE = /^([A-F])[.．、]\s*(.*)$/;
const FOOTER_RE = /(?:考试题|标准答案|答案)\s*\d+\s*\/\s*\d+\s*$/;
const LETTER_SPACED_RE = /^(?:[\u4e00-\u9fffA-Za-z][ \u3000]){3,}/;
const BLANK_MARK = "____";
const WIDE_SPACE = 36;

const SECTION_KIND: Array<{ pattern: RegExp; type: QuestionType; label: string }> = [
  { pattern: /多选|多项/, type: "multiple", label: "多选" },
  { pattern: /判断/, type: "judge", label: "判断" },
  { pattern: /填空/, type: "blank", label: "填空" },
  { pattern: /简答/, type: "short", label: "简答" },
  { pattern: /单选|单项|选择题/, type: "single", label: "选择" },
];

const ANCHORS = [
  "现代生活",
  "少数中产",
  "家庭",
  "自我表达",
  "疲惫",
  "共享",
  "简约",
  "重新连接",
  "推翻",
  "打断",
  "个人取向",
  "单向",
  "感知",
  "承诺",
  "校验",
  "预期",
  "接触前",
  "选择比较",
  "购买等待",
  "使用在场",
  "售后再来",
  "强制拼桌",
  "出品",
  "一视同仁",
  "补救",
  "催单",
  "等候",
];

const ORDINALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

interface Section {
  type: QuestionType;
  label: string;
  perQuestion: number | null;
  perBlank: number | null;
}

function clean(value: string): string {
  return value.replace(/^[，,、;；\s]+|[，,、;；。.\s]+$/g, "").trim();
}

function ordinal(text: string): number | null {
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    return value >= 1 ? value - 1 : null;
  }
  const index = ORDINALS.indexOf(text);
  return index >= 0 ? index : null;
}

function sectionOf(line: string): Section | null {
  const match = line.match(SECTION_RE);
  if (!match) return null;
  const title = match[2];
  const found = SECTION_KIND.find((item) => item.pattern.test(title));
  if (!found) return null;
  const perQuestion = title.match(/每题\s*(\d+(?:\.\d+)?)\s*分/);
  const perBlank = title.match(/每空\s*(\d+(?:\.\d+)?)\s*分/);
  return {
    type: found.type,
    label: found.label,
    perQuestion: perQuestion ? Number(perQuestion[1]) : null,
    perBlank: perBlank ? Number(perBlank[1]) : null,
  };
}

function scoreInText(text: string): number | null {
  const matches = [...text.matchAll(/[（(]\s*(\d+(?:\.\d+)?)\s*分\s*[)）]/g)];
  if (matches.length === 0) return null;
  return Number(matches[matches.length - 1][1]);
}

function isFooter(line: string): boolean {
  return FOOTER_RE.test(line) || LETTER_SPACED_RE.test(line);
}

function paperTitle(lines: string[]): string {
  const heading = lines.find((line) => /《.+》/.test(line) && /考试|解读|测验|试卷/.test(line));
  const source = heading ?? lines.find((line) => line.includes("《")) ?? "";
  const title = source
    .replace(/考试题|标准答案|参考答案|答案/g, "")
    .replace(/[《》]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return title || "在线考试";
}

function hardDuration(lines: string[]): number | null {
  const text = lines.slice(0, 8).join("\n");
  const match = text.match(/(?:限时|答题时间|考试时间)\s*(\d+(?:\.\d+)?)\s*分钟/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function isAnswerDocument(lines: string[]): boolean {
  const head = lines.slice(0, 15).join("\n");
  if (/标准答案|参考答案/.test(head)) return true;
  return lines.some((line) => line.startsWith("参考要点") || line.startsWith("采分说明"));
}

function pushQuestion(
  questions: Question[],
  section: Section,
  number: string,
  stem: string,
  options: string[],
): string | null {
  const id = `${section.label}${number}`;
  const text = stem.replace(/\s+/g, " ").trim();
  if (!text) return `${id} 缺少题干。`;
  let score = section.perQuestion;
  let blanks = 0;
  if (section.type === "blank") {
    blanks = text.split(BLANK_MARK).length - 1;
    if (blanks < 1) return `${id} 没有识别到填空。请在空的位置留下下划线。`;
    score = section.perBlank != null ? section.perBlank * blanks : section.perQuestion;
  }
  if (section.type === "short" || (score == null && section.type !== "blank")) {
    score = score ?? scoreInText(text);
  }
  if (score == null || !Number.isFinite(score) || score < 0) return `${id} 缺少分值。`;
  if ((section.type === "single" || section.type === "multiple") && options.length < 2) {
    return `${id} 至少需要两个选项。`;
  }
  questions.push({
    id,
    type: section.type,
    stem: text,
    options: section.type === "single" || section.type === "multiple" ? options : [],
    blanks,
    score,
  });
  return null;
}

function parseQuestionLines(lines: string[]): { paper: Paper } | { error: string } {
  const questions: Question[] = [];
  let section: Section | null = null;
  let current: { number: string; stem: string; options: string[] } | null = null;

  const finish = (): string | null => {
    if (!current || !section) return null;
    const error = pushQuestion(questions, section, current.number, current.stem, current.options);
    current = null;
    return error;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || isFooter(line)) continue;
    const nextSection = sectionOf(line);
    if (nextSection) {
      const error = finish();
      if (error) return { error };
      section = nextSection;
      continue;
    }
    if (!section) continue;
    const question = line.match(QUESTION_RE);
    if (question) {
      const error = finish();
      if (error) return { error };
      current = { number: question[1], stem: question[2], options: [] };
      continue;
    }
    if (!current) continue;
    const option = line.match(OPTION_RE);
    if ((section.type === "single" || section.type === "multiple") && option) {
      current.options.push(option[2].trim());
      continue;
    }
    if (current.options.length > 0) {
      current.options[current.options.length - 1] += line;
    } else {
      current.stem += line;
    }
  }
  const error = finish();
  if (error) return { error };
  if (questions.length === 0) {
    return { error: "这份 PDF 里没有识别到题目。请使用带「一、选择题」这类大题的试卷，或改用 JSON / Excel。" };
  }
  return {
    paper: {
      title: paperTitle(lines),
      durationMinutes: hardDuration(lines),
      questions,
    },
  };
}

function splitPrimary(line: string): string[] {
  if (!/第[一二三四五六七八九十\d]+空/.test(line)) return [clean(line)].filter(Boolean);
  return line
    .split(/[;；]/)
    .map((part) => clean(part.replace(/[（(]第[一二三四五六七八九十\d]+空[)）]/g, "")))
    .filter(Boolean);
}

function grantedPhrases(notes: string): string[] {
  const found: string[] = [];
  const pattern = /写[“"「]([^”"」]+)[”"」]/g;
  for (const match of notes.matchAll(pattern)) {
    const after = notes.slice((match.index ?? 0) + match[0].length);
    const give = after.search(/可给分/);
    const deny = after.search(/不给分/);
    if (give >= 0 && (deny < 0 || give < deny)) found.push(match[1]);
  }
  return found;
}

export function keywordsFromReference(text: string): string[] {
  const found: Array<{ index: number; word: string }> = [];
  for (const word of ANCHORS) {
    const index = text.indexOf(word);
    if (index >= 0) found.push({ index, word });
  }
  for (const match of text.matchAll(/[“"「]([^”"」]{2,12})[”"」]/g)) {
    const word = match[1].trim();
    if (word) found.push({ index: match.index ?? 0, word });
  }
  found.sort((left, right) => left.index - right.index || left.word.length - right.word.length);
  const unique: string[] = [];
  for (const item of found) {
    if (unique.length >= 8) break;
    if (unique.some((word) => word.includes(item.word) || item.word.includes(word))) continue;
    unique.push(item.word);
  }
  return unique;
}

function parseBlankBody(first: string, notes: string): string[][] | null {
  const slots = splitPrimary(first).map((item) => [item]);
  if (slots.length === 0 || slots.some((slot) => slot.length === 0 || !slot[0])) return null;
  const add = (index: number, values: string[]) => {
    const slot = slots[index];
    if (!slot) return;
    for (const value of values) {
      const token = clean(value);
      if (!token || slot.includes(token)) continue;
      slot.push(token);
    }
  };
  for (const match of notes.matchAll(/第([一二三四五六七八九十\d]+)空可接受[:：]\s*([^。\n]+)/g)) {
    const index = ordinal(match[1]);
    if (index == null) continue;
    add(index, match[2].split(/[、,，/]/));
  }
  for (const match of notes.matchAll(/第([一二三四五六七八九十\d]+)空须是[“"「]([^”"」]+)[”"」]/g)) {
    const index = ordinal(match[1]);
    if (index == null) continue;
    add(index, [match[2]]);
  }
  const generic = notes.replace(/第[一二三四五六七八九十\d]+空可接受[:：][^。\n]*/g, "");
  if (slots.length === 1) {
    for (const match of generic.matchAll(/(?:^|[\s。；])可接受[:：]\s*([^。\n]+)/g)) {
      add(0, match[1].split(/[、,，/]/));
    }
    add(0, grantedPhrases(notes));
  }
  return slots;
}

function referenceOf(body: string): { answer: string; keywords: string[] } | null {
  const start = body.indexOf("参考要点");
  const scoring = body.indexOf("采分说明");
  let text = start >= 0 ? body.slice(start) : body;
  text = text.replace(/^参考要点[:：]\s*/, "");
  if (scoring >= 0 && start >= 0 && scoring > start) {
    text = body.slice(start, scoring).replace(/^参考要点[:：]\s*/, "");
  } else if (scoring >= 0 && start < 0) {
    text = body.slice(0, scoring);
  }
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return { answer: text, keywords: keywordsFromReference(text) };
}

function choiceLetters(line: string, multiple: boolean): string[] | null {
  const match = line.match(/^([A-F](?:\s*[,，、]\s*[A-F])*)(?:[.．]\s*|\s+)?(.*)$/);
  if (!match) return null;
  let letters = match[1].split(/[^A-F]+/).filter(Boolean);
  const rest = match[2].trim();
  if (multiple && rest && /^[A-F](?:\s*[,，、\s]*[A-F])*$/.test(rest)) {
    letters = letters.concat(rest.split(/[^A-F]+/).filter(Boolean));
  }
  if (!multiple) return letters.length > 0 ? [letters[0]] : null;
  return letters.length > 0 ? letters : null;
}

function parseAnswerLines(lines: string[]): { key: AnswerKey } | { error: string } {
  const byId: Record<string, AnswerEntry> = {};
  let section: Section | null = null;
  let current: { number: string; lines: string[] } | null = null;

  const finish = (): string | null => {
    if (!current || !section) return null;
    const id = `${section.label}${current.number}`;
    const [first, ...rest] = current.lines;
    const notes = rest.join("");
    let answer: unknown = null;
    let keywords: string[] = [];
    if (section.type === "single" || section.type === "multiple") {
      const letters = choiceLetters(first, section.type === "multiple");
      if (!letters) return `${id} 的答案不是选项字母。`;
      answer = section.type === "single" ? letters[0] : letters;
    } else if (section.type === "judge") {
      answer = clean(first);
    } else if (section.type === "blank") {
      const slots = parseBlankBody(first, notes);
      if (!slots) return `${id} 的填空答案无法识别。`;
      answer = slots.length === 1 ? slots[0] : slots;
    } else {
      const reference = referenceOf([first, notes].filter(Boolean).join(""));
      if (!reference) return `${id} 缺少参考要点。`;
      answer = reference.answer;
      keywords = reference.keywords;
    }
    byId[id] = { id, answer, keywords, excel: false };
    current = null;
    return null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || isFooter(line)) continue;
    const nextSection = sectionOf(line);
    if (nextSection) {
      const error = finish();
      if (error) return { error };
      section = nextSection;
      continue;
    }
    if (!section) continue;
    const question = line.match(QUESTION_RE);
    const choiceSection = section.type === "single" || section.type === "multiple";
    if (question && (!choiceSection || choiceLetters(question[2], section.type === "multiple"))) {
      const error = finish();
      if (error) return { error };
      current = { number: question[1], lines: [question[2]] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  const error = finish();
  if (error) return { error };
  if (Object.keys(byId).length === 0) {
    return { error: "这份 PDF 里没有识别到答案。请使用与试卷配套的答案，或改用 JSON / Excel。" };
  }
  return { key: { byId } };
}

export function parseExamLines(lines: string[]): ParseOutcome {
  const useful = lines.map((line) => line.trim()).filter(Boolean);
  if (useful.length === 0) return { ok: false, error: "这份 PDF 没有可读的文字。" };
  if (isAnswerDocument(useful)) {
    const parsed = parseAnswerLines(useful);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    return { ok: true, content: { paper: null, key: parsed.key } };
  }
  const parsed = parseQuestionLines(useful);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  return { ok: true, content: { paper: parsed.paper, key: null } };
}

export function linesFromItems(items: PdfTextItem[], markBlanks: boolean): string[] {
  const lines: Array<{ y: number; runs: PdfTextItem[] }> = [];
  const ordered = [...items].sort((left, right) => right.y - left.y || left.x - right.x);
  for (const item of ordered) {
    const line = lines.find((entry) => Math.abs(entry.y - item.y) <= 2);
    if (line) line.runs.push(item);
    else lines.push({ y: item.y, runs: [item] });
  }
  return lines
    .map((line) => {
      const runs = line.runs.sort((left, right) => left.x - right.x);
      let text = "";
      let cursor: number | null = null;
      for (const run of runs) {
        if (!run.str) continue;
        const gap = cursor == null ? 0 : run.x - cursor;
        if (markBlanks && gap > WIDE_SPACE) text += BLANK_MARK;
        if (markBlanks && /^\s+$/.test(run.str) && run.width > WIDE_SPACE) text += BLANK_MARK;
        else text += run.str;
        cursor = Math.max(cursor ?? 0, run.x + Math.max(run.width, 0));
      }
      return text.replace(/[ \t]{2,}/g, " ").trim();
    })
    .filter(Boolean);
}

