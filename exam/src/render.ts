import { splitBlankStem } from "./blanks";
import {
  SECTION_HINT,
  STATUS_LABEL,
  TYPE_LABEL,
  TYPE_ORDER,
  formatDuration,
  formatPoints,
  sectionTitle,
} from "./display";
import type { GradeReport, Paper, Question, QuestionType, ResponseValue } from "./types";

/**
 * Exam markup is built only from the paper and the candidate's own answers.
 * The answer key is never passed in, so it cannot land in the DOM before submit.
 */
export interface ExamView {
  paper: Paper;
  name: string;
  responses: Record<string, ResponseValue | undefined>;
  remainingMs: number | null;
  answered: number;
}

export interface GateView {
  error: string;
}

export interface CandidateView {
  ready: boolean;
  summary: string;
  name: string;
  error: string;
  note: string;
}

export interface ScoreRow {
  name: string;
  score: number;
  total: number;
}

export interface QuestionRate {
  id: string;
  stem: string;
  correct: number;
  wrong: number;
  total: number;
}

export interface RoundSnapshot {
  released: boolean;
  candidates: ScoreRow[];
  hardest: QuestionRate | null;
  easiest: QuestionRate | null;
}

export interface SavedPaperInfo {
  id: number;
  title: string;
  createdAt: string;
  questionCount: number;
}

export interface SubjectInfo {
  id: number;
  name: string;
  papers: SavedPaperInfo[];
}

export interface LearningPoint {
  round: number;
  at: string;
  paperTitle: string;
  rate: number | null;
  correct: number;
  total: number;
}

export interface LearningChart {
  name: string;
  points: LearningPoint[];
}

export interface ProctorView {
  passphrase: string;
  questionLabel: string;
  answerLabel: string;
  summary: string;
  info: string;
  warning: string;
  error: string;
  busy: boolean;
  results: RoundSnapshot | null;
  resultsNote: string;
  subjects: SubjectInfo[];
  subjectId: number | null;
  paperId: number | null;
  chart: LearningChart | null;
  groupIds: number[];
  groupTarget: string;
  groupName: string;
  groupOpen: boolean;
  subjectNote: string;
  subjectError: string;
  names: string[];
  candidateName: string;
  candidateChart: LearningChart | null;
}

export interface ResultView {
  paper: Paper;
  name: string;
  report: GradeReport | null;
  autoSubmitted: boolean;
  released: boolean;
  error?: string;
}

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function banner(kind: "bad" | "warn" | "info", text: string, role?: string): string {
  if (!text) return "";
  const alert = role ? ` role="${role}"` : "";
  return `<p class="banner ${kind}"${alert}>${esc(text)}</p>`;
}

function mast(eyebrow: string, title: string): string {
  return `<header class="mast">
      <div class="brand">
        <span class="seal" aria-hidden="true">考</span>
        <div>
          <p class="eyebrow">${esc(eyebrow)}</p>
          <h1>${esc(title)}</h1>
        </div>
      </div>
    </header>`;
}

export function renderGate(view: GateView): string {
  return `<div class="wrap">
    ${mast("同一链接", "在线考试")}
    <section class="card">
      <p class="lede">监考发布一次题目和答案。考生只填写姓名，然后作答。交卷前看不到答案。</p>
      ${banner("bad", view.error, "alert")}
      <div class="row-actions">
        <button type="button" class="primary" id="role-candidate">我是考生</button>
        <button type="button" class="ghost" id="role-proctor">我是监考</button>
      </div>
    </section>
  </div>`;
}

export function renderCandidate(view: CandidateView): string {
  const ready = view.ready
    ? `<p class="summary">${esc(view.summary)}</p>
      <label class="name-field" for="candidate-name">考生姓名
        <input id="candidate-name" name="candidate" maxlength="30" autocomplete="name" placeholder="请输入姓名" value="${esc(view.name)}">
      </label>
      <div class="row-actions">
        <button type="submit" class="primary">开始考试</button>
      </div>`
    : `<p class="lede">考试还没开始。</p>
      <p class="fine">监考发布试卷之后，刷新这个页面即可。</p>
      <div class="row-actions">
        <button type="button" class="primary" id="refresh-exam">再看看</button>
      </div>`;
  return `<div class="wrap">
    ${mast("考生", "在线考试")}
    <form id="candidate-form" class="card">
      ${ready}
      ${banner("bad", view.error, "alert")}
      <p class="fine">${esc(view.note)}</p>
      <div class="row-actions">
        <button type="button" class="ghost" id="back-gate">返回</button>
      </div>
    </form>
  </div>`;
}

