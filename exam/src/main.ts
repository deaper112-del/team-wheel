import { formatDuration, paperSummary } from "./display";
import { countAnswered } from "./grade";
import { renderCandidate, renderExam, renderGate, renderProctor, renderResult } from "./render";
import { clearProgress, loadProgress, saveProgress, wipeLegacyStore, type ProgressRecord } from "./storage";
import { answerTemplateText, questionTemplateText, templateXlsxBytes } from "./templates";
import type { GradeReport, Paper, Question, ResponseValue } from "./types";

interface PublicExam {
  ready: true;
  updatedAt: string;
  title: string;
  durationMinutes: number | null;
  questions: Paper["questions"];
}

interface State {
  role: "gate" | "candidate" | "proctor";
  phase: "setup" | "exam" | "result";
  exam: PublicExam | null;
  name: string;
  passphrase: string;
  questionFile: File | null;
  answerFile: File | null;
  questionLabel: string;
  answerLabel: string;
  info: string;
  warning: string;
  error: string;
  busy: boolean;
  attemptToken: string;
  responses: Record<string, ResponseValue>;
  startedAt: number | null;
  deadline: number | null;
  report: GradeReport | null;
  autoSubmitted: boolean;
  holdAuto: boolean;
}

const app = () => document.querySelector<HTMLElement>("#app");
let state: State = fresh();
let timerId = 0;
let submitting = false;
let bootGen = 0;

function fresh(): State {
  return {
    role: "gate",
    phase: "setup",
    exam: null,
    name: "",
    passphrase: "",
    questionFile: null,
    answerFile: null,
    questionLabel: "",
    answerLabel: "",
    info: "",
    warning: "",
    error: "",
    busy: false,
    attemptToken: "",
    responses: {},
    startedAt: null,
    deadline: null,
    report: null,
    autoSubmitted: false,
    holdAuto: false,
  };
}

function paperOf(): Paper | null {
  if (!state.exam) return null;
  return {
    title: state.exam.title,
    durationMinutes: state.exam.durationMinutes,
    questions: state.exam.questions,
  };
}

function remainingMs(): number | null {
  if (state.deadline == null) return null;
  return state.deadline - Date.now();
}

function stopTicker(): void {
  window.clearInterval(timerId);
  timerId = 0;
}

function note(): string {
  return "作答保存在这个标签页里，刷新不会丢。答案不在你的浏览器里。";
}

function persist(): void {
  if (!state.exam || state.phase === "setup") {
    clearProgress();
    return;
  }
  const record: ProgressRecord = {
    version: 2,
    updatedAt: state.exam.updatedAt,
    phase: state.phase,
    name: state.name,
    attemptToken: state.attemptToken,
    responses: state.responses,
    startedAt: state.startedAt,
    deadline: state.deadline,
    report: state.phase === "result" ? state.report : null,
    autoSubmitted: state.autoSubmitted,
  };
  try {
    saveProgress(record);
  } catch {
    state.error = "这个标签页无法保存作答，刷新后需要重做。";
  }
}

function render(): void {
  const root = app();
  if (!root) return;
  stopTicker();
  const paper = paperOf();
  document.title = state.phase === "setup" || !paper ? "在线考试" : paper.title;
  if (state.phase === "exam" && paper) {
    root.innerHTML = renderExam({
      paper,
      name: state.name,
      responses: state.responses,
      remainingMs: remainingMs(),
      answered: countAnswered(paper.questions, state.responses),
    });
    bindExam();
    startTicker();
    return;
  }
  if (state.phase === "result" && paper && state.report) {
    root.innerHTML = renderResult({
      paper,
      name: state.name,
      report: state.report,
      autoSubmitted: state.autoSubmitted,
    });
    bindResult();
    return;
  }
  state.phase = "setup";
  if (state.role === "proctor") {
    root.innerHTML = renderProctor({
      passphrase: state.passphrase,
      questionLabel: state.questionLabel,
      answerLabel: state.answerLabel,
      summary: state.exam ? paperSummary(paperOf() as Paper) : "",
      info: state.info,
      warning: state.warning,
      error: state.error,
      busy: state.busy,
    });
    bindProctor();
    return;
  }
  if (state.role === "candidate") {
    root.innerHTML = renderCandidate({
      ready: Boolean(state.exam),
      summary: state.exam ? paperSummary(paperOf() as Paper) : "",
      name: state.name,
      error: state.error,
      note: note(),
    });
    bindCandidate();
    return;
  }
  root.innerHTML = renderGate({ error: state.error });
  bindGate();
}

