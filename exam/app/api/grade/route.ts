import { submitAttempt } from "../../../src/server/attempt";
import { json } from "../../../src/server/http";

export async function POST(request: Request): Promise<Response> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return json({ error: "答卷格式无法识别。" }, 400);
  }
  if (text.length > 1_500_000) return json({ error: "答卷太大。" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "答卷格式无法识别。" }, 400);
  }
  if (typeof body !== "object" || body === null) return json({ error: "答卷格式无法识别。" }, 400);
  const raw = body as { token?: unknown; responses?: unknown };
  const token = typeof raw.token === "string" ? raw.token : "";
  const result = await submitAttempt(token, raw.responses);
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ name: result.name, report: result.report, released: result.released });
}
