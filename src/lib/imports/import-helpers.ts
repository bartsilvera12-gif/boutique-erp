/**
 * Helpers compartidos para los importadores Excel.
 * - leerArchivoYAuth: extrae file + auth + schema + checkbox crear_faltantes.
 * - lookupLowerMap: construye un Map(lower(trim(nombre)) -> id) para resolucion por nombre.
 * - chunked: parte un array en chunks de N.
 */
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getAuthWithRol, isAdmin } from "@/lib/middleware/auth";
import { parseUploadFile } from "@/lib/excel/import";

export interface AuthCtx {
  empresaId: string;
  schema: string;
  usuarioCatalogId: string | null;
  usuarioNombre: string | null;
  filename: string;
  rows: Record<string, string>[];
  crearFaltantes: boolean;
}

/** Lee form-data, valida auth + admin, parsea xlsx/csv. */
export async function leerArchivoYAuth(request: Request): Promise<
  | { ok: true; ctx: AuthCtx }
  | { ok: false; status: number; error: string }
> {
  const auth = await getAuthWithRol(request);
  if (!auth) return { ok: false, status: 401, error: "No autenticado." };
  if (!isAdmin(auth)) return { ok: false, status: 403, error: "Solo administradores pueden importar." };

  const tenant = await getTenantSupabaseFromAuth(request);
  if (!tenant) return { ok: false, status: 401, error: "No autenticado." };
  const empresaId = tenant.auth.empresa_id;
  const schema = await fetchDataSchemaForEmpresaId(empresaId);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, status: 400, error: "Form-data inválido." };
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return { ok: false, status: 400, error: "Falta el archivo." };
  }
  const parsed = await parseUploadFile(file);
  if ("error" in parsed) return { ok: false, status: 400, error: parsed.error };

  const crearFaltantes = String(form.get("crear_faltantes") ?? "") === "1";

  return {
    ok: true,
    ctx: {
      empresaId,
      schema,
      usuarioCatalogId: tenant.auth.usuarioCatalogId ?? null,
      usuarioNombre: tenant.auth.user?.email ?? null,
      filename: file.name,
      rows: parsed.rows,
      crearFaltantes,
    },
  };
}

export function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Normaliza una clave para matching case/accent-insensitive y sin espacios extra.
 * "Código"      → "CODIGO"
 * "P. Costo"    → "PCOSTO"
 * "stock_actual"→ "STOCKACTUAL"
 */
function normKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Cache de la row normalizada: para no recomputar normKey por cada pick(),
 * memoizamos en la propia row (Symbol-key). Acepta header con tildes,
 * espacios y mayúsculas mixtas.
 */
const NORM_CACHE = new WeakMap<object, Map<string, string>>();
function normalizedRow(row: Record<string, string>): Map<string, string> {
  let m = NORM_CACHE.get(row);
  if (m) return m;
  m = new Map();
  for (const k of Object.keys(row)) {
    const nk = normKey(k);
    if (!m.has(nk)) m.set(nk, row[k]);
  }
  NORM_CACHE.set(row, m);
  return m;
}

export function pick(row: Record<string, string>, ...keys: string[]): string {
  const m = normalizedRow(row);
  for (const k of keys) {
    const v = m.get(normKey(k));
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export function pickNumber(row: Record<string, string>, ...keys: string[]): number {
  const raw = pick(row, ...keys);
  if (!raw) return 0;
  // Limpiar símbolos de moneda y separador de miles. Acepta "₲22.500", "Gs. 22.500", "22500", "22,500.50".
  const cleaned = String(raw).replace(/[₲$€]|Gs\.?/gi, "").trim().replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function pickBool(row: Record<string, string>, ...keys: string[]): boolean {
  const raw = pick(row, ...keys).toLowerCase();
  if (!raw) return true; // default activo=true
  return ["si", "sí", "true", "1", "yes", "y", "activo"].includes(raw);
}
