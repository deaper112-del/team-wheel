const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';
const ROOM_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
const ERRORS = {
  room_not_found: "找不到这个房间，核对一下房间码",
  closed: "主持人已经结束投票",
  name_taken: "这个名字已经转过了，换一个名字",
  already_voted: "你已经转过一次了",
  name_required: "先写上你的名字",
  name_invalid: "名字用 1 到 12 个字",
  forbidden: "只有主持人能做这个操作",
  bad_room: "房间码是 4 位，不含 0、1、I、O",
  room_full: "这个房间人满了",
  bad_voter: "浏览器身份无效，请刷新后再转"
};

const canvas = document.getElementById("wheel");
const ctx = canvas.getContext("2d");
const hub = document.getElementById("hub");
const stage = document.getElementById("stage");
const share = document.getElementById("share");
const homePanel = document.getElementById("home-panel");
const roomPanel = document.getElementById("room-panel");
const nameInput = document.getElementById("name");
const codeInput = document.getElementById("code");
const resultBox = document.getElementById("result");
const winnerBox = document.getElementById("winner");
const statsBox = document.getElementById("stats");
const lede = document.getElementById("lede");
const fair = document.getElementById("fair");
const footnote = document.getElementById("footnote");
const soundBtn = document.getElementById("sound");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const fast = new URLSearchParams(location.search).has("fast");

let activities = [];
let meta = { addresses: [], publicUrl: "", mode: "local", tunnel: "off" };
let room = null;
let roomId = "";
let mode = "home";
let rotation = 0;
let anim = null;
let spinning = false;
let creating = false;
let holdResult = false;
let pollTimer = 0;
let lastBoard = "";
let lastTickAt = 0;
let audioCtx = null;
let soundOn = localStorage.getItem("tw-sound") !== "0";

function voterId() {
  let id = localStorage.getItem("tw-voter");
  if (!id) {
    id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("tw-voter", id);
  }
  return id;
}

function hostToken() {
  return roomId ? (localStorage.getItem("tw-host-" + roomId) || "") : "";
}

function isHost() {
  return hostToken().length > 0;
}

function getMine() {
  if (!roomId) return null;
  const raw = localStorage.getItem("tw-vote-" + roomId);
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return null; }
  if (!parsed || !parsed.name || !parsed.activityId) return null;
  if (room && Array.isArray(room.votes)) {
    const still = room.votes.some((v) => v.name === parsed.name && v.activityId === parsed.activityId);
    if (!still && !holdResult) {
      localStorage.removeItem("tw-vote-" + roomId);
      return null;
    }
  }
  return parsed;
}