export function renderProctor(view: ProctorView): string {
  return `<div class="wrap">
    ${mast("监考", "发布试卷")}
    <form id="proctor-form" class="card">
      <p class="lede">上传题目和答案后，所有考生打开同一链接、填写姓名即可开始。再上传会开始新的一场，原来的试卷留在科目里。</p>
      ${view.summary ? `<p class="summary">${esc(view.summary)}</p>` : `<p class="fine">还没有发布试卷。</p>`}
      <label class="name-field" for="proctor-pass">监考口令
        <input id="proctor-pass" type="password" autocomplete="current-password" placeholder="请输入口令" value="${esc(view.passphrase)}">
      </label>
      <div class="uploads">
        <label class="file">
          <span class="file-kicker">题目文件</span>
          <span class="file-name">${esc(view.questionLabel || "尚未选择")}</span>
          <span class="file-hint">JSON、Excel 或 PDF</span>
          <input id="question-file" type="file" accept=".json,.xlsx,.xls,.pdf,application/json,application/pdf" aria-label="题目文件">
        </label>
        <label class="file">
          <span class="file-kicker">答案文件</span>
          <span class="file-name">${esc(view.answerLabel || "尚未选择")}</span>
          <span class="file-hint">JSON、Excel 或 PDF</span>
          <input id="answer-file" type="file" accept=".json,.xlsx,.xls,.pdf,application/json,application/pdf" aria-label="答案文件">
        </label>
      </div>
      <div class="template-row">
        <span>空白模板</span>
        <button type="button" class="ghost" id="tpl-q-json">题目 JSON</button>
        <button type="button" class="ghost" id="tpl-a-json">答案 JSON</button>
        <button type="button" class="ghost" id="tpl-xlsx">Excel</button>
      </div>
      <details class="help">
        <summary>文件格式说明</summary>
        <div class="help-body">
          <p>JSON 题目包含 title、可选的 durationMinutes（分钟）和 questions。每题写 id、type、stem、score。type 取 single（单选）、multiple（多选）、judge（判断）、blank（填空）、short（简答）。单选和多选要有 options，填空要有 blanks。</p>
          <p>JSON 答案包含 answers。选择题的 answer 可以是字母 A、选项原文，或从 0 开始的序号。多选写成数组，例如 ["A","C"]。判断写 true 或 false。填空按空的顺序写；一个空有多个答案时套一层数组，例如 [["首都","北京"],["中国"]]。简答的 answer 是参考答案，keywords 是关键词。</p>
          <p>Excel 可以用「题目」「答案」两张表，放在同一个文件或分成两个文件。题目列：题号、题型、题干、选项A 到 选项F、分值、空数。题型填单选、多选、判断、填空、简答。答案列：题号、答案、关键词。多选写成 A,C。判断填对或错。填空用 | 分隔各空，用 / 分隔同一空的多个答案。简答关键词用逗号分隔。题目表可加可选列「时长」表示整场分钟数。</p>
          <p>PDF 分成题目卷和答案卷上传。大题标题写成「一、选择题」「二、多选题」「三、判断题」「四、填空题」「五、简答题」。选择题在标题里写「每题 N 分」，选项单独成行，如 A. B.。填空在标题里写「每空 N 分」，空用下划线留出。简答在题干末尾写（N分）。答案卷用同一题号：选择题写「1. B」，多选写「1. A、C」，判断写「1. 对」，填空直接写答案，需要时加「可接受：」。简答写「参考要点」，按其中的关键词比例给分。监考公布答案后，考生才能看到参考要点。建议用时不会自动交卷，只有写明「限时 N 分钟」才倒计时。</p>
        </div>
      </details>
      ${banner("info", view.info)}
      ${banner("warn", view.warning)}
      ${banner("bad", view.error, "alert")}
      <div class="row-actions">
        <button type="submit" class="primary" id="publish"${view.busy ? " disabled" : ""}>发布试卷</button>
        <button type="button" class="ghost" id="back-gate">返回</button>
      </div>
    </form>
    ${subjectsCard(view)}
    <section class="card" id="proctor-results">
      <h2>本场成绩</h2>
      <p class="fine">查看这一场已经交卷的考生。公布答案之后，考生重新打开成绩就能看到正确答案。</p>
      <div class="row-actions">
        <button type="button" class="primary" id="load-results"${view.busy ? " disabled" : ""}>查看成绩</button>
        <button type="button" class="ghost" id="release-answers"${view.busy ? " disabled" : ""}>公布答案</button>
      </div>
      ${banner("info", view.resultsNote)}
      ${resultsBody(view.results)}
    </section>
  </div>`;
}

function whenLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function subjectsCard(view: ProctorView): string {
  const subject = view.subjects.find((item) => item.id === view.subjectId) ?? view.subjects[0];
  const subjectOptions = view.subjects
    .map((item) => `<option value="${item.id}"${item.id === subject?.id ? " selected" : ""}>${esc(item.name)}（${item.papers.length} 份）</option>`)
    .join("");
  const papers = subject?.papers ?? [];
  const paperId = papers.some((item) => item.id === view.paperId) ? view.paperId : papers[0]?.id;
  const paperOptions = papers
    .map(
      (item) =>
        `<option value="${item.id}"${item.id === paperId ? " selected" : ""}>${esc(item.title)} · ${item.questionCount} 题 · ${esc(whenLabel(item.createdAt))}</option>`,
    )
    .join("");
  const checks = view.subjects
    .flatMap((item) =>
      item.papers.map(
        (paper) => `<label class="check">
          <input class="group-paper" type="checkbox" value="${paper.id}"${view.groupIds.includes(paper.id) ? " checked" : ""}>
          <span>${esc(item.name)} · ${esc(paper.title)} · ${paper.questionCount} 题</span>
        </label>`,
      ),
    )
    .join("");
  const groupOptions = [
    `<option value=""${view.groupTarget === "" ? " selected" : ""}>新建科目</option>`,
    ...view.subjects.map(
      (item) => `<option value="${item.id}"${view.groupTarget === String(item.id) ? " selected" : ""}>${esc(item.name)}</option>`,
    ),
  ].join("");
  return `<section class="card" id="saved-subjects">
      <h2>已保存的科目</h2>
      <p class="fine">每份上传的试卷都会留下。题目相同的试卷自动算作同一科目，选中后可以直接再开一场，不用重新上传。</p>
      <div class="row-actions">
        <button type="button" class="ghost" id="load-subjects"${view.busy ? " disabled" : ""}>刷新科目</button>
      </div>
      ${banner("info", view.subjectNote)}
      ${banner("bad", view.subjectError, "alert")}
      <label class="name-field" for="subject-pick">科目
        <select id="subject-pick"${view.subjects.length === 0 ? " disabled" : ""}>
          ${subjectOptions || `<option value="">还没有保存的科目</option>`}
        </select>
      </label>
      <label class="name-field" for="paper-pick">这一科的试卷
        <select id="paper-pick"${papers.length === 0 ? " disabled" : ""}>
          ${paperOptions || `<option value="">先上传或刷新科目</option>`}
        </select>
      </label>
      <div class="row-actions">
        <button type="button" class="primary" id="start-saved"${view.busy || papers.length === 0 ? " disabled" : ""}>开始这场考试</button>
      </div>
      <details id="group-menu" class="help"${view.groupOpen ? " open" : ""}>
        <summary>合并科目</summary>
        <div class="help-body">
          <p>勾选已经上传的试卷，把它们归到同一个科目。题目完全相同的试卷会一起过去，之后共用下面的学习力曲线。</p>
          <div class="paper-checks">${checks || `<p class="fine">还没有可以合并的试卷。</p>`}</div>
          <label class="name-field" for="group-target">合并到
            <select id="group-target">${groupOptions}</select>
          </label>
          <label class="name-field" for="group-name">新科目名称
            <input id="group-name" type="text" maxlength="40" placeholder="选「新建科目」时填写" value="${esc(view.groupName)}">
          </label>
          <div class="row-actions">
            <button type="button" class="primary" id="group-papers"${view.busy ? " disabled" : ""}>合并到这个科目</button>
          </div>
        </div>
      </details>
      <h2 class="chart-title">学习力曲线</h2>
      <p class="fine">${subject ? `${esc(subject.name)}的各场考试画在同一条曲线上。` : "刷新科目后，这里按科目画出各场正确率。"}</p>
      ${chartBody(view.chart, "rate")}
      <h2 class="chart-title">个人成绩</h2>
      <p class="fine">选择一个考过这一科的人，看这个人各场的得分。</p>
      <label class="name-field" for="candidate-pick">考生
        <select id="candidate-pick"${view.names.length === 0 ? " disabled" : ""}>
          ${view.names.length === 0 ? `<option value="">还没有考生交卷</option>` : `<option value="">选择考生</option>`}
          ${view.names
            .map((name) => `<option value="${esc(name)}"${name === view.candidateName ? " selected" : ""}>${esc(name)}</option>`)
            .join("")}
        </select>
      </label>
      ${view.candidateName && !view.candidateChart ? `<p class="fine">这个人还没有这一科的成绩。</p>` : chartBody(view.candidateChart, "score")}
    </section>`;
}

