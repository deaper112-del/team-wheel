import { formatDuration, paperSummary } from "./display";
import "./style.css";
import { combineUploads, countAnswered, gradePaper } from "./grade";
import { parseExamFile } from "./parse";
import { renderExam, renderResult, renderSetup } from "./render";
import { clearSession, loadSession, saveSession, type SessionRecord } from "./storage";
import { answerTemplateText, questionTemplateText, templateXlsxBytes } from "./templates";
import type { AnswerKey, FileContent, GradeReport, Paper, Question, ResponseValue } from "./types";

const app = document.querySelector<HTMLElement>("#app");

interface State {
  phase: "setup" | "exam" | "result";
  paper: Paper | null;
  key: AnswerKey | null;
  questionContent: FileContent | null;
  answerContent: FileContent | null;
  name: string;
  questionLabel: string;
  answerLabel: string;
  info: string;
  warning: string;
  error: string;
  persistNote: string;
  restored: boolean;
  responses: Record<string, ResponseValue>;
  startedAt: number | null;
  report: GradeReport | null;
  autoSubmitted: boolean;
}

let state: State = freshState();
let timerId = 0;
let saveTimer = 0;
let submitting = false;

function freshState(): State {
  return {
    phase: "setup",
    paper: null,
    key: null,
    questionContent: null,
    answerContent: null,
    name: "",
    questionLabel: "",
    answerLabel: "",
    info: "",
    warning: "",
    error: "",
    persistNote: "答卷保存在本机浏览器。",
    restored: false,
    responses: {},
    startedAt: null,
    report: null,
    autoSubmitted: false,
  };
}

function remainingMs(): number | null {
  if (!state.paper?.durationMinutes || state.startedAt == null) return null;
  return state.startedAt + state.paper.durationMinutes * 60_000 - Date.now();
}

function stopTicker(): void {
  window.clearInterval(timerId);
  timerId = 0;
}

function render(): void {
  if (!app) return;
  stopTicker();
  document.title = state.phase === "setup" || !state.paper ? "在线考试" : state.paper.title;
  if (state.phase === "exam" && state.paper) {
    app.innerHTML = renderExam({
      paper: state.paper,
      name: state.name,
      responses: state.responses,
      remainingMs: remainingMs(),
      answered: countAnswered(state.paper.questions, state.responses),
    });
    bindExam();
    startTicker();
    return;
  }
  if (state.phase === "result" && state.paper && state.report) {
    app.innerHTML = renderResult({
      paper: state.paper,
      name: state.name,
      report: state.report,
      autoSubmitted: state.autoSubmitted,
    });
    bindResult();
    return;
  }
  state.phase = "setup";
  app.innerHTML = renderSetup({
    name: state.name,
    questionLabel: state.questionLabel,
    answerLabel: state.answerLabel,
    info: state.info,
    warning: state.warning,
    error: state.error,
    persistNote: state.persistNote,
    restored: state.restored,
    canReset: Boolean(state.paper || state.key || state.questionLabel || state.answerLabel),
  });
  bindSetup();
}

function captureName(): void {
  const input = document.getElementById("candidate-name");
  if (input instanceof HTMLInputElement) state.name = input.value;
}