function activityById(id) {
  for (let i = 0; i < activities.length; i++) {
    if (activities[i].id === id) return activities[i];
  }
  return null;
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

async function api(path, options) {
  const method = (options && options.method) || "GET";
  const body = options && options.body;
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) {
    const err = new Error((data && data.error) || "request_failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
}

function celebrate() {
  if (reduceMotion) return;
  const layer = document.createElement("div");
  layer.className = "confetti";
  const colors = ["#E24B3B", "#F3D48A", "#FFF6EA", "#7A4ED0", "#2E7D4F", "#1F7E8C"];
  for (let i = 0; i < 46; i++) {
    const piece = document.createElement("i");
    piece.style.left = Math.random() * 100 + "%";
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = (Math.random() * 0.25) + "s";
    piece.style.animationDuration = (1.15 + Math.random() * 0.9) + "s";
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 2200);
  chime();
}

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function blip(freq, dur, gain) {
  if (!soundOn) return;
  try {
    const ac = ensureAudio();
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(gain, ac.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    osc.connect(amp);
    amp.connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + dur);
  } catch (e) { /* autoplay or missing audio */ }
}

function tick() {
  blip(760, 0.045, 0.02);
}

function chime() {
  blip(523, 0.12, 0.03);
  setTimeout(() => blip(784, 0.18, 0.03), 90);
}

function updateSoundButton() {
  soundBtn.textContent = soundOn ? "音效开" : "音效关";
  soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
}

function shareTarget() {
  const host = location.hostname;
  const here = host === "localhost" || host === "127.0.0.1";
  if (!here) return { url: location.origin, kind: "current" };
  if (meta.publicUrl) return { url: String(meta.publicUrl).replace(/\/$/, ""), kind: "public" };
  if ((meta.mode === "all" || meta.mode === "lan") && meta.addresses && meta.addresses[0]) {
    return { url: meta.addresses[0], kind: "lan" };
  }
  return { url: location.origin, kind: "local" };
}

function shareLink() {
  return shareTarget().url + "/?room=" + roomId;
}

function inviteText() {
  return "团建投票开始了，每人转一次幸运大转盘，票数最高的活动胜出：\n"
    + shareLink()
    + "\n房间码 " + roomId;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
    area.remove();
    return ok;
  }
}

function renderShare() {
  if (mode !== "room" || !roomId) return;
  const target = shareTarget();
  document.getElementById("room-code").textContent = roomId;
  document.getElementById("share-url").textContent = shareLink();
  document.getElementById("share-kicker").textContent = isHost() ? "先发到群里" : "转发给还没玩的同事";
  document.getElementById("copy").textContent = isHost() ? "复制邀请语到群里" : "复制链接";
  const note = document.getElementById("share-note");
  if (target.kind === "public") {
    note.textContent = "这个链接可以直接发到微信群，人不在公司也能打开。它是临时的，只发给自己人。";
  } else if (target.kind === "lan") {
    note.textContent = "同一个 Wi-Fi 里的同事可以打开。不在这个网络的人打不开。";
  } else if (target.kind === "local") {
    note.textContent = meta.tunnel === "pending"
      ? "正在生成可发到微信群的链接，稍等几秒再复制。"
      : "目前只有这台电脑能打开。如果弹出防火墙提示，点允许后再刷新。";
  } else {
    note.textContent = "把这段邀请发到群里，每人用自己的名字转一次。";
  }
}

function placeShare() {
  if (mode !== "room") {
    share.hidden = true;
    return;
  }
  share.hidden = false;
  const host = isHost();
  share.classList.toggle("is-hero", host);
  if (host) {
    if (share.nextElementSibling !== stage) stage.parentNode.insertBefore(share, stage);
  } else if (roomPanel.firstChild !== share) {
    roomPanel.insertBefore(share, roomPanel.firstChild);
  }
}

function renderMenu() {
  const menu = document.getElementById("menu");
  menu.replaceChildren();
  activities.forEach((activity) => {
    const item = document.createElement("li");
    const icon = document.createElement("span");
    icon.textContent = activity.emoji;
    item.append(icon, document.createTextNode(activity.name));
    menu.appendChild(item);
  });
}

function tallyOf(votes) {
  const order = new Map(activities.map((activity, index) => [activity.id, index]));
  const rows = activities.map((activity) => ({
    id: activity.id,
    name: activity.name,
    emoji: activity.emoji,
    color: activity.color,
    blurb: activity.blurb,
    count: 0,
    people: []
  }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  votes.forEach((vote) => {
    const row = byId.get(vote.activityId);
    if (!row) return;
    row.count += 1;
    row.people.push(vote.name);
  });
  rows.sort((a, b) => b.count - a.count || order.get(a.id) - order.get(b.id));
  const max = rows.reduce((best, row) => Math.max(best, row.count), 0);
  const top = max > 0 ? rows.filter((row) => row.count === max) : [];
  return { rows, max, top, total: votes.length };
}

function visibleVotes() {
  const votes = (room && room.votes) || [];
  if (!holdResult) return votes;
  const mine = getMine();
  if (!mine) return votes;
  return votes.filter((vote) => !(vote.name === mine.name && vote.activityId === mine.activityId));
}

function renderResult() {
  const mine = getMine();
  if (!mine || holdResult) {
    resultBox.hidden = true;
    resultBox.replaceChildren();
    return;
  }
  const activity = activityById(mine.activityId);
  if (!activity) {
    resultBox.hidden = true;
    return;
  }
  resultBox.hidden = false;
  resultBox.innerHTML = ''
    + '<p class="result-kicker">你转到了</p>'
    + '<p class="result-title"><span>' + activity.emoji + '</span>' + esc(activity.name) + '</p>'
    + '<p class="result-blurb">' + esc(activity.blurb) + '</p>';
}

function renderBoard() {
  const votes = visibleVotes();
  const boardKey = JSON.stringify(votes) + ":" + !!(room && room.closed) + ":" + ((getMine() && getMine().name) || "");
  if (boardKey === lastBoard) return;
  lastBoard = boardKey;
  const tally = tallyOf(votes);
  renderWinner(tally);
  statsBox.replaceChildren();
  const title = document.createElement("h2");
  title.className = "stats-title";
  title.textContent = (room && room.closed ? "最终票数" : "实时票数") + " · " + tally.total + " 人";
  statsBox.appendChild(title);
  const mine = (!holdResult && getMine()) || null;
  tally.rows.forEach((row) => {
    const stat = document.createElement("div");
    stat.className = "stat";
    if (tally.top.length === 1 && row.id === tally.top[0].id) stat.classList.add("is-leader");
    if (tally.total > 0 && row.count === 0) stat.classList.add("is-zero");
    const emoji = document.createElement("div");
    emoji.className = "stat-emoji";
    emoji.textContent = row.emoji;
    const main = document.createElement("div");
    main.className = "stat-main";
    const line = document.createElement("div");
    line.className = "topline";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = row.name;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = row.count + " 票";
    line.append(label, count);
    const track = document.createElement("div");
    track.className = "track";
    const bar = document.createElement("span");
    bar.style.width = (tally.max ? (row.count / tally.max) * 100 : 0) + "%";
    bar.style.background = row.color;
    track.appendChild(bar);
    main.append(line, track);
    if (row.people.length) {
      const people = document.createElement("div");
      people.className = "people";
      row.people.forEach((person) => {
        const chip = document.createElement("span");
        chip.textContent = person;
        if (mine && person === mine.name) chip.classList.add("is-me");
        people.appendChild(chip);
      });
      main.appendChild(people);
    }
    stat.append(emoji, main);
    statsBox.appendChild(stat);
  });
}

function renderWinner(tally) {
  winnerBox.classList.toggle("is-final", !!(room && room.closed));
  winnerBox.classList.toggle("is-empty", tally.total === 0);
  if (tally.total === 0) {
    winnerBox.hidden = false;
    winnerBox.innerHTML = '<p class="winner-kicker">还没有票</p><p>把链接发到群里，每个人转一次。</p>';
    return;
  }
  winnerBox.hidden = false;
  if (tally.top.length === 1) {
    const leader = tally.top[0];
    const counts = tally.rows.map((row) => row.count).sort((a, b) => b - a);
    const second = counts.length > 1 ? counts[1] : 0;
    let kicker = room && room.closed ? "本局结果" : "当前最高票";
    let sub = leader.count + " 票";
    if (second > 0) sub += "，领先 " + (leader.count - second) + " 票";
    else sub += "，其他活动还没有票";
    winnerBox.innerHTML = ''
      + '<p class="winner-kicker">' + kicker + '</p>'
      + '<div class="winner-main"><span class="winner-emoji">' + leader.emoji + '</span><div>'
      + '<h2>' + esc(leader.name) + '</h2>'
      + '<p>' + esc(sub) + '</p>'
      + '<p class="result-blurb">' + esc(leader.blurb) + '</p>'
      + '</div></div>';
    return;
  }
  const kicker = room && room.closed ? "并列胜出" : "并列最高";
  const items = tally.top.map((row) => (
    '<li><span class="winner-emoji">' + row.emoji + '</span><div><strong>'
    + esc(row.name) + '</strong><em>' + row.count + ' 票</em><p class="result-blurb">'
    + esc(row.blurb) + '</p></div></li>'
  )).join("");
  winnerBox.innerHTML = '<p class="winner-kicker">' + kicker + '</p><ul class="tie-list">' + items + '</ul>';
}

function updateHub() {
  const single = (text) => text.length === 1;
  if (mode === "home") {
    hub.textContent = "开局";
    hub.disabled = creating;
    hub.style.letterSpacing = "0.12em";
    hub.setAttribute("aria-label", "创建一局");
    return;
  }
  if (spinning || creating) {
    hub.textContent = "转";
    hub.disabled = true;
    hub.style.letterSpacing = "0";
    return;
  }
  if (room && room.closed) {
    hub.textContent = "结束";
    hub.disabled = true;
    hub.style.letterSpacing = "0.12em";
    return;
  }
  if (getMine() && !holdResult) {
    hub.textContent = "已转";
    hub.disabled = true;
    hub.style.letterSpacing = "0.12em";
    return;
  }
  hub.textContent = "转";
  hub.disabled = false;
  hub.style.letterSpacing = "0";
  hub.setAttribute("aria-label", "开始转动");
  void single;
}

function updateHostTools() {
  const tools = document.getElementById("host-tools");
  const host = mode === "room" && isHost();
  tools.hidden = !host;
  document.getElementById("close-btn").hidden = !(host && room && !room.closed);
  document.getElementById("reopen-btn").hidden = !(host && room && room.closed);
}

function updateCopy() {
  if (mode === "home") {
    lede.textContent = "转一次算一票，票数最高的团建胜出。";
    document.title = "团建幸运大转盘";
    return;
  }
  const count = room && room.votes ? room.votes.length : 0;
  lede.textContent = room && room.closed
    ? "投票已结束 · 房间 " + roomId
    : "房间 " + roomId + " · 已有 " + count + " 人";
  document.title = "房间 " + roomId + " · 幸运大转盘";
  fair.textContent = room && room.closed
    ? "这一局已经结束，下面是最终票数。"
    : "每个名字只能转一次。转到哪由电脑决定，转盘只是把结果演出来。";
  footnote.textContent = isHost()
    ? "票数记在这台电脑上。网页可以关，不要关黑色的命令行窗口。"
    : "每人只能转一次。最高票如果并列，就一起胜出。";
  const mine = getMine();
  if (spinning || holdResult) {
    nameInput.disabled = true;
  } else if (mine) {
    nameInput.value = mine.name;
    nameInput.disabled = true;
  } else {
    nameInput.disabled = !!(room && room.closed);
  }
}

function updatePanels() {
  homePanel.hidden = mode !== "home";
  roomPanel.hidden = mode !== "room";
  placeShare();
  renderShare();
  renderResult();
  renderBoard();
  updateHub();
  updateHostTools();
  updateCopy();
}

function showHome(replaceUrl) {
  stopPoll();
  room = null;
  roomId = "";
  mode = "home";
  holdResult = false;
  lastBoard = "";
  if (replaceUrl) history.replaceState({}, "", "/");
  updatePanels();
}

function applyRoom(next) {
  const justClosed = !!(room && !room.closed && next.closed);
  room = next;
  updatePanels();
  if (justClosed) celebrate();
}

async function enterRoom(id, opts) {
  id = String(id || "").trim().toUpperCase();
  if (!ROOM_RE.test(id)) {
    toast("房间码是 4 位，不含 0、1、I、O");
    return;
  }
  let data;
  try {
    data = await api("/api/rooms/" + id);
  } catch (e) {
    toast(ERRORS[e.message] || "进不去这个房间");
    return;
  }
  stopPoll();
  roomId = id;
  mode = "room";
  holdResult = false;
  if (!nameInput.value) nameInput.value = localStorage.getItem("tw-name") || "";
  if (!opts || !opts.fromPop) history.pushState({ room: id }, "", "/?room=" + id);
  room = null;
  applyRoom(data);
  snapToMine();
  startPoll();
}

async function createRoom() {
  if (creating) return;
  creating = true;
  updateHub();
  try {
    const data = await api("/api/rooms", { method: "POST", body: {} });
    localStorage.setItem("tw-host-" + data.id, data.hostToken);
    await enterRoom(data.id);
    toast("把邀请语发到群里，每人转一次");
  } catch (e) {
    toast("没能开局，请重试");
  } finally {
    creating = false;
    updateHub();
  }
}

async function spin() {
  if (spinning || mode !== "room") return;
  if (room && room.closed) {
    toast("这一局已经结束");
    return;
  }
  if (getMine()) {
    toast("你已经转过一次了");
    return;
  }
  const name = nameInput.value.trim();
  if (!name) {
    toast("先写上你的名字");
    nameInput.focus();
    nameInput.classList.remove("shake");
    void nameInput.offsetWidth;
    nameInput.classList.add("shake");
    return;
  }
  spinning = true;
  holdResult = true;
  updateHub();
  if (soundOn) {
    try { ensureAudio(); } catch (e) { /* ignore */ }
  }
  try {
    const data = await api("/api/rooms/" + roomId + "/spin", {
      method: "POST",
      body: { voterId: voterId(), name }
    });
    localStorage.setItem("tw-name", name);
    localStorage.setItem("tw-vote-" + roomId, JSON.stringify({
      name,
      activityId: data.activity.id
    }));
    room = data.room;
    lastBoard = "";
    updatePanels();
    const index = activities.findIndex((activity) => activity.id === data.activity.id);
    await animateTo(index < 0 ? data.index : index);
    holdResult = false;
    lastBoard = "";
    updatePanels();
    celebrate();
  } catch (e) {
    holdResult = false;
    if (e.data && e.data.error === "already_voted") {
      localStorage.setItem("tw-vote-" + roomId, JSON.stringify({
        name: e.data.name || name,
        activityId: e.data.activityId
      }));
      snapToMine();
    }
    toast(ERRORS[e.message] || "没转成，再试一次");
    updatePanels();
  } finally {
    spinning = false;
    updateHub();
  }
}

async function hostAction(action) {
  try {
    const next = await api("/api/rooms/" + roomId + "/" + action, {
      method: "POST",
      body: { hostToken: hostToken() }
    });
    if (action === "reset") {
      localStorage.removeItem("tw-vote-" + roomId);
      holdResult = false;
      nameInput.disabled = false;
      nameInput.value = localStorage.getItem("tw-name") || "";
      rotation = 0;
    }
    applyRoom(next);
  } catch (e) {
    toast(ERRORS[e.message] || "操作没成功");
  }
}

function startPoll() {
  stopPoll();
  pollTimer = setInterval(refreshRoom, 2000);
}

function stopPoll() {
  clearInterval(pollTimer);
  pollTimer = 0;
}

async function refreshRoom() {
  if (!roomId) return;
  try {
    const tasks = [api("/api/rooms/" + roomId)];
    if (isHost() && !meta.publicUrl) tasks.push(api("/api/meta"));
    const results = await Promise.all(tasks);
    if (results[1]) {
      meta.publicUrl = results[1].publicUrl || "";
      meta.tunnel = results[1].tunnel || meta.tunnel;
      meta.mode = results[1].mode || meta.mode;
      meta.addresses = results[1].addresses || meta.addresses;
    }
    if (results[0] && results[0].id === roomId) applyRoom(results[0]);
  } catch (e) { /* keep the last good room */ }
}

function rotationFor(index) {
  const slice = (Math.PI * 2) / activities.length;
  return -((index + 0.5) * slice);
}

function snapToMine() {
  const mine = getMine();
  if (!mine) return;
  const index = activities.findIndex((activity) => activity.id === mine.activityId);
  if (index >= 0) rotation = rotationFor(index);
}

function animateTo(index) {
  const tau = Math.PI * 2;
  const dest = rotationFor(index);
  const currentMod = ((rotation % tau) + tau) % tau;
  const destMod = ((dest % tau) + tau) % tau;
  let delta = destMod - currentMod;
  if (delta < 0.02) delta += tau;
  const turns = (reduceMotion || fast) ? 0 : tau * (5 + Math.floor(Math.random() * 2));
  const target = rotation + delta + turns;
  const dur = (reduceMotion || fast) ? 280 : 4600;
  return new Promise((resolve) => {
    anim = { from: rotation, to: target, start: performance.now(), dur, resolve };
  });
}

function sliceAt(rot) {
  const count = activities.length;
  if (!count) return 0;
  const slice = (Math.PI * 2) / count;
  let value = ((-rot / slice) - 0.5) % count;
  if (value < 0) value += count;
  return Math.floor(value + 1e-4) % count;
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth || 320;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = canvas.width;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function norm(angle) {
  const tau = Math.PI * 2;
  angle %= tau;
  if (angle < 0) angle += tau;
  return angle;
}

function draw(now) {
  const width = canvas.clientWidth || 320;
  ctx.clearRect(0, 0, width, width);
  const cx = width / 2;
  const cy = width / 2;
  const count = activities.length;
  if (!count) return;
  const slice = (Math.PI * 2) / count;
  const radius = width * 0.355;

  ctx.beginPath();
  ctx.arc(cx, cy, width * 0.445, 0, Math.PI * 2);
  ctx.fillStyle = "#6a3b22";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, width * 0.408, 0, Math.PI * 2);
  ctx.fillStyle = "#f3d48a";
  ctx.fill();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  for (let i = 0; i < count; i++) {
    const activity = activities[i];
    const start = -Math.PI / 2 + i * slice;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, start + slice);
    ctx.closePath();
    ctx.fillStyle = activity.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,248,236,0.92)";
    ctx.stroke();
    drawLabel(activity.name, start, slice, radius, width);
  }
  ctx.restore();

  const bulbRadius = width * 0.445;
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (i + 0.5) * slice;
    const x = cx + Math.cos(angle) * bulbRadius;
    const y = cy + Math.sin(angle) * bulbRadius;
    const on = !anim || Math.floor((now || 0) / 140) % 2 === i % 2;
    ctx.beginPath();
    ctx.fillStyle = on ? "#ffe7a8" : "#4a2c1c";
    ctx.arc(x, y, Math.max(3.5, width * 0.013), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, width * 0.118, 0, Math.PI * 2);
  ctx.fillStyle = "#f3d48a";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, width * 0.096, 0, Math.PI * 2);
  ctx.fillStyle = "#c53424";
  ctx.fill();
  void norm;
}

