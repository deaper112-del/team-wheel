import { json } from "../../../../../src/server/http";
import { proctorGate } from "../../../../../src/server/proctorGate";
import { groupPapers, subjectBoard } from "../../../../../src/server/subjects";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ error: "无法合并科目。" }, 400);
  }
  const raw = typeof body === "object" && body !== null ? (body as { passphrase?: unknown; paperIds?: unknown; subjectId?: unknown; name?: unknown }) : {};
  const gate = await proctorGate(typeof raw.passphrase === "string" ? raw.passphrase : "");
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  const paperIds = Array.isArray(raw.paperIds) ? raw.paperIds.filter((id): id is number => typeof id === "number") : [];
  const subjectId = typeof raw.subjectId === "number" ? raw.subjectId : null;
  const name = typeof raw.name === "string" ? raw.name : "";
  const grouped = await groupPapers(paperIds, { subjectId, name });
  if (!grouped.ok) return json({ error: grouped.error }, 400);
  return json(await subjectBoard(grouped.subjectId));
}
