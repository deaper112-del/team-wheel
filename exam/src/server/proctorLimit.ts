import { sql } from "./db";

const LIMIT = 8;

export async function proctorAttemptsBlocked(): Promise<boolean> {
  const rows = await sql<{ n: number | string }>(
    "select count(*)::int as n from proctor_failure where created_at > now() - interval '10 minutes'",
  );
  return Number(rows[0]?.n ?? 0) >= LIMIT;
}

export async function recordProctorFailure(): Promise<void> {
  await sql("delete from proctor_failure where created_at < now() - interval '1 day'");
  await sql("insert into proctor_failure (created_at) values (now())");
}
