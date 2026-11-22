import { createHash } from "node:crypto";
import type { AnswerKey, GradeReport, Paper, Question } from "../types";
import { sql } from "./db";
import { publicQuestions, saveExam } from "./paper";

export interface SavedPaperInfo {
  id: number;
  title: string;
  createdAt: string;
  questionCount: number;
}

export interface SubjectInfo {
  id: number;
  name: string;
  papers: SavedPaperInfo[];
}

export interface LearningPoint {
  round: number;
  at: string;
  paperTitle: string;
  rate: number | null;
  correct: number;
  total: number;
}

export interface LearningChart {
  name: string;
  points: LearningPoint[];
}

export interface SubjectBoard {
  subjects: SubjectInfo[];
  subjectId: number | null;
  chart: LearningChart | null;
}

interface SavedRow {
  id: number | string;
  subject_id: number | string;
  title: string;
  created_at: Date | string;
  subject_name: string;
  question_count: number | string;
}

function asJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function num(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function stamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export function questionHash(questions: Question[]): string {
  const stable = questions.map((question) => ({
    id: question.id,
    type: question.type,
    stem: question.stem,
    options: question.options,
    blanks: question.blanks,
    score: question.score,
  }));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function subjectNameFromTitle(title: string): string {
  const name = title.replace(/[《》]/g, "").trim();
  return name.slice(0, 40) || "未命名科目";
}

async function rememberLive(): Promise<void> {
  const rows = await sql<{
    title: string;
    duration_minutes: number | null;
    questions: unknown;
    answer_key: unknown;
    updated_at: Date | string;
  }>("select title, duration_minutes, questions, answer_key, updated_at from exam_paper where id = 1");
  const live = rows[0];
  if (!live) return;
  const existing = await sql<{ id: number }>("select id from exam_round where paper_updated_at = $1", [live.updated_at]);
  if (existing[0]) return;
  const questions = publicQuestions(asJson(live.questions));
  const paper: Paper = { title: live.title, durationMinutes: live.duration_minutes, questions };
  const hash = questionHash(questions);
  const subjectId = await subjectForHash(hash, subjectNameFromTitle(live.title));
  const saved = await sql<{ id: number | string }>(
    `insert into exam_saved_paper (subject_id, title, duration_minutes, questions, answer_key, question_hash, created_at)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
     returning id`,
    [subjectId, paper.title, paper.durationMinutes, JSON.stringify(questions), JSON.stringify(asJson(live.answer_key)), hash, live.updated_at],
  );
  const paperId = num(saved[0].id);
  await sql(
    `insert into exam_round (subject_id, paper_id, paper_updated_at, started_at)
     values ($1, $2, $3, $3)
     on conflict (paper_updated_at) do nothing`,
    [subjectId, paperId, live.updated_at],
  );
}

async function subjectForHash(hash: string, name: string): Promise<number> {
  const found = await sql<{ subject_id: number | string }>(
    "select subject_id from exam_saved_paper where question_hash = $1 order by id desc limit 1",
    [hash],
  );
  if (found[0]) return num(found[0].subject_id);
  const created = await sql<{ id: number | string }>("insert into exam_subject (name) values ($1) returning id", [name]);
  return num(created[0].id);
}

async function addRound(subjectId: number, paperId: number, updatedAt: Date | string): Promise<void> {
  await sql(
    `insert into exam_round (subject_id, paper_id, paper_updated_at, started_at)
     values ($1, $2, $3, $3)
     on conflict (paper_updated_at) do nothing`,
    [subjectId, paperId, updatedAt],
  );
}

export async function publishUploaded(paper: Paper, key: AnswerKey): Promise<{ subjectId: number; paperId: number; subjectName: string }> {
  await rememberLive();
  const questions = publicQuestions(paper.questions);
  const stored: Paper = { title: paper.title, durationMinutes: paper.durationMinutes, questions };
  const hash = questionHash(questions);
  const subjectId = await subjectForHash(hash, subjectNameFromTitle(paper.title));
  const saved = await sql<{ id: number | string }>(
    `insert into exam_saved_paper (subject_id, title, duration_minutes, questions, answer_key, question_hash)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
     returning id`,
    [subjectId, stored.title, stored.durationMinutes, JSON.stringify(questions), JSON.stringify(key), hash],
  );
  const paperId = num(saved[0].id);
  const updatedAt = await saveExam(stored, key);
  await addRound(subjectId, paperId, updatedAt);
  const named = await sql<{ name: string }>("select name from exam_subject where id = $1", [subjectId]);
  return { subjectId, paperId, subjectName: named[0]?.name ?? subjectNameFromTitle(paper.title) };
}

export async function startSavedPaper(paperId: number): Promise<{ paper: Paper; subjectId: number } | null> {
  await rememberLive();
  const rows = await sql<{
    subject_id: number | string;
    title: string;
    duration_minutes: number | null;
    questions: unknown;
    answer_key: unknown;
  }>("select subject_id, title, duration_minutes, questions, answer_key from exam_saved_paper where id = $1", [paperId]);
  const row = rows[0];
  if (!row) return null;
  const paper: Paper = {
    title: row.title,
    durationMinutes: row.duration_minutes,
    questions: publicQuestions(asJson(row.questions)),
  };
  const updatedAt = await saveExam(paper, asJson(row.answer_key));
  const subjectId = num(row.subject_id);
  await addRound(subjectId, paperId, updatedAt);
  return { paper, subjectId };
}

function idsOf(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))].slice(0, 200);
}

