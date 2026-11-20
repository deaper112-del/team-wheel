import { randomBytes } from "node:crypto";
import { countAnswered } from "../grade";
import type { GradeReport, ResponseValue } from "../types";
import { sql } from "./db";
import { gradeSaved, getPublicExam } from "./paper";

export type AttemptResult =
  | { ok: true; token: string; name: string }
  | { ok: false; status: number; error: string };

export type SubmitResult =
  | { ok: true; name: string; report: GradeReport }
  | { ok: false; status: number; error: string };

function asJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function responseMap(value: unknown): Record<string, ResponseValue | undefined> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, ResponseValue | undefined>;
}

export async function startAttempt(name: string): Promise<AttemptResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, status: 400, error: "请填写考生姓名。" };
  if (trimmed.length > 30) return { ok: false, status: 400, error: "姓名请控制在 30 个字以内。" };
  const token = randomBytes(32).toString("hex");
  const rows = await sql<{ token: string }>(
    `insert into exam_attempt (token, name, paper_updated_at)
     select $1, $2, updated_at from exam_paper where id = 1
     returning token`,
    [token, trimmed],
  );
  if (!rows[0]) return { ok: false, status: 409, error: "考试还没开始。" };
  return { ok: true, token, name: trimmed };
}

export async function submitAttempt(token: string, responses: unknown): Promise<SubmitResult> {
  if (!/^[a-f0-9]{64}$/.test(token)) return { ok: false, status: 400, error: "请先开始考试。" };
  const answers = responseMap(responses);
  if (!answers) return { ok: false, status: 400, error: "答卷格式无法识别。" };

  const rows = await sql<{
    name: string;
    submitted_at: Date | string | null;
    report: unknown;
    same_paper: boolean | string;
  }>(
    `select a.name, a.submitted_at, a.report, (a.paper_updated_at = p.updated_at) as same_paper
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
  if (countAnswered(exam.questions, answers) === 0) {
    return { ok: false, status: 400, error: "请先作答。" };
  }

  if (attempt.submitted_at != null && attempt.report != null) {
    return { ok: true, name: attempt.name, report: asJson<GradeReport>(attempt.report) };
  }

  const report = await gradeSaved(answers);
  if (!report) return { ok: false, status: 409, error: "考试还没开始。" };
  const saved = await sql<{ report: unknown }>(
    `update exam_attempt
     set submitted_at = now(), report = $2::jsonb
     where token = $1 and submitted_at is null
     returning report`,
    [token, JSON.stringify(report)],
  );
  if (saved[0]?.report != null) {
    return { ok: true, name: attempt.name, report: asJson<GradeReport>(saved[0].report) };
  }
  const again = await sql<{ report: unknown }>(
    "select report from exam_attempt where token = $1 and submitted_at is not null",
    [token],
  );
  if (again[0]?.report == null) return { ok: false, status: 409, error: "交卷失败，请再试一次。" };
  return { ok: true, name: attempt.name, report: asJson<GradeReport>(again[0].report) };
}
