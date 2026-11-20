import { describe, expect, it } from "vitest";
import { POST as grade } from "../../app/api/grade/route";
import { POST as attempt } from "../../app/api/attempt/route";
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

  it("returns references only after that candidate has a stored submission", async () => {
    const started = await post(attempt, { name: "李明" });
    expect(started.status).toBe(200);
    const token = (JSON.parse(started.text) as { token: string }).token;

    const empty = await post(grade, { token, responses: {} });
    expect(empty.status).toBe(400);
    expect(empty.text).not.toContain("乙");
    expect(empty.text).not.toContain("reference");

    const unanswered = await post(grade, { token, responses: { "1": { type: "single", index: null } } });
    expect(unanswered.status).toBe(400);
    expect(unanswered.text).not.toContain("乙");

    const submitted = await post(grade, { token, responses: { "1": { type: "single", index: 1 } } });
    expect(submitted.status).toBe(200);
    const report = JSON.parse(submitted.text) as { name: string; report: { total: number; items: { reference: string }[] } };
    expect(report.name).toBe("李明");
    expect(report.report.total).toBe(2);
    expect(report.report.items[0].reference).toContain("乙");

    const again = await post(grade, { token, responses: {} });
    expect(again.status).toBe(400);
    expect(again.text).not.toContain("乙");
  });
});

describe("proctor passphrase limit", () => {
  it("blocks after repeated failures", async () => {
    expect(await proctorAttemptsBlocked()).toBe(false);
    for (let i = 0; i < 8; i += 1) await recordProctorFailure();
    expect(await proctorAttemptsBlocked()).toBe(true);
  });
});
