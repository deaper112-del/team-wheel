import { createHash, randomBytes } from "node:crypto";
import { isAnswered } from "../grade";
import { toCandidateReport } from "../reportView";
import type { GradeItem, GradeReport, Question, ResponseValue } from "../types";
import { sql } from "./db";
import { gradeSaved, getPublicExam } from "./paper";

const NAME_CAP = 5;
const CLIENT_CAP = 80;
const GLOBAL_CAP = 200;
const GRACE_MS = 20_000;

export type AttemptResult =
  | { ok: true; token: string; name: string; deadline: string | null }
  | { ok: false; status: number; error: string };

export type SubmitResult =
  | { ok: true; name: string; report: GradeReport; released: boolean }
  | { ok: false; status: number; error: string };

export interface ScoreRow {
  name: string;
  score: number;
  total: number;
}

export interface QuestionRate {
  id: string;
  stem: string;
  correct: number;
  wrong: number;
  total: number;
}

export interface RoundSnapshot {
  released: boolean;
  candidates: ScoreRow[];
  hardest: QuestionRate | null;
  easiest: QuestionRate | null;
}

function asJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function responseMap(value: unknown): Record<string, ResponseValue | undefined> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, ResponseValue | undefined>;
}

export function clientKeyFrom(header: string | null): string {
  const ip = (header ?? "").split(",")[0].trim();
  if (!ip || ip.length > 200) return "";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

function deadlineIso(started: Date | string, minutes: number | null): string | null {
  const span = Number(minutes);
  if (!Number.isFinite(span) || span <= 0) return null;
  const start = started instanceof Date ? started.getTime() : Date.parse(String(started));
  if (!Number.isFinite(start)) return null;
  return new Date(start + span * 60_000).toISOString();
}

function pastDeadline(started: Date | string, minutes: number | null): boolean {
  const deadline = deadlineIso(started, minutes);
  if (!deadline) return false;
  return Date.now() > Date.parse(deadline) + GRACE_MS;
}

function releasedFlag(value: boolean | string | null | undefined): boolean {
  return value === true || value === "t";
}

async function attemptLimited(name: string, clientKey: string): Promise<AttemptResult | null> {
  const named = await sql<{ n: number | string }>(
    `select count(*)::int as n from exam_attempt
     where name = $1 and paper_updated_at = (select updated_at from exam_paper where id = 1)`,
    [name],
  );
  if (Number(named[0]?.n ?? 0) >= NAME_CAP) return { ok: false, status: 429, error: "这个姓名的考试次数已用完。" };
  if (clientKey) {
    const byClient = await sql<{ n: number | string }>(
      `select count(*)::int as n from exam_attempt
       where client_key = $1 and started_at > now() - interval '30 minutes'`,
      [clientKey],
    );
    if (Number(byClient[0]?.n ?? 0) >= CLIENT_CAP) return { ok: false, status: 429, error: "开始得太频繁，请稍后再试。" };
  }
  const recent = await sql<{ n: number | string }>(
    "select count(*)::int as n from exam_attempt where started_at > now() - interval '10 minutes'",
  );
  if (Number(recent[0]?.n ?? 0) >= GLOBAL_CAP) return { ok: false, status: 429, error: "开始得太频繁，请稍后再试。" };
  return null;
}

export async function startAttempt(name: string, clientKey = ""): Promise<AttemptResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, status: 400, error: "请填写考生姓名。" };
  if (trimmed.length > 30) return { ok: false, status: 400, error: "姓名请控制在 30 个字以内。" };
  const limited = await attemptLimited(trimmed, clientKey);
  if (limited) return limited;
  const token = randomBytes(32).toString("hex");
  const rows = await sql<{ token: string; started_at: Date | string; duration_minutes: number | null }>(
    `with inserted as (
       insert into exam_attempt (token, name, paper_updated_at, client_key)
       select $1, $2, updated_at, $3 from exam_paper where id = 1
       returning token, started_at
     )
     select inserted.token, inserted.started_at, exam_paper.duration_minutes
     from inserted
     join exam_paper on exam_paper.id = 1`,
    [token, trimmed, clientKey],
  );
  const row = rows[0];
  if (!row) return { ok: false, status: 409, error: "考试还没开始。" };
  return { ok: true, token, name: trimmed, deadline: deadlineIso(row.started_at, row.duration_minutes) };
}

