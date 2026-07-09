/**
 * Clona la estructura de un schema en otro nuevo (tablas vacías), todo
 * server-side via PL/pgSQL — no requiere pg_dump local.
 *
 * Uso:
 *   npx tsx scripts/clonar-schema-vacio-via-pg.ts <origen> <destino>
 * Ejemplo:
 *   npx tsx scripts/clonar-schema-vacio-via-pg.ts reservacaacupe autorepuestosfelix
 *
 * Variables (en .env.local o env del shell): SUPABASE_DB_URL | DIRECT_URL | DATABASE_URL
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

config({ path: path.resolve(process.cwd(), ".env.local") });

const [origen, destino] = process.argv.slice(2);
if (!origen || !destino) {
  console.error("Uso: npx tsx scripts/clonar-schema-vacio-via-pg.ts <origen> <destino>");
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
  console.error("Falta SUPABASE_DB_URL, DIRECT_URL o DATABASE_URL en el entorno.");
  process.exit(1);
}

async function main() {
  const useSsl =
    /[?&]sslmode=disable\b/.test(url!) ? false : url!.includes("supabase") || /sslmode=require/.test(url!);
  const client = new pg.Client({
    connectionString: url,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    const fnSql = readFileSync(
      path.resolve(process.cwd(), "scripts/sql/clone_schema.sql"),
      "utf8",
    );
    console.log("Instalando public.clone_schema(...)");
    await client.query(fnSql);

    console.log(`Clonando "${origen}" → "${destino}" (sin datos)...`);
    await client.query("SELECT public.clone_schema($1, $2, false)", [origen, destino]);

    // Grants estándar Supabase
    console.log("Aplicando grants estándar para anon/authenticated/service_role/postgres...");
    await client.query(`
      GRANT USAGE ON SCHEMA "${destino}" TO anon, authenticated, service_role;
      GRANT ALL   ON SCHEMA "${destino}" TO postgres, service_role;

      GRANT ALL ON ALL TABLES    IN SCHEMA "${destino}" TO postgres, service_role;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA "${destino}" TO postgres, service_role;
      GRANT ALL ON ALL FUNCTIONS IN SCHEMA "${destino}" TO postgres, service_role;

      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA "${destino}" TO authenticated;
      GRANT USAGE, SELECT, UPDATE         ON ALL SEQUENCES IN SCHEMA "${destino}" TO authenticated;
      GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA "${destino}" TO authenticated;

      GRANT SELECT ON ALL TABLES    IN SCHEMA "${destino}" TO anon;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${destino}" TO anon;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA "${destino}" TO anon;

      ALTER DEFAULT PRIVILEGES IN SCHEMA "${destino}" GRANT ALL ON TABLES    TO postgres, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA "${destino}" GRANT ALL ON SEQUENCES TO postgres, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA "${destino}" GRANT ALL ON FUNCTIONS TO postgres, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA "${destino}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA "${destino}" GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA "${destino}" GRANT EXECUTE ON FUNCTIONS TO authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA "${destino}" GRANT SELECT ON TABLES TO anon;
      ALTER DEFAULT PRIVILEGES IN SCHEMA "${destino}" GRANT USAGE, SELECT ON SEQUENCES TO anon;
      ALTER DEFAULT PRIVILEGES IN SCHEMA "${destino}" GRANT EXECUTE ON FUNCTIONS TO anon;
    `);

    // Resumen
    const counts = await client.query(
      `SELECT
         (SELECT count(*) FROM information_schema.tables    WHERE table_schema = $1 AND table_type='BASE TABLE') AS tables,
         (SELECT count(*) FROM information_schema.views     WHERE table_schema = $1) AS views,
         (SELECT count(*) FROM information_schema.sequences WHERE sequence_schema = $1) AS sequences,
         (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1) AS functions`,
      [destino],
    );
    console.log(`OK. Resumen schema "${destino}":`, counts.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
