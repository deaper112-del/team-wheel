import { paperSummary } from "../../../../../src/display";
import { json } from "../../../../../src/server/http";
import { proctorGate } from "../../../../../src/server/proctorGate";
import { startSavedPaper, subjectBoard } from "../../../../../src/server/subjects";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ error: "无法开始考试。" }, 400);
  }
  const raw = typeof body === "object" && body !== null ? (body as { passphrase?: unknown; paperId?: unknown }) : {};
  const gate = await proctorGate(typeof raw.passphrase === "string" ? raw.passphrase : "");
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  const paperId = typeof raw.paperId === "number" ? raw.paperId : 0;
  const started = await startSavedPaper(paperId);
  if (!started) return json({ error: "没有这份试卷。" }, 404);
  const board = await subjectBoard(started.subjectId);
  return json({ ok: true, summary: paperSummary(started.paper), ...board });
}
