import { gradeSaved } from "../../../src/server/paper";
import { json } from "../../../src/server/http";
import type { ResponseValue } from "../../../src/types";

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
  const raw = body as { name?: unknown; responses?: unknown };
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return json({ error: "请填写考生姓名。" }, 400);
  if (name.length > 30) return json({ error: "姓名请控制在 30 个字以内。" }, 400);
  if (typeof raw.responses !== "object" || raw.responses === null || Array.isArray(raw.responses)) {
    return json({ error: "答卷格式无法识别。" }, 400);
  }
  const report = await gradeSaved(raw.responses as Record<string, ResponseValue | undefined>);
  if (!report) return json({ error: "考试还没开始。" }, 409);
  return json({ name, report });
}
