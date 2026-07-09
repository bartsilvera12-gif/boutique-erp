import { config } from "dotenv";
import path from "node:path";
import { readFileSync } from "node:fs";
import pg from "pg";

config({ path: path.resolve(process.cwd(), ".env.local") });

const url =
  process.env.SUPABASE_DB_URL?.trim() ||
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim();

const file = process.argv[2];
if (!url || !file) {
  console.error("Uso: npx tsx scripts/_run-sql-file-pg.ts <path/al/archivo.sql>");
  process.exit(2);
}

async function main() {
  const sql = readFileSync(path.resolve(file), "utf8");
  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    const r = await client.query(sql);
    console.log(`OK · ${file}` + (r.rowCount != null ? ` · rowCount=${r.rowCount}` : ""));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
