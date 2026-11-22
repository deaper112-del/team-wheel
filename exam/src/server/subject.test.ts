import { describe, expect, it } from "vitest";
import { POST as group } from "../../app/api/proctor/subjects/group/route";
import { POST as list } from "../../app/api/proctor/subjects/route";
import { POST as start } from "../../app/api/proctor/subjects/start/route";
import type { AnswerKey, Paper } from "../types";
import { sql } from "./db";
import { getPublicExam } from "./paper";
import { renderProctor } from "../render";
import { groupPapers, publishUploaded, subjectBoard, subjectChart } from "./subjects";

const questions = [{ id: "1", type: "single" as const, stem: "甲题", options: ["甲", "乙"], score: 1, blanks: 0 }];

const paperA: Paper = { title: "《综合测验》", durationMinutes: null, questions };
const paperAgain: Paper = { title: "综合测验补考", durationMinutes: null, questions };
const paperB: Paper = {
  title: "另一科",
  durationMinutes: null,
  questions: [{ id: "9", type: "short", stem: "另题", options: [], score: 4, blanks: 0 }],
};

const keyA: AnswerKey = { byId: { "1": { id: "1", answer: "A", keywords: ["科目暗号"], excel: false } } };
const keyB: AnswerKey = { byId: { "9": { id: "9", answer: "要点", keywords: ["科目暗号"], excel: false } } };

function report(status: "correct" | "incorrect") {
  return {
    total: status === "correct" ? 1 : 0,
    gradedMax: 1,
    paperMax: 1,
    items: [{ id: "1", type: "single", stem: "甲题", score: 1, earned: status === "correct" ? 1 : 0, status, yours: "甲", reference: "科目暗号", note: "" }],
    missingIds: [],
    invalidIds: [],
  };
}

async function post(handler: (request: Request) => Promise<Response>, body: unknown): Promise<{ status: number; text: string }> {
  const response = await handler(new Request("http://exam.local", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: response.status, text: await response.text() };
}

describe("subjects", () => {
  it("keeps every paper, groups the same questions, and charts the rounds together", async () => {
    const first = await publishUploaded(paperA, keyA);
    const second = await publishUploaded(paperAgain, keyA);
    expect(first.subjectName).toBe("综合测验");
    expect(second.subjectId).toBe(first.subjectId);
    expect(second.paperId).not.toBe(first.paperId);

    const rounds = await sql<{ paper_id: number | string; paper_updated_at: Date | string }>(
      "select paper_id, paper_updated_at from exam_round where paper_id = $1 or paper_id = $2 order by started_at, id",
      [first.paperId, second.paperId],
    );
    expect(rounds).toHaveLength(2);
    await sql(
      `insert into exam_attempt (token, name, paper_updated_at, submitted_at, report)
       values ($1, '甲', $2, now(), $3::jsonb), ($4, '乙', $5, now(), $6::jsonb)`,
      ["a".repeat(64), rounds[0].paper_updated_at, JSON.stringify(report("correct")), "b".repeat(64), rounds[1].paper_updated_at, JSON.stringify(report("incorrect"))],
    );

    const chart = await subjectChart(first.subjectId);
    expect(chart?.points.map((point) => point.rate)).toEqual([1, 0]);
    expect(JSON.stringify(chart)).not.toContain("科目暗号");

    const other = await publishUploaded(paperB, keyB);
    expect(other.subjectId).not.toBe(first.subjectId);
    const grouped = await groupPapers([first.paperId, other.paperId], { name: "综合科" });
    expect(grouped.ok).toBe(true);
    const board = await subjectBoard(grouped.ok ? grouped.subjectId : null);
    const subject = board.subjects.find((item) => item.name === "综合科");
    expect(subject?.papers.map((paper) => paper.id).sort()).toEqual([first.paperId, second.paperId, other.paperId].sort());
    expect(board.chart?.points).toHaveLength(3);
    expect(JSON.stringify(board)).not.toContain("科目暗号");

    process.env.PROCTOR_PASSPHRASE = "exam-test-pass";
    try {
      const denied = await post(list, { passphrase: "nope" });
      expect(denied.status).toBe(401);
      expect(denied.text).not.toContain("科目暗号");

      const opened = await post(list, { passphrase: "exam-test-pass", subjectId: grouped.ok ? grouped.subjectId : 0 });
      expect(opened.status).toBe(200);
      expect(opened.text).toContain("综合科");
      expect(opened.text).not.toContain("科目暗号");

      const started = await post(start, { passphrase: "exam-test-pass", paperId: first.paperId });
      expect(started.status).toBe(200);
      expect(started.text).not.toContain("科目暗号");
      expect((await getPublicExam())?.title).toBe("《综合测验》");
      const after = JSON.parse(started.text) as { chart: { points: { rate: number | null }[] } };
      expect(after.chart.points.length).toBeGreaterThan(3);

      const renamed = await post(group, {
        passphrase: "exam-test-pass",
        paperIds: [other.paperId],
        subjectId: null,
        name: "综合科",
      });
      expect(renamed.status).toBe(200);
      expect(renamed.text).toContain("综合科");
      expect(renamed.text).not.toContain("科目暗号");
    } finally {
      delete process.env.PROCTOR_PASSPHRASE;
    }
  });

  it("plots three rounds of one subject after the round clock was rounded", async () => {
    const paper: Paper = {
      title: "测试",
      durationMinutes: null,
      questions: [{ id: "1", type: "single", stem: "测试题", options: ["甲", "乙"], score: 1, blanks: 0 }],
    };
    const saved = [];
    for (let index = 0; index < 3; index += 1) {
      await sql("select pg_sleep(0.02)");
      const published = await publishUploaded(paper, keyA);
      saved.push(published);
      await sql(
        `insert into exam_attempt (token, name, paper_updated_at, submitted_at, report)
         select $1, '考生', updated_at, now(), $2::jsonb from exam_paper where id = 1`,
        [`d${index}`.padEnd(64, "d"), JSON.stringify(report(index === 1 ? "incorrect" : "correct"))],
      );
      await sql("update exam_round set paper_updated_at = paper_updated_at - interval '400 microseconds' where paper_id = $1", [
        published.paperId,
      ]);
    }
    const chart = await subjectChart(saved[0].subjectId);
    expect(chart?.name).toBe("测试");
    expect(chart?.points).toHaveLength(3);
    expect(chart?.points.map((point) => point.rate)).toEqual([1, 0, 1]);
    const html = renderProctor({
      passphrase: "",
      questionLabel: "",
      answerLabel: "",
      summary: "",
      info: "",
      warning: "",
      error: "",
      busy: false,
      results: null,
      resultsNote: "",
      subjects: [{ id: saved[0].subjectId, name: "测试", papers: [] }],
      subjectId: saved[0].subjectId,
      paperId: null,
      chart,
      groupIds: [],
      groupTarget: "",
      groupName: "",
      groupOpen: false,
      subjectNote: "",
      subjectError: "",
    });
    expect(html).toContain("<polyline");
    expect(html).toContain("第1场");
    expect(html).toContain("第2场");
    expect(html).toContain("第3场");
    expect(html).not.toContain("科目暗号");
  });
});
