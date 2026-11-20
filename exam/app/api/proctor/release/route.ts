import { releaseAnswers } from "../../../../src/server/attempt";
import { json } from "../../../../src/server/http";
import { proctorGate } from "../../../../src/server/proctorGate";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ error: "无法公布答案。" }, 400);
  }
  const passphrase = typeof body === "object" && body !== null && "passphrase" in body ? String((body as { passphrase?: unknown }).passphrase ?? "") : "";
  const gate = await proctorGate(passphrase);
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  const round = await releaseAnswers();
  if (!round) return json({ error: "考试还没开始。" }, 409);
  return json(round);
}
