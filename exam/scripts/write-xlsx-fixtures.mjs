import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const questionHeaders = ["题号", "题型", "题干", "选项A", "选项B", "选项C", "选项D", "选项E", "选项F", "分值", "空数"];
const answerHeaders = ["题号", "答案", "关键词"];

const questions = [
  ["1", "单选", "中国最长的河流是哪一条？", "长江", "黄河", "珠江", "淮河", "", "", 2, ""],
  ["2", "多选", "下面哪些是水果？", "苹果", "香蕉", "胡萝卜", "梨", "", "", 4, ""],
  ["3", "判断", "地球是太阳系的行星。", "", "", "", "", "", "", 1, ""],
  ["4", "填空", "北京是中国的____。", "", "", "", "", "", "", 2, 1],
  ["5", "填空", "____是____的首都。", "", "", "", "", "", "", 4, 2],
  ["6", "简答", "用一句话说明北京在中国的地位。", "", "", "", "", "", "", 10, ""],
  ["7", "简答", "“少壮不努力”的下一句是什么？", "", "", "", "", "", "", 4, ""],
];
const answers = [
  ["1", "A", ""],
  ["2", "A,B,D", ""],
  ["3", "对", ""],
  ["4", "首都/北京", ""],
  ["5", "北京|中国", ""],
  ["6", "北京是中国的首都。", "首都,政治中心"],
  ["7", "老大徒伤悲", ""],
];

function book(sheets) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  return output;
}

writeFileSync(
  join(fixtures, "full.xlsx"),
  book([
    ["题目", [questionHeaders, ...questions]],
    ["答案", [answerHeaders, ...answers]],
  ]),
);
writeFileSync(join(fixtures, "questions-only.xlsx"), book([["题目", [questionHeaders, ...questions]]]));
writeFileSync(join(fixtures, "answers-only.xlsx"), book([["答案", [answerHeaders, ...answers]]]));
console.log("wrote xlsx fixtures");
