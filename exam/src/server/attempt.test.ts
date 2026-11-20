import { describe, expect, it } from "vitest";
import { POST as grade } from "../../app/api/grade/route";
import { POST as attempt } from "../../app/api/attempt/route";
import { POST as result } from "../../app/api/result/route";
import { POST as release } from "../../app/api/proctor/release/route";
import { POST as results } from "../../app/api/proctor/results/route";
import { sql } from "./db";
import { saveExam } from "./paper";
import { proctorAttemptsBlocked, recordProctorFailure } from "./proctorLimit";
import type { AnswerKey, Paper } from "../types";

const paper: Paper = {
  title: "门禁试卷",
  durationMinutes: null,
  questions: [{ id: "1", type: "single", stem: "题干", options: ["甲", "乙"], score: 2, blanks: 0 }],
};

const key: AnswerKey = {
  byId: { "1": { id: "1", answer: "B", keywords: [], excel: false } },
};

async function post(handler: (request: Request) => Promise<Response>, body: unknown): Promise<{ status: number; text: string }> {
  const response = await handler(
    new Request("http://exam.local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, text: await response.text() };
}

describe("grade access", () => {
  it("does not reveal the key for a name and empty responses", async () => {
    await saveExam(paper, key);
    const open = await post(grade, { name: "甲", responses: {} });
    expect(open.status).toBe(400);
    expect(open.text).not.toContain("乙");
    expect(open.text).not.toContain("reference");
    expect(open.text).not.toContain("answer_key");

    const missing = await post(grade, { name: "甲" });
    expect(missing.status).toBe(400);
    expect(missing.text).not.toContain("乙");
  });

  it("returns a reference only for the question that was answered", async () => {
    await saveExam(
      {
        title: "门禁试卷",
        durationMinutes: null,
        questions: [
          { id: "1", type: "single", stem: "题干", options: ["甲", "乙"], score: 2, blanks: 0 },
          { id: "2", type: "short", stem: "简述", score: 4, blanks: 0, options: [] },
        ],
      },
      {
        byId: {
          "1": { id: "1", answer: "B", keywords: [], excel: false },
          "2": { id: "2", answer: "要点", keywords: ["独有暗号"], excel: false },
        },
      },
    );
    const started = await post(attempt, { name: "李明" });
    expect(started.status).toBe(200);
    const token = (JSON.parse(started.text) as { token: string }).token;

    const empty = await post(grade, { token, responses: {} });
    expect(empty.status).toBe(400);
    expect(empty.text).not.toContain("乙");
    expect(empty.text).not.toContain("独有暗号");

    const submitted = await post(grade, { token, responses: { "1": { type: "single", index: 1 } } });
    expect(submitted.status).toBe(200);
    const report = JSON.parse(submitted.text) as {
      name: string;
      released: boolean;
      report: { total: number; items: { id: string; reference: string }[] };
    };
    expect(report.name).toBe("李明");
    expect(report.released).toBe(false);
    expect(report.report.total).toBe(2);
    expect(report.report.items.every((item) => item.reference === "")).toBe(true);
    expect(submitted.text).not.toContain("独有暗号");
    expect(submitted.text).not.toContain("要点");

    const before = await post(result, { token });
    expect(before.status).toBe(200);
    expect(before.text).not.toContain("独有暗号");
    expect(before.text).not.toContain("要点");

    process.env.PROCTOR_PASSPHRASE = "exam-test-pass";
    try {
      const scores = await post(results, { passphrase: "exam-test-pass" });
      expect(scores.status).toBe(200);
      expect(scores.text).toContain("李明");
      expect(scores.text).not.toContain("独有暗号");
      expect(scores.text).not.toContain("要点");
      const snap = JSON.parse(scores.text) as {
        hardest: { id: string; wrong: number; total: number };
        easiest: { id: string; correct: number; total: number };
        candidates: { name: string; score: number }[];
      };
      expect(snap.candidates[0]?.score).toBe(2);
      expect(snap.hardest.id).toBe("2");
      expect(snap.hardest.wrong).toBe(1);
      expect(snap.hardest.total).toBe(1);
      expect(snap.easiest.id).toBe("1");
      expect(snap.easiest.correct).toBe(1);
      expect(snap.easiest.total).toBe(1);

      const denied = await post(results, { passphrase: "nope" });
      expect(denied.status).toBe(401);
      expect(denied.text).not.toContain("独有暗号");

      const opened = await post(release, { passphrase: "exam-test-pass" });
      expect(opened.status).toBe(200);
      expect(opened.text).not.toContain("独有暗号");
    } finally {
      delete process.env.PROCTOR_PASSPHRASE;
    }

    const after = await post(result, { token });
    expect(after.status).toBe(200);
    const revealed = JSON.parse(after.text) as { released: boolean; report: { items: { id: string; reference: string; status: string }[] } };
    expect(revealed.released).toBe(true);
    expect(revealed.report.items.find((item) => item.id === "1")?.reference).toContain("乙");
    expect(revealed.report.items.find((item) => item.id === "2")?.reference).toContain("独有暗号");
    expect(revealed.report.items.find((item) => item.id === "2")?.status).toBe("blank");
  });

  it("caps how many times one name can start", async () => {
    for (let i = 0; i < 5; i += 1) {
      const started = await post(attempt, { name: "周周" });
      expect(started.status).toBe(200);
    }
    const blocked = await post(attempt, { name: "周周" });
    expect(blocked.status).toBe(429);
    expect(blocked.text).not.toContain("独有暗号");
  });

  it("rejects a late submit without revealing answers", async () => {
    await saveExam(
      {
        title: "限时试卷",
        durationMinutes: 1,
        questions: [{ id: "1", type: "short", stem: "简述", score: 4, blanks: 0, options: [] }],
      },
      { byId: { "1": { id: "1", answer: "要点", keywords: ["限时暗号"], excel: false } } },
    );
    const started = await post(attempt, { name: "迟到" });
    expect(started.status).toBe(200);
    const body = JSON.parse(started.text) as { token: string; deadline: string | null };
    expect(body.deadline).toBeTruthy();
    await sql("update exam_attempt set started_at = now() - interval '10 minutes' where token = $1", [body.token]);
    const late = await post(grade, { token: body.token, responses: { "1": { type: "short", text: "随便" } } });
    expect(late.status).toBe(409);
    expect(late.text).toContain("时间已到");
    expect(late.text).not.toContain("限时暗号");
  });
});

describe("proctor passphrase limit", () => {
  it("blocks after repeated failures", async () => {
    expect(await proctorAttemptsBlocked()).toBe(false);
    for (let i = 0; i < 8; i += 1) await recordProctorFailure();
    expect(await proctorAttemptsBlocked()).toBe(true);
  });
});
