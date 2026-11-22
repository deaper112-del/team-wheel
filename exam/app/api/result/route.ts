import { candidatePayload } from "../../../src/reportView";
import { candidateResult } from "../../../src/server/attempt";
import { json } from "../../../src/server/http";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ error: "无法查看成绩。" }, 400);
  }
  const token = typeof body === "object" && body !== null && "token" in body ? (body as { token?: unknown }).token : "";
  const result = await candidateResult(typeof token === "string" ? token : "");
  if (!result.ok) return json({ error: result.error }, result.status);
  return json(candidatePayload(result.name, result.released, result.report));
}
