import { paperSummary } from "../../../src/display";
import { combineUploads } from "../../../src/grade";
import { parseExamFile } from "../../../src/parse";
import { json, readFileEntry } from "../../../src/server/http";
import { saveExam } from "../../../src/server/paper";
import { proctorPassphraseConfigured, proctorPassphraseMatches } from "../../../src/server/passphrase";
import type { FileContent } from "../../../src/types";

async function readContent(file: File, label: string): Promise<{ content: FileContent } | { error: string }> {
  const parsed = await parseExamFile(file);
  if (!parsed.ok) return { error: `${label}：${parsed.error}` };
  return { content: parsed.content };
}

export async function POST(request: Request): Promise<Response> {
  if (!proctorPassphraseConfigured()) return json({ error: "监考口令还没有配置。" }, 503);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "无法读取上传的文件。" }, 400);
  }
  const passphrase = String(form.get("passphrase") ?? "");
  if (!proctorPassphraseMatches(passphrase)) return json({ error: "口令不对。" }, 401);

  const question = await readFileEntry(form.get("question"));
  const answer = await readFileEntry(form.get("answer"));
  if (!question && !answer) return json({ error: "请上传题目文件和答案文件。" }, 400);

  let questionContent: FileContent | null = null;
  let answerContent: FileContent | null = null;
  if (question) {
    const parsed = await readContent(question, "题目文件");
    if ("error" in parsed) return json({ error: parsed.error }, 400);
    questionContent = parsed.content;
  }
  if (answer) {
    const parsed = await readContent(answer, "答案文件");
    if ("error" in parsed) return json({ error: parsed.error }, 400);
    answerContent = parsed.content;
  }
  const combined = combineUploads(questionContent, answerContent);
  if (!combined.ok) return json({ error: combined.error }, 400);
  await saveExam(combined.paper, combined.key);
  return json({
    ok: true,
    summary: paperSummary(combined.paper),
    warning: combined.warning,
  });
}
