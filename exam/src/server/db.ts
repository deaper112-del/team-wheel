import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";

const shared = globalThis as typeof globalThis & {
  __examPool?: pg.Pool;
  __examLocal?: Promise<PGlite>;
};

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  if (databaseUrl !== "") {
    shared.__examPool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
    return (await shared.__examPool.query(text, params)).rows as T[];
  }
  shared.__examLocal ??= startLocal().catch((error: unknown) => {
    shared.__examLocal = undefined;
    throw error;
  });
  return (await (await shared.__examLocal).query<T>(text, params)).rows;
}

async function startLocal(): Promise<PGlite> {
  const db = new PGlite();
  const files = (await readdir("migrations").catch(() => [])).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(await readFile(`migrations/${file}`, "utf8"));
  }
  return db;
}
