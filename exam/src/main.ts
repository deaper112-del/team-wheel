import { formatDuration, paperSummary } from "./display";
import { countAnswered } from "./grade";
import { renderCandidate, renderExam, renderGate, renderProctor, renderResult, type LearningChart, type RoundSnapshot, type SubjectInfo } from "./render";
import { toCandidateReport } from "./reportView";
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
  released: boolean;
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
    released: false,
    results: null,
    resultsNote: "",
    subjects: [],
    subjectId: null,
    paperId: null,
    chart: null,
    groupIds: [],
    groupTarget: "",
    groupName: "",
    groupOpen: false,
    subjectNote: "",
    subjectError: "",
    names: [],
    candidateName: "",
    candidateChart: null,
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
    report: state.phase === "result" && state.released && state.report ? state.report : null,
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
  if (state.phase === "result" && paper) {
    const report = state.released && state.report ? toCandidateReport(state.report, true) : null;
    root.innerHTML = renderResult({
      paper,
      name: state.name,
      report,
      autoSubmitted: state.autoSubmitted,
      released: Boolean(report),
      error: state.error,
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
      results: state.results,
      resultsNote: state.resultsNote,
      subjects: state.subjects,
      subjectId: state.subjectId,
      paperId: state.paperId,
      chart: state.chart,
      groupIds: state.groupIds,
      groupTarget: state.groupTarget,
      groupName: state.groupName,
      groupOpen: state.groupOpen,
      subjectNote: state.subjectNote,
      subjectError: state.subjectError,
      names: state.names,
      candidateName: state.candidateName,
      candidateChart: state.candidateChart,
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
  state.released = false;
  state.report = null;
  state.autoSubmitted = saved.autoSubmitted;
  state.role = "candidate";
  state.phase = saved.phase === "result" ? "result" : "exam";
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
    state.released = false;
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
    const body = (await response.json()) as { error?: string; report?: GradeReport; released?: boolean; submitted?: boolean };
    if (!response.ok || (!body.report && !body.submitted)) {
      state.error = body.error || "交卷失败，请再试一次。";
      state.phase = "exam";
      submitting = false;
      render();
      return;
    }
    state.released = Boolean(body.released);
    state.report = state.released && body.report ? body.report : null;
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
    state.released = false;
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
  state.released = false;
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
    const body = (await response.json()) as {
      error?: string;
      summary?: string;
      warning?: string;
      subjectName?: string;
      subjects?: SubjectInfo[];
      subjectId?: number | null;
      chart?: LearningChart | null;
    };
    if (!response.ok) {
      state.error = body.error || "发布失败。";
      state.busy = false;
      render();
      return;
    }
    await loadExam();
    state.info = body.subjectName ? `${body.summary || "试卷已发布。"} 已归入科目「${body.subjectName}」。` : body.summary || "试卷已发布。";
    applyBoard(body);
    state.warning = body.warning || "";
    state.questionFile = null;
    state.answerFile = null;
    state.questionLabel = "";
    state.answerLabel = "";
    state.results = null;
    state.resultsNote = "";
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
  document.getElementById("load-results")?.addEventListener("click", () => {
    void loadResults(false);
  });
  document.getElementById("release-answers")?.addEventListener("click", () => {
    if (!window.confirm("公布后，考生可以查看正确答案。确定公布吗？")) return;
    void loadResults(true);
  });
  document.getElementById("load-subjects")?.addEventListener("click", () => {
    void loadSubjects(state.subjectId);
  });
  document.getElementById("subject-pick")?.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLSelectElement)) return;
    const subjectId = Number(input.value);
    state.subjectId = Number.isInteger(subjectId) ? subjectId : null;
    const subject = state.subjects.find((item) => item.id === state.subjectId);
    state.paperId = subject?.papers[0]?.id ?? null;
    void loadSubjects(state.subjectId);
  });
  document.getElementById("paper-pick")?.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLSelectElement)) return;
    const paperId = Number(input.value);
    state.paperId = Number.isInteger(paperId) ? paperId : null;
  });
  document.getElementById("start-saved")?.addEventListener("click", () => {
    void startSaved();
  });
  document.getElementById("group-menu")?.addEventListener("toggle", (event) => {
    const menu = event.target;
    if (menu instanceof HTMLDetailsElement) state.groupOpen = menu.open;
  });
  document.getElementById("group-target")?.addEventListener("change", (event) => {
    const input = event.target;
    if (input instanceof HTMLSelectElement) state.groupTarget = input.value;
  });
  document.getElementById("group-name")?.addEventListener("input", (event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement) state.groupName = input.value;
  });
  document.querySelectorAll<HTMLInputElement>(".group-paper").forEach((input) => {
    input.addEventListener("change", () => {
      const id = Number(input.value);
      if (!Number.isInteger(id)) return;
      state.groupIds = input.checked ? [...new Set([...state.groupIds, id])] : state.groupIds.filter((item) => item !== id);
    });
  });
  document.getElementById("group-papers")?.addEventListener("click", () => {
    void groupSaved();
  });
  document.getElementById("candidate-pick")?.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLSelectElement)) return;
    state.candidateName = input.value;
    void loadSubjects(state.subjectId);
  });
}