export async function submitAttempt(token: string, responses: unknown): Promise<SubmitResult> {
  if (!/^[a-f0-9]{64}$/.test(token)) return { ok: false, status: 400, error: "请先开始考试。" };
  const answers = responseMap(responses);
  if (!answers) return { ok: false, status: 400, error: "答卷格式无法识别。" };

  const rows = await sql<{
    name: string;
    started_at: Date | string;
    submitted_at: Date | string | null;
    report: unknown;
    same_paper: boolean | string;
    duration_minutes: number | null;
    answers_released: boolean | string;
  }>(
    `select a.name, a.started_at, a.submitted_at, a.report,
            (a.paper_updated_at = p.updated_at) as same_paper,
            p.duration_minutes, p.answers_released
     from exam_attempt a
     join exam_paper p on p.id = 1
     where a.token = $1`,
    [token],
  );
  const attempt = rows[0];
  if (!attempt) return { ok: false, status: 400, error: "请先开始考试。" };
  if (attempt.same_paper !== true && attempt.same_paper !== "t") {
    return { ok: false, status: 409, error: "试卷已更新，请重新开始。" };
  }

  const exam = await getPublicExam();
  if (!exam) return { ok: false, status: 409, error: "考试还没开始。" };
  if (countAnsweredSafe(exam.questions, answers) === 0) {
    return { ok: false, status: 400, error: "请先作答。" };
  }

  const released = releasedFlag(attempt.answers_released);
  if (attempt.submitted_at != null && attempt.report != null) {
    return { ok: true, name: attempt.name, released, report: toCandidateReport(asJson<GradeReport>(attempt.report), released) };
  }
  if (pastDeadline(attempt.started_at, attempt.duration_minutes)) {
    return { ok: false, status: 409, error: "时间已到。" };
  }

  const graded = await gradeSaved(answers);
  if (!graded) return { ok: false, status: 409, error: "考试还没开始。" };
  const saved = await sql<{ report: unknown }>(
    `update exam_attempt
     set submitted_at = now(), report = $2::jsonb
     where token = $1 and submitted_at is null
     returning report`,
    [token, JSON.stringify(graded)],
  );
  const stored = saved[0]?.report;
  if (stored != null) {
    return { ok: true, name: attempt.name, released, report: toCandidateReport(asJson<GradeReport>(stored), released) };
  }
  const again = await sql<{ report: unknown }>(
    "select report from exam_attempt where token = $1 and submitted_at is not null",
    [token],
  );
  if (again[0]?.report == null) return { ok: false, status: 409, error: "交卷失败，请再试一次。" };
  return { ok: true, name: attempt.name, released, report: toCandidateReport(asJson<GradeReport>(again[0].report), released) };
}

export async function candidateResult(token: string): Promise<SubmitResult> {
  if (!/^[a-f0-9]{64}$/.test(token)) return { ok: false, status: 400, error: "请先开始考试。" };
  const rows = await sql<{ name: string; report: unknown; answers_released: boolean | string }>(
    `select a.name, a.report, p.answers_released
     from exam_attempt a
     join exam_paper p on p.id = 1 and a.paper_updated_at = p.updated_at
     where a.token = $1 and a.submitted_at is not null`,
    [token],
  );
  const row = rows[0];
  if (!row?.report) return { ok: false, status: 404, error: "还没有交卷。" };
  const released = releasedFlag(row.answers_released);
  return { ok: true, name: row.name, released, report: toCandidateReport(asJson<GradeReport>(row.report), released) };
}

function rateOf(item: QuestionRate): { correct: number; error: number } {
  if (item.total <= 0) return { correct: 0, error: 0 };
  return { correct: item.correct / item.total, error: item.wrong / item.total };
}

export async function roundResults(): Promise<RoundSnapshot | null> {
  const paper = await sql<{ answers_released: boolean | string }>("select answers_released from exam_paper where id = 1");
  if (!paper[0]) return null;
  const rows = await sql<{ name: string; report: unknown }>(
    `select a.name, a.report
     from exam_attempt a
     join exam_paper p on p.id = 1 and a.paper_updated_at = p.updated_at
     where a.submitted_at is not null and a.report is not null
     order by a.submitted_at`,
  );
  const candidates: ScoreRow[] = [];
  const questions = new Map<string, QuestionRate>();
  for (const row of rows) {
    const report = asJson<GradeReport>(row.report);
    candidates.push({ name: row.name, score: report.total, total: report.gradedMax });
    for (const item of report.items) addQuestion(questions, item);
  }
  const ranked = [...questions.values()];
  return {
    released: releasedFlag(paper[0].answers_released),
    candidates,
    hardest: pickRate(ranked, "error"),
    easiest: pickRate(ranked, "correct"),
  };
}

function addQuestion(questions: Map<string, QuestionRate>, item: GradeItem): void {
  const current = questions.get(item.id) ?? { id: item.id, stem: item.stem, correct: 0, wrong: 0, total: 0 };
  current.total += 1;
  if (item.status === "correct") current.correct += 1;
  else if (item.status === "incorrect" || item.status === "partial" || item.status === "blank") current.wrong += 1;
  questions.set(item.id, current);
}

function pickRate(items: QuestionRate[], kind: "error" | "correct"): QuestionRate | null {
  if (items.length === 0) return null;
  return [...items].sort((left, right) => {
    const leftRate = rateOf(left)[kind];
    const rightRate = rateOf(right)[kind];
    if (rightRate !== leftRate) return rightRate - leftRate;
    const leftCount = kind === "error" ? left.wrong : left.correct;
    const rightCount = kind === "error" ? right.wrong : right.correct;
    if (rightCount !== leftCount) return rightCount - leftCount;
    return left.id.localeCompare(right.id, "zh");
  })[0];
}

export async function releaseAnswers(): Promise<RoundSnapshot | null> {
  const rows = await sql<{ id: number }>("update exam_paper set answers_released = true where id = 1 returning id");
  if (!rows[0]) return null;
  return roundResults();
}

function countAnsweredSafe(questions: Question[], responses: Record<string, ResponseValue | undefined>): number {
  return questions.filter((question) => isAnswered(question, responses[question.id])).length;
}
