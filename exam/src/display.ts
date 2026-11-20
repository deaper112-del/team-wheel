import type { GradeStatus, Paper, QuestionType } from "./types";

export const TYPE_ORDER: QuestionType[] = ["single", "multiple", "judge", "blank", "short"];

export const TYPE_LABEL: Record<QuestionType, string> = {
  single: "单选题",
  multiple: "多选题",
  judge: "判断题",
  blank: "填空题",
  short: "简答题",
};

export const STATUS_LABEL: Record<GradeStatus, string> = {
  correct: "正确",
  incorrect: "错误",
  partial: "部分正确",
  blank: "未作答",
  ungraded: "无法评分",
};

export const SECTION_HINT: Record<QuestionType, string> = {
  single: "选择一个选项。",
  multiple: "选出所有正确选项。少选、多选或错选不得分。",
  judge: "判断对错。",
  blank: "按顺序填写。首尾空格不计，不区分大小写。",
  short: "在文本框中作答。",
};

const CN = ["一", "二", "三", "四", "五"];

export function sectionTitle(index: number, type: QuestionType): string {
  return `${CN[index] ?? String(index + 1)}、${TYPE_LABEL[type]}`;
}

export function formatPoints(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function formatMinutes(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function paperSummary(paper: Paper): string {
  const counts = new Map<QuestionType, number>();
  for (const question of paper.questions) {
    counts.set(question.type, (counts.get(question.type) ?? 0) + 1);
  }
  const parts = TYPE_ORDER.filter((type) => counts.has(type)).map(
    (type) => `${TYPE_LABEL[type]} ${counts.get(type)}`,
  );
  const timing = paper.durationMinutes
    ? `限时 ${formatMinutes(paper.durationMinutes)} 分钟。`
    : "不限时。";
  return `《${paper.title}》共 ${paper.questions.length} 题：${parts.join("，")}。${timing}`;
}
