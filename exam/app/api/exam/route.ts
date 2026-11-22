import { getPublicExam } from "../../../src/server/paper";
import { json } from "../../../src/server/http";

export async function GET(): Promise<Response> {
  const exam = await getPublicExam();
  if (!exam) return json({ ready: false });
  return json(exam);
}
