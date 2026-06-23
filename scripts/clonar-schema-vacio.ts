/**
 * Clona la ESTRUCTURA de un schema Postgres en otro schema nuevo (tablas vacías).
 * Copia: tablas, columnas, defaults, índices, PKs/FKs, secuencias, funciones,
 * triggers, vistas, RLS y policies. NO copia datos.
 *
 * Uso:
 *   npx tsx scripts/clonar-schema-vacio.ts <schema_origen> <schema_destino>
 * Ejemplo:
 *   npx tsx scripts/clonar-schema-vacio.ts zentra_erp autorepuestos_felix_bogado
 *
 * Requisitos:
 *   - `pg_dump` y `psql` en el PATH (vienen con la instalación de Postgres / Supabase CLI).
 *   - Variables en `.env.local`: SUPABASE_DB_URL | DIRECT_URL | DATABASE_URL.
 *   - El schema destino NO debe existir (o pasar --force para recrearlo vacío).
 *
 * Cómo funciona:
 *   1) pg_dump --schema-only -n <origen>  → SQL con la estructura.
 *   2) Reescribe identificadores `<origen>` → `<destino>` (calificados y unquoted).
 *   3) psql aplica el SQL contra la base.
 */
import { config } from "dotenv";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

config({ path: path.resolve(process.cwd(), ".env.local") });

const args = process.argv.slice(2);
const force = args.includes("--force");
const positional = args.filter((a) => !a.startsWith("--"));
const [origen, destino] = positional;

if (!origen || !destino) {
  console.error(
    "Uso: npx tsx scripts/clonar-schema-vacio.ts <schema_origen> <schema_destino> [--force]",
  );
  process.exit(1);
}
for (const n of [origen, destino]) {
  if (!/^[a-z_][a-z0-9_]*$/.test(n)) {
    console.error(`Nombre de schema inválido: "${n}"`);
    process.exit(1);
  }
}
if (origen === destino) {
  console.error("origen y destino no pueden ser iguales");
  process.exit(1);
}

const url =
  process.env.SUPABASE_DB_URL?.trim() ||
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("Falta SUPABASE_DB_URL, DIRECT_URL o DATABASE_URL en .env.local");
  process.exit(1);
}

function which(cmd: string) {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    encoding: "utf8",
  });
  if (probe.status !== 0) {
    console.error(
      `No se encontró "${cmd}" en el PATH. Instalá Postgres client tools (vienen con Supabase CLI).`,
    );
    process.exit(1);
  }
}
which("pg_dump");
which("psql");

async function main() {
  const client = new pg.Client({
    connectionString: url,
    ssl: url!.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    const { rows: srcRows } = await client.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
      [origen],
    );
    if (!srcRows.length) throw new Error(`Schema origen "${origen}" no existe.`);

    const { rows: dstRows } = await client.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
      [destino],
    );
    if (dstRows.length) {
      if (!force) {
        throw new Error(
          `Schema destino "${destino}" ya existe. Pasá --force para borrarlo y recrearlo vacío.`,
        );
      }
      console.log(`Destino "${destino}" existe — DROP SCHEMA CASCADE (--force)`);
      await client.query(`DROP SCHEMA "${destino}" CASCADE`);
    }
  } finally {
    await client.end();
  }

  const tmp = mkdtempSync(path.join(tmpdir(), "clone-schema-"));
  const dumpPath = path.join(tmp, `${origen}.sql`);
  const rewrittenPath = path.join(tmp, `${destino}.sql`);

  try {
    console.log(`pg_dump --schema-only -n ${origen} → ${dumpPath}`);
    execFileSync(
      "pg_dump",
      [
        "--schema-only",
        "--no-owner",
        "--no-privileges",
        "--no-publications",
        "--no-subscriptions",
        "-n",
        origen,
        "-f",
        dumpPath,
        url!,
      ],
      { stdio: "inherit" },
    );

    let sql = readFileSync(dumpPath, "utf8");

    // Reemplazo seguro del identificador del schema:
    //   - "origen".         → "destino".
    //   - origen.            → destino.
    //   - SCHEMA "origen"   / SCHEMA origen
    //   - search_path inicial
    // Word boundary para no pisar substrings de otros nombres.
    const reQuoted = new RegExp(`"${origen}"`, "g");
    const reBare = new RegExp(`\\b${origen}\\b`, "g");
    sql = sql.replace(reQuoted, `"${destino}"`).replace(reBare, destino);

    writeFileSync(rewrittenPath, sql);
    console.log(`SQL reescrito → ${rewrittenPath}`);

    console.log(`psql aplicando estructura en "${destino}"...`);
    execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-f", rewrittenPath, url!], {
      stdio: "inherit",
    });

    console.log(`OK: schema "${destino}" creado con la estructura de "${origen}" (sin datos).`);
    console.log(
      `Recordá: si la app va a apuntar acá, seteá NEURA_CLIENT_SCHEMA=${destino} en .env.local`,
    );
    console.log(
      `y agregalo a supabase/config.toml (schemas + extra_search_path) y a Exposed schemas en Supabase Cloud.`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