function qidSelector(id: string): string {
  return `[data-qid="${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
}

function readResponse(question: Question, root: ParentNode): ResponseValue {
  const nodes = [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(qidSelector(question.id))];
  if (question.type === "single") {
    const checked = nodes.find((node) => node instanceof HTMLInputElement && node.checked);
    const index = checked ? Number(checked.value) : Number.NaN;
    return { type: "single", index: Number.isInteger(index) ? index : null };
  }
  if (question.type === "multiple") {
    const indices = nodes
      .filter((node): node is HTMLInputElement => node instanceof HTMLInputElement && node.checked)
      .map((node) => Number(node.value))
      .filter((index) => Number.isInteger(index));
    return { type: "multiple", indices };
  }
  if (question.type === "judge") {
    const checked = nodes.find((node) => node instanceof HTMLInputElement && node.checked);
    if (!checked) return { type: "judge", value: null };
    return { type: "judge", value: checked.value === "true" };
  }
  if (question.type === "blank") {
    const inputs = nodes
      .filter((node): node is HTMLInputElement => node instanceof HTMLInputElement)
      .sort((left, right) => Number(left.dataset.blank) - Number(right.dataset.blank));
    return { type: "blank", values: inputs.map((node) => node.value) };
  }
  const area = nodes.find((node) => node instanceof HTMLTextAreaElement);
  return { type: "short", text: area?.value ?? "" };
}

function snapshotResponses(): void {
  const root = document.getElementById("exam-root");
  if (!root || !state.paper) return;
  for (const question of state.paper.questions) {
    state.responses[question.id] = readResponse(question, root);
  }
}

function updateProgress(): void {
  const progress = document.getElementById("progress");
  if (!progress || !state.paper) return;
  const answered = countAnswered(state.paper.questions, state.responses);
  progress.textContent = `已答 ${answered} / ${state.paper.questions.length}`;
}

async function persist(): Promise<void> {
  if (!state.paper || !state.key) return;
  const phase: SessionRecord["phase"] =
    state.phase === "exam" || state.phase === "result" ? state.phase : "ready";
  const record: SessionRecord = {
    version: 1,
    phase,
    paper: state.paper,
    key: state.key,
    name: state.name.trim(),
    responses: state.responses,
    startedAt: state.startedAt,
    report: state.report,
    autoSubmitted: state.autoSubmitted,
    warning: state.warning,
    questionLabel: state.questionLabel,
    answerLabel: state.answerLabel,
  };
  try {
    await saveSession(record);
  } catch {
    state.persistNote = "本机无法保存试卷，刷新后需要重新上传。";
    const note = document.getElementById("persist-note");
    if (note) note.textContent = state.persistNote;
  }
}

function schedulePersist(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void persist();
  }, 200);
}

function syncCombined(): void {
  const combined = combineUploads(state.questionContent, state.answerContent);
  state.report = null;
  state.startedAt = null;
  state.responses = {};
  if (combined.ok) {
    state.paper = combined.paper;
    state.key = combined.key;
    state.error = "";
    state.warning = combined.warning;
    state.info = paperSummary(combined.paper);
    void persist();
    return;
  }
  state.paper = null;
  state.key = null;
  state.warning = "";
  void clearSession().catch(() => {
    state.persistNote = "本机无法保存试卷，刷新后需要重新上传。";
  });
  if (combined.pending) {
    state.error = "";
    state.info = [combined.paper ? paperSummary(combined.paper) : "", combined.error].filter(Boolean).join("");
    return;
  }
  state.info = combined.paper ? paperSummary(combined.paper) : "";
  state.error = combined.error;
}

async function onFile(slot: "question" | "answer", file: File): Promise<void> {
  captureName();
  const parsed = await parseExamFile(file);
  const label = slot === "question" ? "题目文件" : "答案文件";
  if (!parsed.ok) {
    state.error = `${label}：${parsed.error}`;
    render();
    return;
  }
  if (slot === "question") {
    state.questionContent = parsed.content;
    state.questionLabel = file.name;
  } else {
    state.answerContent = parsed.content;
    state.answerLabel = file.name;
  }
  state.error = "";
  state.restored = false;
  syncCombined();
  render();
}

function startExam(name: string): void {
  state.name = name;
  const trimmed = name.trim();
  if (!state.paper || !state.key) {
    state.error = state.info || "请先上传题目和答案。";
    render();
    return;
  }
  if (!trimmed) {
    state.error = "请填写考生姓名。";
    render();
    return;
  }
  state.name = trimmed;
  state.phase = "exam";
  state.responses = {};
  state.startedAt = Date.now();
  state.report = null;
  state.autoSubmitted = false;
  state.error = "";
  void persist();
  render();
  window.scrollTo(0, 0);
}

function startTicker(): void {
  stopTicker();
  if (remainingMs() == null) return;
  const tick = () => {
    const left = remainingMs();
    const timer = document.getElementById("timer");
    if (left == null) return;
    if (timer) {
      timer.textContent = formatDuration(left);
      timer.classList.toggle("urgent", left <= 60_000);
    }
    if (left <= 0) {
      stopTicker();
      void submit(true);
    }
  };
  tick();
  timerId = window.setInterval(tick, 250);
}

async function submit(auto: boolean, confirmed = false): Promise<void> {
  if (submitting || state.phase !== "exam" || !state.paper || !state.key) return;
  snapshotResponses();
  const left = state.paper.questions.length - countAnswered(state.paper.questions, state.responses);
  const confirmBox = document.getElementById("confirm-unanswered");
  if (!auto && !confirmed && left > 0) {
    const text = document.getElementById("confirm-text");
    if (text) text.textContent = `还有 ${left} 题未作答，确定交卷吗？`;
    confirmBox?.removeAttribute("hidden");
    confirmBox?.scrollIntoView({ block: "nearest" });
    return;
  }
  confirmBox?.setAttribute("hidden", "");
  submitting = true;
  stopTicker();
  state.report = gradePaper(state.paper, state.key, state.responses);
  state.autoSubmitted = auto;
  state.phase = "result";
  try {
    await persist();
  } catch {
    state.persistNote = "本机无法保存试卷，刷新后需要重新上传。";
  }
  submitting = false;
  render();
  window.scrollTo(0, 0);
}

function retry(): void {
  if (!state.paper || !state.key) return;
  state.phase = "exam";
  state.responses = {};
  state.startedAt = Date.now();
  state.report = null;
  state.autoSubmitted = false;
  void persist();
  render();
  window.scrollTo(0, 0);
}

async function resetAll(): Promise<void> {
  stopTicker();
  window.clearTimeout(saveTimer);
  const note = state.persistNote;
  state = freshState();
  if (note.includes("无法保存")) state.persistNote = note;
  try {
    await clearSession();
  } catch {
    state.persistNote = "本机无法保存试卷，刷新后需要重新上传。";
  }
  render();
  window.scrollTo(0, 0);
}

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function bindSetup(): void {
  const form = document.getElementById("setup-form");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("candidate-name");
    startExam(input instanceof HTMLInputElement ? input.value : state.name);
  });
  document.getElementById("question-file")?.addEventListener("change", (event) => {
    const input = event.target;
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (file) void onFile("question", file);
  });
  document.getElementById("answer-file")?.addEventListener("change", (event) => {
    const input = event.target;
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (file) void onFile("answer", file);
  });
  document.getElementById("candidate-name")?.addEventListener("input", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    state.name = input.value;
    if (state.paper && state.key) schedulePersist();
  });
  document.getElementById("tpl-q-json")?.addEventListener("click", () => {
    download("题目模板.json", new Blob([questionTemplateText()], { type: "application/json;charset=utf-8" }));
  });
  document.getElementById("tpl-a-json")?.addEventListener("click", () => {
    download("答案模板.json", new Blob([answerTemplateText()], { type: "application/json;charset=utf-8" }));
  });
  document.getElementById("tpl-xlsx")?.addEventListener("click", () => {
    const bytes = templateXlsxBytes();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    download(
      "考试模板.xlsx",
      new Blob([copy], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    );
  });
  document.getElementById("reset")?.addEventListener("click", () => {
    void resetAll();
  });
}

function bindExam(): void {
  const root = document.getElementById("exam-root");
  const onEdit = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !root || !state.paper) return;
    const qid = target.getAttribute("data-qid");
    if (!qid) return;
    const question = state.paper.questions.find((item) => item.id === qid);
    if (!question) return;
    state.responses[qid] = readResponse(question, root);
    updateProgress();
    schedulePersist();
  };
  root?.addEventListener("change", onEdit);
  root?.addEventListener("input", onEdit);
  document.getElementById("submit-btn")?.addEventListener("click", () => {
    void submit(false);
  });
  document.getElementById("reset")?.addEventListener("click", () => {
    void resetAll();
  });
  document.getElementById("confirm-submit")?.addEventListener("click", () => {
    void submit(false, true);
  });
  document.getElementById("confirm-back")?.addEventListener("click", () => {
    document.getElementById("confirm-unanswered")?.setAttribute("hidden", "");
  });
}

function bindResult(): void {
  document.getElementById("retry")?.addEventListener("click", () => retry());
  document.getElementById("reset")?.addEventListener("click", () => {
    void resetAll();
  });
}

function applySaved(saved: SessionRecord): void {
  state.paper = saved.paper;
  state.key = saved.key;
  state.questionContent = { paper: saved.paper, key: null };
  state.answerContent = { paper: null, key: saved.key };
  state.name = saved.name || "";
  state.responses = saved.responses || {};
  state.startedAt = saved.startedAt;
  state.report = saved.report;
  state.autoSubmitted = Boolean(saved.autoSubmitted);
  state.warning = saved.warning || "";
  state.questionLabel = saved.questionLabel || "已保存的题目";
  state.answerLabel = saved.answerLabel || "已保存的答案";
  state.info = paperSummary(saved.paper);
  state.restored = true;
  state.phase = saved.phase === "exam" || saved.phase === "result" ? saved.phase : "setup";
  if (state.phase === "result" && !state.report) {
    state.report = gradePaper(saved.paper, saved.key, state.responses);
  }
  if (state.phase === "result" && !state.report) state.phase = "setup";
}

async function init(): Promise<void> {
  try {
    const saved = await loadSession();
    if (saved) applySaved(saved);
  } catch {
    state.persistNote = "本机无法保存试卷，刷新后需要重新上传。";
  }
  if (state.phase === "exam" && (remainingMs() ?? 1) <= 0) {
    state.report = state.paper && state.key ? gradePaper(state.paper, state.key, state.responses) : null;
    state.autoSubmitted = true;
    state.phase = state.report ? "result" : "setup";
    await persist();
  }
  render();
}

void init();
