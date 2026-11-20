import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseJsonText, parseWorkbook, parseXlsxBuffer } from "./parse";
import { ANSWER_HEADERS, QUESTION_HEADERS, questionTemplateText, templateWorkbook } from "./templates";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

function sheet(name: string, rows: unknown[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

describe("parseJsonText", () => {
  it("reads the fixture paper and keeps only the types that are present", () => {
    const parsed = parseJsonText(readFileSync(join(root, "partial-questions.json"), "utf8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.content.paper) return;
    expect(parsed.content.paper.questions.map((question) => question.type)).toEqual(["single", "short"]);
    expect(parsed.content.paper.durationMinutes).toBeNull();
  });

  it("explains a bad file in Chinese", () => {
    const parsed = parseJsonText(readFileSync(join(root, "bad.json"), "utf8"));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/题号|题型/);
    expect(parseJsonText("{")).toMatchObject({ ok: false, error: "文件不是有效的 JSON。" });
    expect(parseJsonText(`{"title":"空","questions":[]}`)).toMatchObject({
      ok: false,
      error: "题目文件中没有题目。",
    });
  });

  it("rejects a duplicate id instead of throwing", () => {
    const parsed = parseJsonText(`{
      "questions": [
        {"id":"1","type":"judge","stem":"题干","score":1},
        {"id":"1","type":"judge","stem":"另一题","score":1}
      ]
    }`);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("重复");
  });
});

describe("excel", () => {
  it("reads both sheets, separate sheets, and a paper that omits types", () => {
    const questionRows = [
      [...QUESTION_HEADERS, "时长"],
      ["1", "单选", "中国最长的河流是哪一条？", "长江", "黄河", "", "", "", "", 2, "", 60],
      ["2", "多选", "下面哪些是水果？", "苹果", "香蕉", "胡萝卜", "梨", "", "", 4, "", ""],
      ["3", "判断", "地球是太阳系的行星。", "", "", "", "", "", "", 1, "", ""],
      ["4", "填空", "北京是中国的____。", "", "", "", "", "", "", 2, 1, ""],
      ["5", "简答", "说明北京的地位", "", "", "", "", "", "", 10, "", ""],
    ];
    const answerRows = [
      [...ANSWER_HEADERS],
      ["1", "A", ""],
      ["2", "A,C", ""],
      ["3", "对", ""],
      ["4", "首都/北京", ""],
      ["5", "北京是中国的首都。", "首都,政治中心"],
    ];
    const both = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(both, sheet("题目", questionRows), "题目");
    XLSX.utils.book_append_sheet(both, sheet("答案", answerRows), "答案");
    const parsed = parseWorkbook(both);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.content.paper || !parsed.content.key) return;
    expect(parsed.content.paper.durationMinutes).toBe(60);
    expect(parsed.content.paper.questions.map((question) => question.type)).toEqual([
      "single",
      "multiple",
      "judge",
      "blank",
      "short",
    ]);
    expect(parsed.content.key.byId["2"].answer).toBe("A,C");
    expect(parsed.content.key.byId["2"].excel).toBe(true);
    expect(parsed.content.key.byId["4"].answer).toBe("首都/北京");
    expect(parsed.content.key.byId["5"].keywords).toEqual(["首都", "政治中心"]);

    const questionsOnly = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(questionsOnly, sheet("题目", questionRows.slice(0, 2)), "题目");
    const onlyQuestions = parseWorkbook(questionsOnly);
    expect(onlyQuestions.ok).toBe(true);
    if (onlyQuestions.ok) {
      expect(onlyQuestions.content.paper?.questions).toHaveLength(1);
      expect(onlyQuestions.content.key).toBeNull();
    }

    const omitted = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      omitted,
      sheet("题目", [
        [...QUESTION_HEADERS],
        ["1", "单选", "题干", "甲", "乙", "", "", "", "", 2, ""],
        ["2", "简答", "题干", "", "", "", "", "", "", 4, ""],
      ]),
      "Sheet1",
    );
    const omittedParsed = parseWorkbook(omitted);
    expect(omittedParsed.ok).toBe(true);
    if (omittedParsed.ok && omittedParsed.content.paper) {
      expect(omittedParsed.content.paper.questions.map((question) => question.type)).toEqual(["single", "short"]);
    }
  });

  it("keeps Chinese sheet names when the file is read back from bytes", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      sheet("题目", [
        [...QUESTION_HEADERS],
        ["1", "判断", "地球是圆的。", "", "", "", "", "", "", 1, ""],
      ]),
      "题目",
    );
    XLSX.utils.book_append_sheet(workbook, sheet("答案", [[...ANSWER_HEADERS], ["1", "对", ""]]), "答案");
    const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const parsed = parseXlsxBuffer(output);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.content.paper || !parsed.content.key) return;
    expect(parsed.content.paper.questions[0].stem).toBe("地球是圆的。");
    expect(parsed.content.key.byId["1"].answer).toBe("对");
  });

  it("reports a workbook that is not a spreadsheet", () => {
    const garbage = new TextEncoder().encode("not excel");
    const parsed = parseXlsxBuffer(garbage.buffer.slice(garbage.byteOffset, garbage.byteOffset + garbage.byteLength));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("Excel");
  });
});

describe("fixtures", () => {
  it("parses the committed workbook the same way as the JSON paper", () => {
    const json = parseJsonText(readFileSync(join(root, "full-questions.json"), "utf8"));
    const file = readFileSync(join(root, "full.xlsx"));
    const workbook = parseXlsxBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
    expect(json.ok && workbook.ok).toBe(true);
    if (!json.ok || !workbook.ok || !json.content.paper || !workbook.content.paper || !workbook.content.key) return;
    expect(workbook.content.paper.questions.map((question) => question.type)).toEqual(
      json.content.paper.questions.map((question) => question.type),
    );
    expect(workbook.content.key.byId["4"].answer).toBe("首都/北京");
    expect(workbook.content.key.byId["6"].keywords).toEqual(["首都", "政治中心"]);
  });
});

describe("templates", () => {
  it("downloads blank JSON and an xlsx whose headers match the format", () => {
    const questions = parseJsonText(questionTemplateText());
    expect(questions.ok).toBe(false);
    if (!questions.ok) expect(questions.error).toBe("题目文件中没有题目。");

    const bytes = new Uint8Array(templateWorkbook());
    const workbook = XLSX.read(bytes, { type: "array" });
    expect(workbook.SheetNames).toEqual(["题目", "答案"]);
    const questionHeader = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets["题目"], {
      header: 1,
    })[0];
    const answerHeader = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets["答案"], {
      header: 1,
    })[0];
    expect(questionHeader).toEqual([...QUESTION_HEADERS]);
    expect(answerHeader).toEqual([...ANSWER_HEADERS]);
    expect(
      XLSX.utils.sheet_to_json(workbook.Sheets["题目"], { header: 1 }).length,
    ).toBe(1);
  });
});
