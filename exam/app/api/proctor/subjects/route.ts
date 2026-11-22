import { json } from "../../../../src/server/http";
import { proctorGate } from "../../../../src/server/proctorGate";
import { subjectBoard } from "../../../../src/server/subjects";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ error: "无法读取科目。" }, 400);
  }
  const raw = typeof body === "object" && body !== null ? (body as { passphrase?: unknown; subjectId?: unknown }) : {};
  const gate = await proctorGate(typeof raw.passphrase === "string" ? raw.passphrase : "");
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  const subjectId = typeof raw.subjectId === "number" ? raw.subjectId : null;
  return json(await subjectBoard(subjectId));
}
