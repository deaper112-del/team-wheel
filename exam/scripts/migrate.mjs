import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

function statementsOf(sqlText) {
  return sqlText
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.split("\n").some((line) => {
      const trimmed = line.trim();
      return trimmed !== "" && !trimmed.startsWith("--");
    }));
}

function safeMessage(error) {
  const message = error instanceof Error ? error.message : "migration failed";
  return /postgres(ql)?:\/\//i.test(message) ? "migration failed" : message;
}

const url = process.env.DATABASE_URL?.trim() ?? "";
const files = (await readdir("migrations").catch(() => []))
  .filter((file) => file.endsWith(".sql"))
  .sort();
if (url === "" || files.length === 0) {
  console.log("migrate: nothing to do");
  process.exit(0);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED?.trim() || url });
await client.connect();
try {
  await client.query("set lock_timeout = '60s'");
  await client.query("select pg_advisory_lock(7272741)");
  await client.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set((await client.query("select name from schema_migrations")).rows.map((row) => row.name));
  for (const file of files.filter((name) => !done.has(name))) {
    await client.query("begin");
    try {
      const statements = statementsOf(await readFile(`migrations/${file}`, "utf8"));
      for (const statement of statements) await client.query(statement);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`migrate: applied ${file}`);
    } catch (error) {
      await client.query("rollback");
      console.error(`migrate: ${file} failed: ${safeMessage(error)}`);
      throw error;
    }
  }
} finally {
  await client.end();
}
