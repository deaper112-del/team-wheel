import { describe, expect, it } from "vitest";
import { renderExam, renderResult, renderSetup } from "./render";
import { gradePaper } from "./grade";
import { parseJsonText } from "./parse";
import type { Paper } from "./types";

const partial: Paper = {
  title: "只有两种题",
  durationMinutes: null,
  questions: [
    { id: "1", type: "single", stem: "中国最长的河流是哪一条？", options: ["长江", "黄河"], score: 2, blanks: 0 },
    { id: "7", type: "short", stem: "“少壮不努力”的下一句是什么？", score: 4, options: [], blanks: 0 },
  ],
};

describe("renderExam", () => {
  it("omits sections for types that are not in the file", () => {
    const html = renderExam({
      paper: partial,
      name: "周宁",
      responses: {},
      remainingMs: null,
      answered: 0,
    });
    expect(html).toContain("单选题");
    expect(html).toContain("简答题");
    expect(html).not.toContain("多选题");
    expect(html).not.toContain("判断题");
    expect(html).not.toContain("填空题");
    expect(html).not.toContain("id=\"timer\"");
    expect(html).not.toContain("老大徒伤悲");
    expect(html).not.toContain("政治中心");
  });

  it("shows a countdown only when the paper has a duration", () => {
    const html = renderExam({
      paper: { ...partial, durationMinutes: 60 },
      name: "周宁",
      responses: {},
      remainingMs: 60 * 60 * 1000,
      answered: 0,
    });
    expect(html).toContain("剩余时间");
    expect(html).toContain("60:00");
  });

  it("starts empty, with two uploads and blank templates", () => {
    const html = renderSetup({
      name: "",
      questionLabel: "",
      answerLabel: "",
      info: "",
      warning: "",
      error: "",
      persistNote: "答卷保存在本机浏览器。",
      restored: false,
      canReset: false,
    });
    expect(html).toContain("题目文件");
    expect(html).toContain("答案文件");
    expect(html).toContain("题目 JSON");
    expect(html).toContain("答案 JSON");
    expect(html).toContain("Excel");
    expect(html).toContain("PDF");
    expect(html).toContain("文件格式说明");
    expect(html).not.toContain("单选题");
    expect(html).not.toContain("type=\"radio\"");
  });
});

describe("renderResult", () => {
  it("shows the score, the candidate answer, and the reference", () => {
    const parsed = parseJsonText(`{
      "title":"考试名称",
      "questions":[
        {"id":"5","type":"short","stem":"题干","score":10}
      ]
    }`);
    const answers = parseJsonText(`{"answers":[{"id":"5","answer":"参考答案","keywords":["关键词1","关键词2"]}]}`);
    if (!parsed.ok || !answers.ok || !parsed.content.paper || !answers.content.key) throw new Error("parse");
    const report = gradePaper(parsed.content.paper, answers.content.key, {
      "5": { type: "short", text: "关键词1" },
    });
    const html = renderResult({
      paper: parsed.content.paper,
      name: "周宁",
      report,
      autoSubmitted: false,
    });
    expect(html).toContain("5");
    expect(html).toContain("部分正确");
    expect(html).toContain("你的答案");
    expect(html).toContain("参考答案");
    expect(html).toContain("关键词1");
    expect(html).toContain("再考一次");
    expect(html).toContain("重新上传");
  });
});