function applyBoard(body: {
  subjects?: SubjectInfo[];
  subjectId?: number | null;
  chart?: LearningChart | null;
  names?: string[];
  candidateName?: string | null;
  candidateChart?: LearningChart | null;
  candidateLoaded?: boolean;
}): void {
  if (!Array.isArray(body.subjects)) return;
  state.subjects = body.subjects;
  const preferred = typeof body.subjectId === "number" ? body.subjectId : state.subjectId;
  const subject = state.subjects.find((item) => item.id === preferred) ?? state.subjects[0];
  state.subjectId = subject?.id ?? null;
  if (!subject?.papers.some((item) => item.id === state.paperId)) state.paperId = subject?.papers[0]?.id ?? null;
  state.chart = body.chart ?? null;
  if (Array.isArray(body.names)) state.names = body.names;
  if (body.candidateLoaded) {
    const picked = typeof body.candidateName === "string" ? body.candidateName : "";
    state.candidateName = state.names.includes(picked) ? picked : "";
    state.candidateChart = state.candidateName ? (body.candidateChart ?? null) : null;
  } else if (state.candidateName && !state.names.includes(state.candidateName)) {
    state.candidateName = "";
    state.candidateChart = null;
  }
}

function passphraseFromForm(): string {
  const input = document.getElementById("proctor-pass");
  const passphrase = input instanceof HTMLInputElement ? input.value : state.passphrase;
  state.passphrase = passphrase;
  return passphrase;
}

let subjectGen = 0;

async function loadSubjects(subjectId: number | null): Promise<void> {
  const gen = ++subjectGen;
  const passphrase = passphraseFromForm();
  if (!passphrase) {
    state.subjectError = "请填写监考口令。";
    render();
    return;
  }
  state.busy = true;
  state.subjectError = "";
  render();
  try {
    const response = await fetch("/api/proctor/subjects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase, subjectId, candidateName: state.candidateName }),
    });
    const body = (await response.json()) as { error?: string; subjects?: SubjectInfo[]; subjectId?: number | null; chart?: LearningChart | null };
    if (gen !== subjectGen) return;
    if (!response.ok || !Array.isArray(body.subjects)) {
      state.subjectError = body.error || "无法读取科目。";
      state.busy = false;
      render();
      return;
    }
    applyBoard(body);
    state.subjectNote = "";
    state.subjectError = "";
  } catch {
    if (gen !== subjectGen) return;
    state.subjectError = "无法读取科目。";
  }
  if (gen !== subjectGen) return;
  state.busy = false;
  render();
}