export async function groupPapers(paperIds: number[], target: { subjectId?: number | null; name?: string }): Promise<{ ok: true; subjectId: number } | { ok: false; error: string }> {
  const chosen = idsOf(paperIds);
  if (chosen.length === 0) return { ok: false, error: "请选择要合并的试卷。" };
  const placeholders = chosen.map((_, index) => `$${index + 1}`).join(", ");
  const selected = await sql<{ question_hash: string }>(
    `select question_hash from exam_saved_paper where id in (${placeholders})`,
    chosen,
  );
  if (selected.length === 0) return { ok: false, error: "没有找到这些试卷。" };
  const hashes = [...new Set(selected.map((row) => row.question_hash))];
  const hashPlaceholders = hashes.map((_, index) => `$${index + 1}`).join(", ");
  const related = await sql<{ id: number | string }>(
    `select id from exam_saved_paper where question_hash in (${hashPlaceholders})`,
    hashes,
  );
  const moveIds = related.map((row) => num(row.id));
  let subjectId = target.subjectId ?? null;
  if (subjectId != null) {
    const found = await sql<{ id: number }>("select id from exam_subject where id = $1", [subjectId]);
    if (!found[0]) return { ok: false, error: "没有这个科目。" };
  } else {
    const name = (target.name ?? "").trim().slice(0, 40);
    if (!name) return { ok: false, error: "请填写科目名称。" };
    const existing = await sql<{ id: number | string }>("select id from exam_subject where name = $1 order by id limit 1", [name]);
    if (existing[0]) subjectId = num(existing[0].id);
    else {
      const created = await sql<{ id: number | string }>("insert into exam_subject (name) values ($1) returning id", [name]);
      subjectId = num(created[0].id);
    }
  }
  const movePlaceholders = moveIds.map((_, index) => `$${index + 2}`).join(", ");
  await sql(`update exam_saved_paper set subject_id = $1 where id in (${movePlaceholders})`, [subjectId, ...moveIds]);
  await sql(`update exam_round set subject_id = $1 where paper_id in (${movePlaceholders})`, [subjectId, ...moveIds]);
  await sql(
    `delete from exam_subject s
     where not exists (select 1 from exam_saved_paper p where p.subject_id = s.id)`,
  );
  return { ok: true, subjectId };
}

export async function subjectBoard(preferId: number | null): Promise<SubjectBoard> {
  await rememberLive();
  const rows = await sql<SavedRow>(
    `select p.id, p.subject_id, p.title, p.created_at, s.name as subject_name,
            jsonb_array_length(p.questions) as question_count
     from exam_saved_paper p
     join exam_subject s on s.id = p.subject_id
     order by p.created_at desc, p.id desc`,
  );
  const bySubject = new Map<number, SubjectInfo>();
  for (const row of rows) {
    const subjectId = num(row.subject_id);
    const subject = bySubject.get(subjectId) ?? { id: subjectId, name: row.subject_name, papers: [] };
    subject.papers.push({
      id: num(row.id),
      title: row.title,
      createdAt: stamp(row.created_at),
      questionCount: num(row.question_count),
    });
    bySubject.set(subjectId, subject);
  }
  const subjects = [...bySubject.values()];
  const subjectId = subjects.some((subject) => subject.id === preferId) ? preferId : (subjects[0]?.id ?? null);
  const chart = subjectId == null ? null : await subjectChart(subjectId);
  return { subjects, subjectId, chart };
}

export async function subjectChart(subjectId: number): Promise<LearningChart | null> {
  const named = await sql<{ name: string }>("select name from exam_subject where id = $1", [subjectId]);
  if (!named[0]) return null;
  const rounds = await sql<{ paper_updated_at: Date | string; started_at: Date | string; title: string }>(
    `select r.paper_updated_at, r.started_at, p.title
     from exam_round r
     join exam_saved_paper p on p.id = r.paper_id
     where r.subject_id = $1
     order by r.started_at, r.id`,
    [subjectId],
  );
  const points: LearningPoint[] = [];
  for (const round of rounds) {
    const attempts = await sql<{ report: unknown }>(
      `select report from exam_attempt
       where paper_updated_at = $1 and submitted_at is not null and report is not null`,
      [round.paper_updated_at],
    );
    let correct = 0;
    let total = 0;
    for (const attempt of attempts) {
      const report = asJson<GradeReport>(attempt.report);
      if (!report || !Array.isArray(report.items)) continue;
      for (const item of report.items) {
        if (item.status === "ungraded") continue;
        total += 1;
        if (item.status === "correct") correct += 1;
      }
    }
    points.push({
      round: points.length + 1,
      at: stamp(round.started_at),
      paperTitle: round.title,
      rate: total > 0 ? correct / total : null,
      correct,
      total,
    });
  }
  return { name: named[0].name, points };
}
