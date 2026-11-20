import { clientKeyFrom, startAttempt } from "../../../src/server/attempt";
import { json } from "../../../src/server/http";

export async function POST(request: Request): Promise<Response> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return json({ error: "无法开始考试。" }, 400);
  }
  if (text.length > 4_000) return json({ error: "无法开始考试。" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "无法开始考试。" }, 400);
  }
  const name = typeof body === "object" && body !== null && "name" in body ? (body as { name?: unknown }).name : "";
  const forwarded = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
  const result = await startAttempt(typeof name === "string" ? name : "", clientKeyFrom(forwarded));
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ token: result.token, name: result.name, deadline: result.deadline });
}
