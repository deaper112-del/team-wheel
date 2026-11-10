import activities from "../activities.json";

const ROOM_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
const VOTER_RE = /^[A-Za-z0-9-]{8,64}$/;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/meta" || url.pathname.startsWith("/api/rooms")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        return json({ error: "request_failed" }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === "/api/meta" && method === "GET") {
    return json({
      activities,
      port: 443,
      mode: "cloud",
      addresses: [],
      publicUrl: url.origin,
      tunnel: "ready"
    });
  }

  if (path === "/api/rooms" && method === "POST") {
    const createdAt = Date.now();
    for (let i = 0; i < 30; i++) {
      const id = newRoomId();
      const hostToken = newToken();
      try {
        await env.DB.prepare(
          "INSERT INTO rooms (id, host_token, created_at, closed) VALUES (?, ?, ?, 0)"
        ).bind(id, hostToken, createdAt).run();
        return json({ id, hostToken });
      } catch (err) {
        continue;
      }
    }
    return json({ error: "request_failed" }, 500);
  }

  const match = path.match(/^\/api\/rooms\/([A-Za-z0-9]{4})(?:\/(spin|close|reopen|reset))?$/);
  if (!match) return json({ error: "not_found" }, 404);
  const id = match[1].toUpperCase();
  const action = match[2] || "";
  if (!ROOM_RE.test(id)) return json({ error: "bad_room" }, 400);

  if (method === "GET" && !action) {
    const room = await publicRoom(env, id);
    if (!room) return json({ error: "room_not_found" }, 404);
    return json(room);
  }

  if (method === "POST" && action === "spin") return spin(env, id, await readBody(request));
  if (method === "POST" && (action === "close" || action === "reopen" || action === "reset")) {
    return hostAction(env, id, action, await readBody(request));
  }
  return json({ error: "not_found" }, 404);
}

async function spin(env, id, body) {
  const name = String(body.name || "").trim();
  const voterId = String(body.voterId || "").trim();
  if (!validName(name)) return json({ error: name ? "name_invalid" : "name_required" }, 400);
  if (!VOTER_RE.test(voterId)) return json({ error: "bad_voter" }, 400);

  const index = randomIndex(activities.length);
  const activity = activities[index];
  let inserted = false;
  try {
    const result = await env.DB.prepare(
      "INSERT INTO votes (room_id, voter_id, name, activity_id, at) " +
      "SELECT ?1, ?2, ?3, ?4, ?5 " +
      "WHERE EXISTS (SELECT 1 FROM rooms WHERE id = ?1 AND closed = 0) " +
      "AND (SELECT COUNT(*) FROM votes WHERE room_id = ?1) < 300 " +
      "AND NOT EXISTS (SELECT 1 FROM votes WHERE room_id = ?1 AND voter_id = ?2) " +
      "AND NOT EXISTS (SELECT 1 FROM votes WHERE room_id = ?1 AND name = ?3)"
    ).bind(id, voterId, name, activity.id, Date.now()).run();
    inserted = result.meta && result.meta.changes === 1;
  } catch (err) {
    inserted = false;
  }
  if (inserted) {
    return json({ index, activity, room: await publicRoom(env, id) });
  }

  const room = await env.DB.prepare("SELECT closed FROM rooms WHERE id = ?").bind(id).first();
  if (!room) return json({ error: "room_not_found" }, 404);
  if (room.closed === 1) return json({ error: "closed" }, 403);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM votes WHERE room_id = ?").bind(id).first();
  if (count && count.n >= 300) return json({ error: "room_full" }, 400);
  const existing = await env.DB.prepare(
    "SELECT voter_id, name, activity_id FROM votes WHERE room_id = ? AND (voter_id = ? OR name = ?)"
  ).bind(id, voterId, name).all();
  const rows = existing.results || [];
  const mine = rows.find((row) => row.voter_id === voterId);
  if (mine) return json({ error: "already_voted", activityId: mine.activity_id, name: mine.name }, 409);
  if (rows.length) return json({ error: "name_taken" }, 409);
  return json({ error: "request_failed" }, 500);
}

async function hostAction(env, id, action, body) {
  const token = String(body.hostToken || "");
  const room = await env.DB.prepare("SELECT host_token FROM rooms WHERE id = ?").bind(id).first();
  if (!room) return json({ error: "room_not_found" }, 404);
  if (!token || token !== room.host_token) return json({ error: "forbidden" }, 403);
  if (action === "reset") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM votes WHERE room_id = ?").bind(id),
      env.DB.prepare("UPDATE rooms SET closed = 0 WHERE id = ?").bind(id)
    ]);
  } else if (action === "close") {
    await env.DB.prepare("UPDATE rooms SET closed = 1 WHERE id = ?").bind(id).run();
  } else {
    await env.DB.prepare("UPDATE rooms SET closed = 0 WHERE id = ?").bind(id).run();
  }
  return json(await publicRoom(env, id));
}

async function publicRoom(env, id) {
  const room = await env.DB.prepare(
    "SELECT id, closed, created_at FROM rooms WHERE id = ?"
  ).bind(id).first();
  if (!room) return null;
  const votes = await env.DB.prepare(
    "SELECT name, activity_id, at FROM votes WHERE room_id = ? ORDER BY at"
  ).bind(id).all();
  const rows = votes.results || [];
  return {
    id: room.id,
    closed: room.closed === 1,
    createdAt: room.created_at,
    votes: rows.map((row) => ({ name: row.name, activityId: row.activity_id, at: row.at })),
    voterCount: rows.length
  };
}

async function readBody(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text.slice(0, 8192));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

function validName(name) {
  if (!name || name.length < 1 || name.length > 12) return false;
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

function newRoomId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let id = "";
  for (let i = 0; i < bytes.length; i++) id += ALPHABET[bytes[i] % ALPHABET.length];
  return id;
}

function newToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let token = "";
  for (let i = 0; i < bytes.length; i++) token += bytes[i].toString(16).padStart(2, "0");
  return token;
}

function randomIndex(count) {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % count;
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