async function startSaved(): Promise<void> {
  const passphrase = passphraseFromForm();
  const paperId = state.paperId;
  if (!passphrase) {
    state.subjectError = "请填写监考口令。";
    render();
    return;
  }
  if (paperId == null) {
    state.subjectError = "请选择一份试卷。";
    render();
    return;
  }
  state.busy = true;
  state.subjectError = "";
  render();
  try {
    const response = await fetch("/api/proctor/subjects/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase, paperId }),
    });
    const body = (await response.json()) as {
      error?: string;
      summary?: string;
      subjects?: SubjectInfo[];
      subjectId?: number | null;
      chart?: LearningChart | null;
    };
    if (!response.ok) {
      state.subjectError = body.error || "无法开始考试。";
      state.busy = false;
      render();
      return;
    }
    await loadExam();
    applyBoard(body);
    state.info = body.summary || "这场考试已开始。";
    state.results = null;
    state.resultsNote = "";
    state.subjectNote = "已用保存的试卷开始新的一场。";
    state.subjectError = "";
  } catch {
    state.subjectError = "无法开始考试。";
  }
  state.busy = false;
  render();
}

async function groupSaved(): Promise<void> {
  const passphrase = passphraseFromForm();
  const paperIds = [...document.querySelectorAll<HTMLInputElement>(".group-paper:checked")].map((input) => Number(input.value));
  const target = document.getElementById("group-target");
  const nameInput = document.getElementById("group-name");
  const targetValue = target instanceof HTMLSelectElement ? target.value : state.groupTarget;
  const name = nameInput instanceof HTMLInputElement ? nameInput.value : state.groupName;
  state.groupTarget = targetValue;
  state.groupName = name;
  state.groupIds = paperIds;
  state.groupOpen = true;
  if (!passphrase) {
    state.subjectError = "请填写监考口令。";
    render();
    return;
  }
  state.busy = true;
  state.subjectError = "";
  render();
  try {
    const response = await fetch("/api/proctor/subjects/group", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        passphrase,
        paperIds,
        subjectId: targetValue === "" ? null : Number(targetValue),
        name,
      }),
    });
    const body = (await response.json()) as { error?: string; subjects?: SubjectInfo[]; subjectId?: number | null; chart?: LearningChart | null };
    if (!response.ok || !Array.isArray(body.subjects)) {
      state.subjectError = body.error || "无法合并科目。";
      state.busy = false;
      render();
      return;
    }
    applyBoard(body);
    state.groupIds = [];
    state.groupName = "";
    state.groupOpen = true;
    state.subjectNote = "这些试卷已经归到同一个科目。";
    state.subjectError = "";
  } catch {
    state.subjectError = "无法合并科目。";
  }
  state.busy = false;
  render();
}

async function loadResults(release: boolean): Promise<void> {
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
  try {
    const response = await fetch(release ? "/api/proctor/release" : "/api/proctor/results", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });
    const body = (await response.json()) as RoundSnapshot & { error?: string };
    if (!response.ok || !Array.isArray(body.candidates)) {
      state.error = body.error || (release ? "无法公布答案。" : "无法查看成绩。");
      state.busy = false;
      render();
      return;
    }
    state.results = body;
    state.resultsNote = release || body.released ? "答案已向考生公布。" : "";
    state.error = "";
  } catch {
    state.error = release ? "无法公布答案。" : "无法查看成绩。";
  }
  state.busy = false;
  render();
}

async function refreshResult(): Promise<void> {
  if (!state.attemptToken) return;
  try {
    const response = await fetch("/api/result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: state.attemptToken }),
    });
    const body = (await response.json()) as { error?: string; name?: string; report?: GradeReport; released?: boolean; submitted?: boolean };
    if (!response.ok || (!body.report && !body.submitted)) {
      state.error = body.error || "无法查看成绩。";
      render();
      return;
    }
    state.released = Boolean(body.released);
    state.report = state.released && body.report ? body.report : null;
    if (body.name) state.name = body.name;
    state.phase = "result";
    state.error = "";
    persist();
  } catch {
    state.error = "无法查看成绩。";
  }
  render();
  window.scrollTo(0, 0);
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
  document.getElementById("refresh-result")?.addEventListener("click", () => {
    void refreshResult();
  });
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
    if (state.phase === "result") {
      await refreshResult();
      return;
    }
    if (state.phase === "exam" && (remainingMs() ?? 1) <= 0) {
      await submit(true, true);
      return;
    }
    render();
  })();
}
