import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { combineUploads, gradePaper } from "./grade";
import { parseJsonText } from "./parse";
import type { ResponseValue } from "./types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

function loadPaper(name: string) {
  const parsed = parseJsonText(readFileSync(join(root, name), "utf8"));
  if (!parsed.ok || !parsed.content.paper) throw new Error(parsed.ok ? "no paper" : parsed.error);
  return parsed.content.paper;
}

function loadKey(name: string) {
  const parsed = parseJsonText(readFileSync(join(root, name), "utf8"));
  if (!parsed.ok || !parsed.content.key) throw new Error(parsed.ok ? "no key" : parsed.error);
  return parsed.content.key;
}

const paper = loadPaper("full-questions.json");
const key = loadKey("full-answers.json");

function grade(responses: Record<string, ResponseValue>) {
  return gradePaper(paper, key, responses);
}

describe("gradePaper", () => {
  it("scores the spec sample, including keyword ratio and full credit", () => {
    const samplePaper = parseJsonText(`{
      "title": "考试名称",
      "durationMinutes": 60,
      "questions": [
        {"id":"1","type":"single","stem":"题干","options":["选项一","选项二"],"score":2},
        {"id":"2","type":"multiple","stem":"题干","options":["选项一","选项二","选项三"],"score":4},
        {"id":"3","type":"judge","stem":"题干","score":1},
        {"id":"4","type":"blank","stem":"北京是中国的____。","blanks":1,"score":2},
        {"id":"5","type":"short","stem":"题干","score":10}
      ]
    }`);
    const sampleKey = parseJsonText(`{
      "answers": [
        {"id":"1","answer":"A"},
        {"id":"2","answer":["A","C"]},
        {"id":"3","answer":true},
        {"id":"4","answer":["首都"]},
        {"id":"5","answer":"参考答案","keywords":["关键词1","关键词2"]}
      ]
    }`);
    if (!samplePaper.ok || !sampleKey.ok || !samplePaper.content.paper || !sampleKey.content.key) {
      throw new Error("sample failed");
    }
    const report = gradePaper(samplePaper.content.paper, sampleKey.content.key, {
      "1": { type: "single", index: 0 },
      "2": { type: "multiple", indices: [2, 0] },
      "3": { type: "judge", value: true },
      "4": { type: "blank", values: ["  首都  "] },
      "5": { type: "short", text: "这里有关键词1" },
    });
    expect(report.items.map((item) => [item.id, item.earned, item.status])).toEqual([
      ["1", 2, "correct"],
      ["2", 4, "correct"],
      ["3", 1, "correct"],
      ["4", 2, "correct"],
      ["5", 5, "partial"],
    ]);
    expect(report.total).toBe(14);
    expect(report.items[4].reference).toContain("参考答案");
    expect(report.items[4].reference).toContain("关键词1");
    expect(report.items[4].note).toBe("命中 1/2 个关键词");

    const full = gradePaper(samplePaper.content.paper, sampleKey.content.key, {
      "5": { type: "short", text: "关键词2，还有关键词1" },
    });
    expect(full.items[4].earned).toBe(10);
    expect(full.items[4].status).toBe("correct");
  });

  it("accepts a letter, the option text, or a zero-based index", () => {
    const forms = ["A", "长江", 0, "0"];
    for (const answer of forms) {
      const parsed = parseJsonText(JSON.stringify({ answers: [{ id: "1", answer }] }));
      if (!parsed.ok || !parsed.content.key) throw new Error("key");
      const report = gradePaper(paper, parsed.content.key, {
        "1": { type: "single", index: 0 },
      });
      expect(report.items[0].status).toBe("correct");
      expect(report.items[0].reference).toBe("A. 长江");
    }
  });

  it("scores multiple choice as an exact set", () => {
    const correct = grade({ "2": { type: "multiple", indices: [3, 0, 1] } });
    expect(correct.items[1].status).toBe("correct");
    expect(correct.items[1].earned).toBe(4);

    const missing = grade({ "2": { type: "multiple", indices: [0, 1] } });
    expect(missing.items[1].status).toBe("incorrect");
    expect(missing.items[1].earned).toBe(0);

    const extra = grade({ "2": { type: "multiple", indices: [0, 1, 2, 3] } });
    expect(extra.items[1].earned).toBe(0);
  });

  it("scores blanks in order, ignoring case and surrounding spaces, with alternatives", () => {
    const report = grade({
      "4": { type: "blank", values: [" 北京 "] },
      "5": { type: "blank", values: ["BeiJing", "中国"] },
    });
    expect(report.items[3].status).toBe("correct");
    expect(report.items[4].status).toBe("incorrect");

    const swapped = grade({
      "5": { type: "blank", values: ["中国", "北京"] },
    });
    expect(swapped.items[4].status).toBe("incorrect");

    const english = gradePaper(
      {
        title: "case",
        durationMinutes: null,
        questions: [{ id: "b", type: "blank", stem: "The capital is ____.", blanks: 1, score: 2, options: [] }],
      },
      {
        byId: {
          b: { id: "b", answer: ["BeiJing"], keywords: [], excel: false },
        },
      },
      { b: { type: "blank", values: ["  beijing "] } },
    );
    expect(english.items[0].status).toBe("correct");
  });

  it("rounds keyword credit and falls back to normalized exact text", () => {
    const oneThird = gradePaper(
      {
        title: "kw",
        durationMinutes: null,
        questions: [{ id: "s", type: "short", stem: "题干", score: 10, options: [], blanks: 0 }],
      },
      { byId: { s: { id: "s", answer: "参考", keywords: ["甲", "乙", "丙"], excel: false } } },
      { s: { type: "short", text: "只写了甲" } },
    );
    expect(oneThird.items[0].earned).toBe(3);
    const twoThirds = gradePaper(
      oneThird.items[0] ? {
        title: "kw",
        durationMinutes: null,
        questions: [{ id: "s", type: "short", stem: "题干", score: 10, options: [], blanks: 0 }],
      } : paper,
      { byId: { s: { id: "s", answer: "参考", keywords: ["甲", "乙", "丙"], excel: false } } },
      { s: { type: "short", text: "甲和乙" } },
    );
    expect(twoThirds.items[0].earned).toBe(7);

    const exact = grade({ "7": { type: "short", text: "老大  徒伤悲" } });
    expect(exact.items[6].status).toBe("correct");
    expect(exact.items[6].earned).toBe(4);
    expect(exact.items[6].reference).toBe("老大徒伤悲");

    const wrong = grade({ "7": { type: "short", text: "少壮不努力" } });
    expect(wrong.items[6].status).toBe("incorrect");
  });

  it("grades Excel blank and multiple-choice spellings", () => {
    const report = gradePaper(
      {
        title: "excel",
        durationMinutes: null,
        questions: [
          { id: "2", type: "multiple", stem: "水果", options: ["苹果", "香蕉", "胡萝卜", "梨"], score: 4, blanks: 0 },
          { id: "4", type: "blank", stem: "北京是中国的____。", blanks: 1, score: 2, options: [] },
          { id: "5", type: "blank", stem: "____是____的首都。", blanks: 2, score: 4, options: [] },
        ],
      },
      {
        byId: {
          "2": { id: "2", answer: "A,C", keywords: [], excel: true },
          "4": { id: "4", answer: "首都/北京", keywords: [], excel: true },
          "5": { id: "5", answer: "北京|中国", keywords: [], excel: true },
        },
      },
      {
        "2": { type: "multiple", indices: [0, 2] },
        "4": { type: "blank", values: ["北京"] },
        "5": { type: "blank", values: ["北京", "中国"] },
      },
    );
    expect(report.items.map((item) => item.status)).toEqual(["correct", "correct", "correct"]);
    expect(report.total).toBe(10);
  });

  it("marks a missing answer as ungradable and names the id", () => {
    const partialKey = loadKey("missing-answers.json");
    const report = gradePaper(paper, partialKey, {
      "1": { type: "single", index: 0 },
    });
    expect(report.missingIds).toEqual(["2", "3", "4", "5", "6", "7"]);
    expect(report.items[1].status).toBe("ungraded");
    expect(report.items[1].yours).toBe("未作答");
    expect(report.items[1].reference).toBe("答案文件中没有这道题");
    expect(report.items[0].status).toBe("correct");
    expect(report.total).toBe(2);
    expect(report.gradedMax).toBe(2);
    expect(report.paperMax).toBe(27);
  });

  it("sums earned points and treats an empty response as unanswered", () => {
    const report = grade({
      "1": { type: "single", index: 1 },
      "3": { type: "judge", value: false },
      "6": { type: "short", text: "北京是政治中心" },
    });
    expect(report.items[0]).toMatchObject({ earned: 0, status: "incorrect" });
    expect(report.items[1]).toMatchObject({ earned: 0, status: "blank", yours: "未作答" });
    expect(report.items[2]).toMatchObject({ earned: 0, status: "incorrect", reference: "对" });
    expect(report.items[5]).toMatchObject({ earned: 5, status: "partial" });
    expect(report.total).toBe(5);
  });
});

describe("combineUploads", () => {
  it("rejects an answer file that shares no question ids", () => {
    const other = parseJsonText(`{"answers":[{"id":"999","answer":"A"}]}`);
    if (!other.ok) throw new Error(other.error);
    const result = combineUploads({ paper, key: null }, other.content);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("对不上");
  });

  it("warns when only some ids are missing", () => {
    const result = combineUploads({ paper, key: null }, { paper: null, key: loadKey("missing-answers.json") });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warning).toContain("2、3、4、5、6、7");
  });
});

describe("app source", () => {
  it("does not embed the fixture answers", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "render.ts"), "utf8");
    expect(source).not.toContain("老大徒伤悲");
    expect(source).not.toContain("政治中心");
  });
});
