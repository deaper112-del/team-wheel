import { gradePaper } from "../grade";
import type { AnswerKey, GradeReport, Paper, Question, QuestionType, ResponseValue } from "../types";
import { sql } from "./db";

const TYPES = new Set<QuestionType>(["single", "multiple", "judge", "blank", "short"]);

export interface PublicExam {
  ready: true;
  updatedAt: string;
  title: string;
  durationMinutes: number | null;
  questions: Question[];
}

function asJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

export function publicQuestions(value: unknown): Question[] {
  if (!Array.isArray(value)) return [];
  const questions: Question[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const type = raw.type;
    if (typeof type !== "string" || !TYPES.has(type as QuestionType)) continue;
    const id = raw.id == null ? "" : String(raw.id);
    if (!id) continue;
    questions.push({
      id,
      type: type as QuestionType,
      stem: typeof raw.stem === "string" ? raw.stem : "",
      options: Array.isArray(raw.options) ? raw.options.map((option) => String(option)) : [],
      blanks: typeof raw.blanks === "number" && Number.isFinite(raw.blanks) ? raw.blanks : 0,
      score: typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : 0,
    });
  }
  return questions;
}

export async function getPublicExam(): Promise<PublicExam | null> {
  const rows = await sql<{
    title: string;
    duration_minutes: number | null;
    questions: unknown;
    updated_at: Date | string;
  }>("select title, duration_minutes, questions, updated_at from exam_paper where id = 1");
  const row = rows[0];
  if (!row) return null;
  const updated = row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at);
  return {
    ready: true,
    updatedAt: updated,
    title: row.title,
    durationMinutes: row.duration_minutes,
    questions: publicQuestions(asJson(row.questions)),
  };
}

export async function saveExam(paper: Paper, key: AnswerKey): Promise<string> {
  const rows = await sql<{ updated_at: Date | string }>(
    `insert into exam_paper (id, title, duration_minutes, questions, answer_key, answers_released, updated_at)
     values (1, $1, $2, $3::jsonb, $4::jsonb, false, now())
     on conflict (id) do update set
       title = excluded.title,
       duration_minutes = excluded.duration_minutes,
       questions = excluded.questions,
       answer_key = excluded.answer_key,
       answers_released = false,
       updated_at = now()
     returning updated_at`,
    [paper.title, paper.durationMinutes, JSON.stringify(paper.questions), JSON.stringify(key)],
  );
  const stamp = rows[0]?.updated_at;
  return stamp instanceof Date ? stamp.toISOString() : String(stamp ?? new Date().toISOString());
}

export async function gradeSaved(responses: Record<string, ResponseValue | undefined>): Promise<GradeReport | null> {
  const rows = await sql<{ title: string; duration_minutes: number | null; questions: unknown; answer_key: unknown }>(
    "select title, duration_minutes, questions, answer_key from exam_paper where id = 1",
  );
  const row = rows[0];
  if (!row) return null;
  const paper: Paper = {
    title: row.title,
    durationMinutes: row.duration_minutes,
    questions: publicQuestions(asJson(row.questions)),
  };
  const key = asJson<AnswerKey>(row.answer_key);
  return gradePaper(paper, key, responses);
}
