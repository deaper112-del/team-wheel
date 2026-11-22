import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { combineUploads, gradePaper } from "./grade";
import { parsePdfBuffer } from "./pdf";
import { linesFromItems, parseExamLines } from "./pdfPaper";
import { renderExam } from "./render";

describe("pdf paper text", () => {
  it("turns a wide space into a blank and keeps ordinary spaces", () => {
    const lines = linesFromItems(
      [
        { str: "1.", x: 0, y: 100, width: 12 },
        { str: " 把", x: 12, y: 100, width: 20 },
        { str: " ", x: 32, y: 100, width: 80 },
        { str: "拿出来", x: 112, y: 100, width: 40 },
      ],
      true,
    );
    expect(lines).toEqual(["1. 把____拿出来"]);
  });

  it("reads a short paper and its answer key", () => {
    const paper = parseExamLines([
      "《示例》考试题",
      "限时 30 分钟",
      "一、选择题（每题 3 分）",
      "1. 第一题？",
      "A. 甲",
      "B. 乙",
      "二、填空题（每空 2 分）",
      "1. 空是____。",
      "三、简答题（共 1 题）",
      "1. 为什么？（4分）",
    ]);
    const answers = parseExamLines([
      "《示例》标准答案",
      "一、选择题（每题 3 分）",
      "1. B. 乙",
      "解释不进答案。",
      "二、填空题（每空 2 分）",
      "1. 首都",
      "可接受：北京。写“京城”可给分；写“企业”不给分。",
      "三、简答题",
      "1. 原因（4分）",
      "参考要点：因为需要重新连接，方向不是单向的。",
      "采分说明：提到连接即可。",
    ]);
    expect(paper.ok && answers.ok).toBe(true);
    if (!paper.ok || !answers.ok || !paper.content.paper || !answers.content.key) return;
    expect(paper.content.paper.durationMinutes).toBe(30);
    expect(paper.content.paper.questions.map((question) => question.id)).toEqual(["选择1", "填空1", "简答1"]);
    expect(paper.content.paper.questions[1].blanks).toBe(1);
    const combined = combineUploads(paper.content, answers.content);
    expect(combined.ok).toBe(true);
    if (!combined.ok) return;
    const report = gradePaper(combined.paper, combined.key, {
      选择1: { type: "single", index: 1 },
      填空1: { type: "blank", values: ["京城"] },
      简答1: { type: "short", text: "人需要重新连接" },
    });
    expect(report.items.map((item) => item.earned)).toEqual([3, 2, expect.any(Number)]);
    expect(report.items[1].status).toBe("correct");
    expect(report.items[2].earned).toBeGreaterThan(0);
    expect(report.items[2].reference).toContain("重新连接");
    expect(report.items[2].reference).not.toContain("采分说明");
  });
});

describe("uploaded exam pdfs", () => {
  const dir = "/home/ubuntu/.cursor/projects/agent-repos-team-wheel/uploads";
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".pdf")) : [];

  it.skipIf(files.length < 2)("parses the prepared question and answer PDFs", async () => {
    const buffers = files.map((name) => readFileSync(`${dir}/${name}`));
    const parsed = await Promise.all(
      buffers.map((bytes) => {
        const copy = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(copy).set(bytes);
        return parsePdfBuffer(copy);
      }),
    );
    const paper = parsed.find((item) => item.ok && item.content.paper)?.ok ? parsed.find((item) => item.ok && item.content.paper) : undefined;
    const key = parsed.find((item) => item.ok && item.content.key);
    expect(paper?.ok && key?.ok).toBe(true);
    if (!paper?.ok || !key?.ok || !paper.content.paper || !key.content.key) return;
    const questions = paper.content.paper.questions;
    expect(paper.content.paper.title).toContain("第四消费时代");
    expect(paper.content.paper.durationMinutes).toBeNull();
    expect(questions.filter((question) => question.type === "single")).toHaveLength(10);
    expect(questions.filter((question) => question.type === "blank").map((question) => question.blanks)).toEqual([1, 1, 1, 1, 1, 1, 2, 1]);
    expect(questions.filter((question) => question.type === "short").map((question) => question.score)).toEqual([8, 10, 10, 10, 12]);
    expect(questions.reduce((sum, question) => sum + question.score, 0)).toBe(98);
    expect(Object.keys(key.content.key.byId).sort()).toEqual(questions.map((question) => question.id).sort());
    expect(key.content.key.byId["选择1"].answer).toBe("B");
    expect(key.content.key.byId["选择10"].answer).toBe("B");
    expect(key.content.key.byId["填空1"].answer).toEqual(["幸福", "幸福感"]);
    expect(key.content.key.byId["填空2"].answer).toEqual(["家庭", "家族"]);
    expect(key.content.key.byId["填空4"].answer).toEqual(expect.arrayContaining(["余物、余力", "余物余力", "余物和余力"]));
    expect(key.content.key.byId["填空7"].answer).toEqual([
      expect.arrayContaining(["感知到", "感知", "感受到"]),
      expect.arrayContaining(["承诺"]),
    ]);
    const examHtml = renderExam({
      paper: paper.content.paper,
      name: "周宁",
      responses: {},
      remainingMs: null,
      answered: 0,
    });
    expect(examHtml).toContain("填空题");
    expect(examHtml).toContain("简答题");
    expect(examHtml).not.toContain("多选题");
    expect(examHtml).not.toContain("判断题");
    expect(examHtml).not.toContain("幸福感");
    expect(examHtml).not.toContain("唯一正面作用");
    expect(examHtml).not.toContain("重叠并存");
    expect(examHtml).not.toContain("id=\"timer\"");
    const report = gradePaper(paper.content.paper, key.content.key, {
      选择1: { type: "single", index: 1 },
      填空1: { type: "blank", values: ["幸福感"] },
      填空2: { type: "blank", values: ["企业"] },
      填空7: { type: "blank", values: ["感知", "承诺"] },
      简答1: { type: "short", text: key.content.key.byId["简答1"].answer as string },
    });
    expect(report.items.find((item) => item.id === "选择1")).toMatchObject({ earned: 3, status: "correct" });
    expect(report.items.find((item) => item.id === "填空1")?.status).toBe("correct");
    expect(report.items.find((item) => item.id === "填空2")?.status).toBe("incorrect");
    expect(report.items.find((item) => item.id === "填空7")).toMatchObject({ earned: 4, status: "correct" });
    expect(report.items.find((item) => item.id === "简答1")?.earned).toBe(8);
  });
});