function chartBody(chart: LearningChart | null, mode: "rate" | "score"): string {
  if (!chart) return "";
  if (chart.points.length === 0) return `<p class="fine">${mode === "score" ? "这个人还没有这一科的成绩。" : "这一科还没有开过考。"}</p>`;
  const rows = chart.points
    .map((point) => {
      const rate = point.rate == null ? "尚未交卷" : `${Math.round(point.rate * 100)}%`;
      const score = point.rate == null ? "尚未交卷" : `${formatPoints(point.correct)} / ${formatPoints(point.total)}`;
      return `<tr><td>第${point.round}场</td><td>${esc(point.paperTitle)}</td><td>${mode === "score" ? score : rate}</td><td>${mode === "score" ? rate : `${point.correct} / ${point.total}`}</td></tr>`;
    })
    .join("");
  const graded = chart.points.filter((point) => point.rate != null).length;
  const hint = graded < 2 ? `<p class="fine">再完成一场并有人交卷后，点会连成曲线。</p>` : "";
  const label = mode === "score" ? "个人成绩" : "学习力曲线";
  return `${learningSvg(chart.points, label, mode === "score" ? "#8a4b08" : "#0c5c56")}
    ${hint}
    <table class="score-table">
      <thead><tr><th>场次</th><th>试卷</th><th>${mode === "score" ? "得分" : "正确率"}</th><th>${mode === "score" ? "得分率" : "答对"}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function learningSvg(points: LearningPoint[], label: string, color: string): string {
  const width = 320;
  const height = 168;
  const left = 36;
  const right = 8;
  const top = 20;
  const bottom = 36;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const xAt = (index: number) => (points.length === 1 ? left + innerW / 2 : left + (innerW * index) / (points.length - 1));
  const yAt = (rate: number) => top + innerH * (1 - rate);
  const grids = [0, 0.5, 1]
    .map((rate) => {
      const y = yAt(rate);
      return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#e3d9c8"/>
        <text x="0" y="${y + 4}" font-size="11" fill="#5d6b66">${Math.round(rate * 100)}%</text>`;
    })
    .join("");
  const scored: string[] = [];
  const dots: string[] = [];
  points.forEach((point, index) => {
    const x = xAt(index);
    if (point.rate == null) {
      dots.push(`<text x="${x}" y="${height - 14}" text-anchor="middle" font-size="11" fill="#5d6b66">第${point.round}场</text>`);
      return;
    }
    const y = yAt(point.rate);
    scored.push(`${x},${y}`);
    dots.push(
      `<circle cx="${x}" cy="${y}" r="4.5" fill="${color}"/>
       <text x="${x}" y="${y - 8}" text-anchor="middle" font-size="11" fill="${color}">${Math.round(point.rate * 100)}%</text>
       <text x="${x}" y="${height - 14}" text-anchor="middle" font-size="11" fill="#5d6b66">第${point.round}场</text>`,
    );
  });
  const lines =
    scored.length >= 2
      ? `<polyline points="${scored.join(" ")}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`
      : "";
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">
    ${grids}
    ${lines}
    ${dots.join("")}
  </svg>`;
}

function clipStem(stem: string): string {
  const text = stem.replace(/\s+/g, " ").trim();
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

function rateLine(label: string, item: QuestionRate | null, kind: "wrong" | "correct"): string {
  if (!item) return "";
  const count = kind === "wrong" ? item.wrong : item.correct;
  const verb = kind === "wrong" ? "答错" : "答对";
  return `<p><strong>${esc(label)}</strong> 题号 ${esc(item.id)}，${count} / ${item.total} 人${verb}。${esc(clipStem(item.stem))}</p>`;
}

function resultsBody(results: RoundSnapshot | null): string {
  if (!results) return "";
  if (results.candidates.length === 0) return `<p class="fine">还没有人交卷。</p>`;
  const rows = results.candidates
    .map(
      (row) =>
        `<tr><td>${esc(row.name)}</td><td>${esc(formatPoints(row.score))} / ${esc(formatPoints(row.total))}</td></tr>`,
    )
    .join("");
  return `<p class="fine">${results.released ? "答案已公布。" : "答案尚未公布。"}已交卷 ${results.candidates.length} 份。</p>
    <table class="score-table">
      <thead><tr><th>姓名</th><th>得分</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${rateLine("答错最多", results.hardest, "wrong")}
    ${rateLine("答对最多", results.easiest, "correct")}`;
}

function responseOf(question: Question, responses: ExamView["responses"]): ResponseValue | undefined {
  const value = responses[question.id];
  return value && value.type === question.type ? value : undefined;
}

function choiceControl(question: Question, response: ResponseValue | undefined, multiple: boolean): string {
  const selected = new Set<number>();
  if (response?.type === "single" && response.index != null) selected.add(response.index);
  if (response?.type === "multiple") response.indices.forEach((index) => selected.add(index));
  const type = multiple ? "checkbox" : "radio";
  return question.options
    .map((option, index) => {
      const letter = String.fromCharCode(65 + index);
      const checked = selected.has(index) ? " checked" : "";
      return `<label class="option">
        <input type="${type}" name="q-${esc(question.id)}" data-qid="${esc(question.id)}" value="${index}"${checked}>
        <span><b>${letter}.</b> ${esc(option)}</span>
      </label>`;
    })
    .join("");
}

function judgeControl(question: Question, response: ResponseValue | undefined): string {
  const value = response?.type === "judge" ? response.value : null;
  const button = (label: string, flag: "true" | "false") => {
    const checked = (flag === "true" && value === true) || (flag === "false" && value === false) ? " checked" : "";
    return `<label class="option">
      <input type="radio" name="q-${esc(question.id)}" data-qid="${esc(question.id)}" value="${flag}"${checked}>
      <span>${label}</span>
    </label>`;
  };
  return `${button("对", "true")}${button("错", "false")}`;
}

function blankControl(question: Question, response: ResponseValue | undefined): string {
  const values = response?.type === "blank" ? response.values : [];
  const input = (index: number, extraClass = "") => {
    const value = values[index] ?? "";
    return `<input class="blank-input${extraClass}" type="text" data-qid="${esc(question.id)}" data-blank="${index}" value="${esc(value)}" aria-label="第 ${index + 1} 空" autocomplete="off" spellcheck="false">`;
  };
  const parts = splitBlankStem(question.stem, question.blanks);
  if (parts) {
    const body =
      esc(parts[0]) +
      parts
        .slice(1)
        .map((part, index) => `<span class="blank-chunk">${input(index)}${esc(part)}</span>`)
        .join("");
    return `<p class="stem inline-stem">${body}</p>`;
  }
  const fields = Array.from({ length: question.blanks }, (_, index) => {
    return `<label class="blank-field">第 ${index + 1} 空 ${input(index, " block")}</label>`;
  }).join("");
  return `<p class="stem">${esc(question.stem)}</p>${fields}`;
}

function shortControl(question: Question, response: ResponseValue | undefined): string {
  const text = response?.type === "short" ? response.text : "";
  return `<p class="stem">${esc(question.stem)}</p>
    <textarea data-qid="${esc(question.id)}" rows="5" maxlength="4000" placeholder="在这里作答" spellcheck="false">${esc(text)}</textarea>`;
}

function questionBlock(question: Question, response: ResponseValue | undefined): string {
  const meta = `<p class="q-meta">题号 ${esc(question.id)} · ${formatPoints(question.score)} 分</p>`;
  let body = "";
  if (question.type === "single" || question.type === "multiple") {
    body = `<p class="stem">${esc(question.stem)}</p>${choiceControl(question, response, question.type === "multiple")}`;
  } else if (question.type === "judge") {
    body = `<p class="stem">${esc(question.stem)}</p>${judgeControl(question, response)}`;
  } else if (question.type === "blank") {
    body = blankControl(question, response);
  } else {
    body = shortControl(question, response);
  }
  return `<div class="q" role="group" aria-label="题号 ${esc(question.id)}">${meta}${body}</div>`;
}

function sections(questions: Question[]): { type: QuestionType; items: Question[] }[] {
  return TYPE_ORDER.map((type) => ({
    type,
    items: questions.filter((question) => question.type === type),
  })).filter((section) => section.items.length > 0);
}

export function renderExam(view: ExamView): string {
  const timer =
    view.remainingMs == null
      ? ""
      : `<div class="timer-box"><span>剩余时间</span><strong id="timer" class="${view.remainingMs <= 60_000 ? "urgent" : ""}" aria-live="polite">${formatDuration(Math.max(0, view.remainingMs))}</strong></div>`;
  const body = sections(view.paper.questions)
    .map(
      (section, index) => `<section class="q-section">
        <h2>${sectionTitle(index, section.type)}</h2>
        <p class="section-hint">${SECTION_HINT[section.type]}</p>
        ${section.items.map((question) => questionBlock(question, responseOf(question, view.responses))).join("")}
      </section>`,
    )
    .join("");
  return `<div class="wrap">
    <header class="mast">
      <div class="brand">
        <span class="seal" aria-hidden="true">考</span>
        <div>
          <p class="eyebrow">在线考试</p>
          <h1>${esc(view.paper.title)}</h1>
        </div>
      </div>
      ${timer}
    </header>
    <div class="card" id="exam-root">
      <div class="exam-bar">
        <span>考生 ${esc(view.name)}</span>
        <span id="progress">已答 ${view.answered} / ${view.paper.questions.length}</span>
        <button type="button" class="text-btn" id="reset">返回首页</button>
      </div>
      ${body}
      <div class="sticky-submit">
        <div id="confirm-unanswered" class="confirm-bar" hidden>
          <p id="confirm-text"></p>
          <div class="row-actions">
            <button type="button" class="primary" id="confirm-submit">仍要交卷</button>
            <button type="button" class="ghost" id="confirm-back">返回答题</button>
          </div>
        </div>
        <button type="button" class="primary" id="submit-btn">提交试卷</button>
      </div>
    </div>
  </div>`;
}

function whyText(item: GradeReport["items"][number]): string {
  if (item.status === "correct") return "回答正确。";
  if (item.status === "incorrect") return "这道题答错了。";
  if (item.status === "partial") return item.note || "只答对了一部分。";
  if (item.status === "blank") return "这道题没有作答。";
  return item.note || "这道题无法评分。";
}

export function renderResult(view: ResultView): string {
  if (!view.released || !view.report) {
    return `<div class="wrap">
      <header class="mast">
        <div class="brand">
          <span class="seal" aria-hidden="true">考</span>
          <div>
            <p class="eyebrow">考试结束</p>
            <h1>${esc(view.paper.title)}</h1>
          </div>
        </div>
      </header>
      <section class="card score-card">
        <p class="lede">${esc(view.name)}，试卷已提交。</p>
        ${view.error ? banner("bad", view.error, "alert") : ""}
        ${view.autoSubmitted ? banner("warn", "时间到，试卷已自动提交。") : ""}
        <p class="fine">监考还没有公布答案。公布之后，点「查看答案」可以看到成绩和正确答案。</p>
      </section>
      <section class="card">
        <div class="row-actions">
          <button type="button" class="primary" id="refresh-result">查看答案</button>
          <button type="button" class="ghost" id="retry">再考一次</button>
          <button type="button" class="ghost" id="reset">返回首页</button>
        </div>
      </section>
    </div>`;
  }
  const report = view.report;
  const missing =
    report.missingIds.length > 0
      ? banner("warn", `以下题号在答案文件中没有对应答案，无法评分：${report.missingIds.join("、")}。`)
      : "";
  const invalid =
    report.invalidIds.length > 0
      ? banner("warn", `以下题号的答案无法识别，无法评分：${report.invalidIds.join("、")}。`)
      : "";
  const excluded = report.paperMax - report.gradedMax;
  const excludedNote =
    excluded > 0
      ? `<p class="fine">试卷总分 ${formatPoints(report.paperMax)} 分，其中 ${formatPoints(excluded)} 分因答案缺失或无法识别，未计入满分。</p>`
      : "";
  const items = report.items
    .map((item) => {
      const scoreText =
        item.status === "ungraded"
          ? STATUS_LABEL.ungraded
          : `${formatPoints(item.earned)} / ${formatPoints(item.score)} · ${STATUS_LABEL[item.status]}`;
      const why = view.released ? `<p class="note">${esc(whyText(item))}</p>` : "";
      const note = view.released && item.note && item.note !== whyText(item) ? `<p class="note">${esc(item.note)}</p>` : "";
      return `<article class="review ${item.status}">
        <header>
          <span>题号 ${esc(item.id)} · ${TYPE_LABEL[item.type]}</span>
          <strong>${esc(scoreText)}</strong>
        </header>
        <p class="stem">${esc(item.stem)}</p>
        <p><span class="k">你的答案</span> ${esc(item.yours)}</p>
        ${view.released && item.reference ? `<p class="reference"><span class="k">参考答案</span> ${esc(item.reference)}</p>` : ""}
        ${why}
        ${note}
      </article>`;
    })
    .join("");
  return `<div class="wrap">
    <header class="mast">
      <div class="brand">
        <span class="seal" aria-hidden="true">考</span>
        <div>
          <p class="eyebrow">考试结束</p>
          <h1>${esc(view.paper.title)}</h1>
        </div>
      </div>
    </header>
    <section class="card score-card">
      <p class="lede">${esc(view.name)}，成绩出来了。</p>
      ${view.error ? banner("bad", view.error, "alert") : ""}
      ${view.autoSubmitted ? banner("warn", "时间到，试卷已自动提交。") : ""}
      <p class="score-kicker">得分</p>
      <p class="score-hero"><strong>${formatPoints(report.total)}</strong><span> / ${formatPoints(report.gradedMax)}</span></p>
      <p class="fine">可评分满分 ${formatPoints(report.gradedMax)} 分。</p>
      ${excludedNote}
      ${view.released ? "" : `<p class="fine">监考还没有公布答案。公布之后，点「查看答案」可以看到正确答案，以及错在哪里。</p>`}
      ${missing}
      ${invalid}
    </section>
    <section class="card">
      ${view.released ? items : ""}
      <div class="row-actions">
        <button type="button" class="primary" id="refresh-result">查看答案</button>
        <button type="button" class="ghost" id="retry">再考一次</button>
        <button type="button" class="ghost" id="reset">返回首页</button>
      </div>
    </section>
  </div>`;
}