function drawLabel(name, start, slice, radius, width) {
  const glyphs = Array.from(name);
  const outward = norm(rotation + start + slice / 2);
  const flip = Math.sin(outward) > 0.18;
  ctx.save();
  ctx.rotate(start + slice / 2 + Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff8ef";
  const innerLimit = radius * 0.5;
  const outer = radius - Math.max(16, width * 0.045);
  const available = Math.max(glyphs.length * 14, outer - innerLimit);
  let size = Math.floor(available / glyphs.length) - 3;
  size = Math.max(13, Math.min(size, Math.round(width / 14)));
  const step = size + 3;
  const block = glyphs.length * step;
  let top = outer - Math.max(0, (available - block) / 2) - step / 2;
  if (top - block < innerLimit) top = innerLimit + block;
  ctx.font = "700 " + size + "px " + FONT;
  ctx.shadowColor = "rgba(40,16,8,0.45)";
  ctx.shadowBlur = 3;
  for (let i = 0; i < glyphs.length; i++) {
    const y = -(top - i * step);
    const glyph = flip ? glyphs[glyphs.length - 1 - i] : glyphs[i];
    ctx.save();
    ctx.translate(0, y);
    if (flip) ctx.rotate(Math.PI);
    ctx.fillText(glyph, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function frame(now) {
  if (anim) {
    const t = Math.min(1, (now - anim.start) / anim.dur);
    const eased = 1 - Math.pow(1 - t, 3);
    const prev = sliceAt(rotation);
    rotation = anim.from + (anim.to - anim.from) * eased;
    if (soundOn && sliceAt(rotation) !== prev && now - lastTickAt > 42) {
      lastTickAt = now;
      tick();
    }
    if (t >= 1) {
      rotation = anim.to;
      const done = anim.resolve;
      anim = null;
      done();
    }
  } else if (mode === "home") {
    rotation += 0.0035;
  }
  draw(now);
  requestAnimationFrame(frame);
}

hub.addEventListener("click", () => {
  if (mode === "home") createRoom();
  else spin();
});

document.getElementById("copy").addEventListener("click", async () => {
  const ok = await copyText(isHost() ? inviteText() : shareLink());
  toast(ok ? "已复制，去群里粘贴" : "复制失败，请长按链接手动复制");
});

document.getElementById("join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  enterRoom(codeInput.value);
});

codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
});

nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    spin();
  }
});

soundBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  localStorage.setItem("tw-sound", soundOn ? "1" : "0");
  updateSoundButton();
  if (soundOn) blip(620, 0.06, 0.02);
});

document.getElementById("close-btn").addEventListener("click", () => {
  if (confirm("结束后不能再转。按现在的票数公布结果？")) hostAction("close");
});

document.getElementById("reopen-btn").addEventListener("click", () => hostAction("reopen"));

document.getElementById("reset-btn").addEventListener("click", () => {
  if (confirm("清空后这一局从零开始，所有人可以重新转。确定吗？")) hostAction("reset");
});

window.addEventListener("popstate", () => {
  const id = new URLSearchParams(location.search).get("room");
  if (id) enterRoom(id, { fromPop: true });
  else showHome(false);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshRoom();
});

window.addEventListener("resize", resize);
if (window.ResizeObserver) {
  const observer = new ResizeObserver(() => resize());
  observer.observe(document.getElementById("wheel-box"));
}

updateSoundButton();
resize();
requestAnimationFrame(frame);

async function boot() {
  meta = await api("/api/meta");
  activities = meta.activities || [];
  renderMenu();
  resize();
  const id = new URLSearchParams(location.search).get("room");
  if (id) await enterRoom(id, { fromPop: true });
  else showHome(false);
}

boot().catch(() => {
  lede.textContent = "转盘服务没连上。请确认黑色窗口还开着，然后刷新。";
});