function setRole(role: State["role"]): void {
  state.role = role;
  state.phase = "setup";
  state.error = "";
  state.info = "";
  const hash = role === "gate" ? "" : `#${role}`;
  if (location.hash !== hash) history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
  render();
}

async function loadExam(): Promise<void> {
  const response = await fetch("/api/exam", { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取试卷。");
  const body = (await response.json()) as { ready?: boolean } & Partial<PublicExam>;
  state.exam = body.ready ? (body as PublicExam) : null;
}

function restoreProgress(): void {
  const saved = loadProgress();
  if (!saved || !state.exam || saved.updatedAt !== state.exam.updatedAt || !saved.attemptToken) {
    clearProgress();
    return;
  }
  if (saved.phase !== "result" && state.exam.durationMinutes && typeof saved.deadline !== "number") {
    clearProgress();
    return;
  }
  state.name = saved.name;
  state.attemptToken = saved.attemptToken;
  state.deadline = typeof saved.deadline === "number" ? saved.deadline : null;
  state.responses = saved.responses || {};
  state.startedAt = saved.startedAt;
  state.report = saved.report;
  state.autoSubmitted = saved.autoSubmitted;
  state.role = "candidate";
  state.phase = saved.phase === "result" && saved.report ? "result" : "exam";
}

function qidSelector(id: string): string {
  return `[data-qid="${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
}

function readResponse(question: Question, root: ParentNode): ResponseValue {
  const nodes = [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(qidSelector(question.id))];
  if (question.type === "single") {
    const picked = nodes.find((node) => node instanceof HTMLInputElement && node.checked);
    return { type: "single", index: picked ? Number(picked.value) : null };
  }
  if (question.type === "multiple") {
    return {
      type: "multiple",
      indices: nodes.filter((node) => node instanceof HTMLInputElement && node.checked).map((node) => Number(node.value)),
    };
  }
  if (question.type === "judge") {
    const picked = nodes.find((node) => node instanceof HTMLInputElement && node.checked);
    return { type: "judge", value: picked ? picked.value === "true" : null };
  }
  if (question.type === "blank") {
    const inputs = nodes
      .filter((node): node is HTMLInputElement => node instanceof HTMLInputElement)
      .sort((left, right) => Number(left.dataset.blank) - Number(right.dataset.blank));
    return { type: "blank", values: inputs.map((node) => node.value) };
  }
  const area = nodes.find((node): node is HTMLTextAreaElement => node instanceof HTMLTextAreaElement);
  return { type: "short", text: area?.value ?? "" };
}

function snapshotResponses(): void {
  const paper = paperOf();
  const root = document.getElementById("exam-root");
  if (!paper || !root) return;
  for (const question of paper.questions) state.responses[question.id] = readResponse(question, root);
}

function updateProgress(): void {
  const paper = paperOf();
  const progress = document.getElementById("progress");
  if (!paper || !progress) return;
  progress.textContent = `已答 ${countAnswered(paper.questions, state.responses)} / ${paper.questions.length}`;
}

let starting = false;

async function beginAttempt(name: string): Promise<boolean> {
  const response = await fetch("/api/attempt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const body = (await response.json()) as { error?: string; token?: string; name?: string; deadline?: string | null };
  if (!response.ok || !body.token) {
    state.error = body.error || "无法开始考试。";
    return false;
  }
  state.attemptToken = body.token;
  state.name = body.name || name;
  const deadline = body.deadline ? Date.parse(body.deadline) : NaN;
  state.deadline = Number.isFinite(deadline) ? deadline : null;
  return true;
}

async function startExam(name: string): Promise<void> {
  if (starting) return;
  const trimmed = name.trim();
  if (!state.exam) {
    state.error = "考试还没开始。";
    render();
    return;
  }
  if (!trimmed) {
    state.error = "请填写考生姓名。";
    render();
    return;
  }
  starting = true;
  state.error = "";
  try {
    const ok = await beginAttempt(trimmed);
    if (!ok) {
      render();
      return;
    }
    state.phase = "exam";
    state.responses = {};
    state.startedAt = Date.now();
    state.report = null;
    state.autoSubmitted = false;
    state.holdAuto = false;
    state.error = "";
    persist();
    render();
    window.scrollTo(0, 0);
  } catch {
    state.error = "无法开始考试。";
    render();
  } finally {
    starting = false;
  }
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
      if (state.holdAuto) return;
      state.holdAuto = true;
      void submit(true);
    }
  };
  tick();
  timerId = window.setInterval(tick, 250);
}

async function submit(auto: boolean, confirmed = false): Promise<void> {
  const paper = paperOf();
  if (submitting || state.phase !== "exam" || !paper) return;
  snapshotResponses();
  const left = paper.questions.length - countAnswered(paper.questions, state.responses);
  const confirmBox = document.getElementById("confirm-unanswered");
  if (!auto && !confirmed && left > 0) {
    const text = document.getElementById("confirm-text");
    if (text) text.textContent = `还有 ${left} 题未作答，确定交卷吗？`;
    confirmBox?.removeAttribute("hidden");
    return;
  }
  confirmBox?.setAttribute("hidden", "");
  submitting = true;
  stopTicker();
  try {
    const response = await fetch("/api/grade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: state.attemptToken, responses: state.responses }),
    });
    const body = (await response.json()) as { error?: string; report?: GradeReport };
    if (!response.ok || !body.report) {
      state.error = body.error || "交卷失败，请再试一次。";
      state.phase = "exam";
      submitting = false;
      render();
      return;
    }
    state.report = body.report;
    state.autoSubmitted = auto;
    state.phase = "result";
    state.error = "";
    persist();
  } catch {
    state.error = "交卷失败，请再试一次。";
    state.phase = "exam";
  }
  submitting = false;
  render();
  window.scrollTo(0, 0);
}

async function retry(): Promise<void> {
  if (starting || !state.exam || !state.name) return;
  starting = true;
  try {
    const ok = await beginAttempt(state.name);
    if (!ok) {
      render();
      return;
    }
    state.phase = "exam";
    state.responses = {};
    state.startedAt = Date.now();
    state.report = null;
    state.autoSubmitted = false;
    state.holdAuto = false;
    state.error = "";
    persist();
    render();
    window.scrollTo(0, 0);
  } catch {
    state.error = "无法开始考试。";
    render();
  } finally {
    starting = false;
  }
}

function leaveExam(): void {
  stopTicker();
  clearProgress();
  state.phase = "setup";
  state.attemptToken = "";
  state.responses = {};
  state.startedAt = null;
  state.deadline = null;
  state.report = null;
  state.autoSubmitted = false;
  state.holdAuto = false;
  state.role = "candidate";
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

function bindGate(): void {
  document.getElementById("role-candidate")?.addEventListener("click", () => setRole("candidate"));
  document.getElementById("role-proctor")?.addEventListener("click", () => setRole("proctor"));
}

function bindCandidate(): void {
  document.getElementById("candidate-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("candidate-name");
    void startExam(input instanceof HTMLInputElement ? input.value : state.name);
  });
  document.getElementById("candidate-name")?.addEventListener("input", (event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement) state.name = input.value;
  });
  document.getElementById("refresh-exam")?.addEventListener("click", () => {
    void loadExam()
      .then(() => render())
      .catch(() => {
        state.error = "无法读取试卷。";
        render();
      });
  });
  document.getElementById("back-gate")?.addEventListener("click", () => setRole("gate"));
}

async function publish(): Promise<void> {
  const input = document.getElementById("proctor-pass");
  const passphrase = input instanceof HTMLInputElement ? input.value : state.passphrase;
  state.passphrase = passphrase;
  if (!passphrase) {
    state.error = "请填写监考口令。";
    render();
    return;
  }
  state.busy = true;
  state.error = "";
  render();
  const data = new FormData();
  data.set("passphrase", passphrase);
  if (state.questionFile) data.set("question", state.questionFile);
  if (state.answerFile) data.set("answer", state.answerFile);
  try {
    const response = await fetch("/api/proctor", { method: "POST", body: data });
    const body = (await response.json()) as { error?: string; summary?: string; warning?: string };
    if (!response.ok) {
      state.error = body.error || "发布失败。";
      state.busy = false;
      render();
      return;
    }
    await loadExam();
    state.info = body.summary || "试卷已发布。";
    state.warning = body.warning || "";
    state.questionFile = null;
    state.answerFile = null;
    state.questionLabel = "";
    state.answerLabel = "";
    state.error = "";
  } catch {
    state.error = "发布失败，请再试一次。";
  }
  state.busy = false;
  render();
}

function bindProctor(): void {
  document.getElementById("proctor-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void publish();
  });
  document.getElementById("proctor-pass")?.addEventListener("input", (event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement) state.passphrase = input.value;
  });
  document.getElementById("question-file")?.addEventListener("change", (event) => {
    const input = event.target;
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    state.questionFile = file ?? null;
    state.questionLabel = file?.name ?? "";
    render();
  });
  document.getElementById("answer-file")?.addEventListener("change", (event) => {
    const input = event.target;
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    state.answerFile = file ?? null;
    state.answerLabel = file?.name ?? "";
    render();
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
    download("考试模板.xlsx", new Blob([copy], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  });
  document.getElementById("back-gate")?.addEventListener("click", () => setRole("gate"));
}

function bindExam(): void {
  const root = document.getElementById("exam-root");
  const onEdit = (event: Event) => {
    const target = event.target;
    const paper = paperOf();
    if (!(target instanceof HTMLElement) || !root || !paper) return;
    const qid = target.getAttribute("data-qid");
    if (!qid) return;
    const question = paper.questions.find((item) => item.id === qid);
    if (!question) return;
    state.responses[qid] = readResponse(question, root);
    updateProgress();
    persist();
  };
  root?.addEventListener("change", onEdit);
  root?.addEventListener("input", onEdit);
  document.getElementById("submit-btn")?.addEventListener("click", () => {
    void submit(false);
  });
  document.getElementById("reset")?.addEventListener("click", () => leaveExam());
  document.getElementById("confirm-submit")?.addEventListener("click", () => {
    void submit(false, true);
  });
  document.getElementById("confirm-back")?.addEventListener("click", () => {
    document.getElementById("confirm-unanswered")?.setAttribute("hidden", "");
  });
}

function bindResult(): void {
  document.getElementById("retry")?.addEventListener("click", () => {
    void retry();
  });
  document.getElementById("reset")?.addEventListener("click", () => leaveExam());
}

function roleFromHash(): State["role"] {
  if (location.hash === "#proctor") return "proctor";
  if (location.hash === "#candidate") return "candidate";
  return "gate";
}

let listening = false;

export function boot(): void {
  const gen = ++bootGen;
  wipeLegacyStore();
  state = fresh();
  state.role = roleFromHash();
  if (!listening) {
    listening = true;
    window.addEventListener("hashchange", () => {
      if (state.phase !== "setup") return;
      state.role = roleFromHash();
      state.error = "";
      render();
    });
  }
  void (async () => {
    try {
      await loadExam();
    } catch {
      if (gen !== bootGen) return;
      state.error = "无法读取试卷。";
    }
    if (gen !== bootGen) return;
    if (roleFromHash() !== "proctor") restoreProgress();
    if (state.phase === "exam" && (remainingMs() ?? 1) <= 0) {
      await submit(true, true);
      return;
    }
    render();
  })();
}
