import { describe, expect, it } from "vitest";
import { gradeSaved, getPublicExam, publicQuestions, saveExam } from "./paper";
import type { AnswerKey, Paper } from "../types";

const paper: Paper = {
  title: "服务器试卷",
  durationMinutes: null,
  questions: [{ id: "1", type: "single", stem: "题干", options: ["甲", "乙"], score: 2, blanks: 0 }],
};

const key: AnswerKey = {
  byId: { "1": { id: "1", answer: "B", keywords: [], excel: false } },
};

describe("public exam", () => {
  it("drops anything except the question fields", () => {
    const questions = publicQuestions([
      { id: "1", type: "short", stem: "题干", score: 4, blanks: 0, options: [], answer: "秘密参考", keywords: ["秘密"] },
    ]);
    expect(JSON.stringify(questions)).not.toContain("秘密");
    expect(questions[0]).toEqual({ id: "1", type: "short", stem: "题干", options: [], blanks: 0, score: 4 });
  });

  it("stores the key on the server and does not return it before grading", async () => {
    expect(await getPublicExam()).toBeNull();
    await saveExam(paper, key);
    const published = await getPublicExam();
    expect(published?.title).toBe("服务器试卷");
    expect(JSON.stringify(published)).not.toContain("\"B\"");
    const report = await gradeSaved({ "1": { type: "single", index: 1 } });
    expect(report?.total).toBe(2);
    expect(report?.items[0].reference).toContain("乙");
  });
});
