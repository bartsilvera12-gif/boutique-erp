/**
 * Crea el schema Postgres del cliente (mono-tenant) con los grants estándar
 * que la app espera para PostgREST + service role.
 *
 * Uso:
 *   npx tsx scripts/crear-schema-cliente.ts [nombre_schema]
 *
 * Si no pasás argumento toma `NEURA_CLIENT_SCHEMA` de `.env.local`,
 * y si tampoco existe usa `autorepuestos_felix_bogado`.
 *
 * Variables (en `.env.local`):
 *   SUPABASE_DB_URL | DIRECT_URL | DATABASE_URL  (en ese orden de prioridad)
 *
 * Tras correrlo:
 *   1) Agregá el schema a `supabase/config.toml`:
 *        node scripts/add-tenant-schema-to-local-config.mjs <nombre_schema>
 *      (o editá `schemas = [...]` y `extra_search_path = [...]` a mano).
 *   2) Seteá `NEURA_CLIENT_SCHEMA=<nombre_schema>` en `.env.local`.
 *   3) En Supabase Cloud: Settings → API → Exposed schemas debe incluirlo.
 *   4) Aplicá las migraciones del repo apuntando ya a este schema.
 */
import { config } from "dotenv";
import path from "node:path";
import pg from "pg";

config({ path: path.resolve(process.cwd(), ".env.local") });

const SCHEMA_DEFAULT = "autorepuestos_felix_bogado";
const raw = (process.argv[2] || process.env.NEURA_CLIENT_SCHEMA || SCHEMA_DEFAULT).trim();

if (!/^[a-z_][a-z0-9_]*$/.test(raw)) {
  console.error(
    `Nombre de schema inválido: "${raw}". Usá minúsculas, números y _ (debe empezar con letra o _).`,
  );
  process.exit(1);
}
const schema = raw;

const url =
  process.env.SUPABASE_DB_URL?.trim() ||
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim();

if (!url) {
  console.error("Falta SUPABASE_DB_URL, DIRECT_URL o DATABASE_URL en .env.local");
  process.exit(1);
}

const ddl = `
DO $$
BEGIN
  RAISE NOTICE 'Creando schema % si no existe', '${schema}';
END $$;

CREATE SCHEMA IF NOT EXISTS "${schema}" AUTHORIZATION postgres;

-- Grants de uso del schema
GRANT USAGE ON SCHEMA "${schema}" TO anon, authenticated, service_role;
GRANT ALL   ON SCHEMA "${schema}" TO postgres, service_role;

-- Grants sobre objetos existentes (idempotente)
GRANT ALL ON ALL TABLES    IN SCHEMA "${schema}" TO postgres, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA "${schema}" TO postgres, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA "${schema}" TO postgres, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA "${schema}" TO authenticated;
GRANT USAGE, SELECT, UPDATE         ON ALL SEQUENCES IN SCHEMA "${schema}" TO authenticated;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA "${schema}" TO authenticated;

GRANT SELECT ON ALL TABLES    IN SCHEMA "${schema}" TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA "${schema}" TO anon;

-- Default privileges para objetos futuros (los que creen migraciones del repo)
ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}"
  GRANT ALL ON TABLES    TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}"
  GRANT ALL ON SEQUENCES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}"
  GRANT ALL ON FUNCTIONS TO postgres, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}"
  GRANT USAGE, SELECT, UPDATE          ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}"
  GRANT EXECUTE                         ON FUNCTIONS TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}"
  GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}"
  GRANT USAGE, SELECT ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}"
  GRANT EXECUTE ON FUNCTIONS TO anon;
`;

async function main() {
  const client = new pg.Client({
    connectionString: url,
    ssl: url!.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    await client.query(ddl);
    const { rows } = await client.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
      [schema],
    );
    if (!rows.length) throw new Error(`El schema "${schema}" no aparece tras el CREATE.`);
    console.log(`OK: schema "${schema}" creado/asegurado con grants estándar.`);
    console.log("Siguiente paso sugerido:");
    console.log(`  node scripts/add-tenant-schema-to-local-config.mjs ${schema}`);
    console.log(`  # y setear NEURA_CLIENT_SCHEMA=${schema} en .env.local`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
