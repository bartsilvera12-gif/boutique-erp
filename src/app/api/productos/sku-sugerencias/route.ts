import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/productos/sku-sugerencias?tipo=<reventa|menu|materia>
 *
 * Devuelve:
 *  - sugerido: SKU autogenerado para el tipo (REV/MEN/MP) con el próximo número.
 *  - patrones: prefijos detectados en SKUs existentes + los por tipo, cada uno
 *    con su "siguiente" (próximo número), para el dropdown "Usar patrón existente".
 * Solo lectura sobre productos.sku. No toca ventas/compras.
 */

const PREFIJO_TIPO: Record<string, string> = { reventa: "REV", menu: "MEN", materia: "MP" };

function pad(n: number, width: number): string {
  return String(n).padStart(Math.max(width, 1), "0");
}

/** Separa "QA-MAY-001" → {prefix:"QA-MAY", num:1, width:3}. Si no hay número final, null. */
function parseSku(sku: string): { prefix: string; num: number; width: number } | null {
  const m = /^(.+?)[-_](\d+)$/.exec(sku.trim());
  if (!m) return null;
  return { prefix: m[1], num: parseInt(m[2], 10) || 0, width: m[2].length };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const tipo = (new URL(request.url).searchParams.get("tipo") ?? "reventa").toLowerCase();
    const prefijoTipo = PREFIJO_TIPO[tipo] ?? "REV";

    // Trae TODOS los SKU (incluyendo productos borrados con activo=false)
    // porque el UNIQUE de la DB no ignora borrados: reutilizar el SKU de
    // un borrado tira "duplicate key".
    const { data, error } = await ctx.supabase
      .from("productos")
      .select("sku")
      .eq("empresa_id", ctx.auth.empresa_id);
    if (error) throw new Error(error.message);

    // Set con todos los SKUs case-insensitive para chequear libres rápido.
    const taken = new Set<string>();
    // prefix -> { maxNum, width }
    const map = new Map<string, { maxNum: number; width: number }>();
    for (const r of (data ?? []) as Array<{ sku: string | null }>) {
      if (!r.sku) continue;
      taken.add(r.sku.trim().toUpperCase());
      const p = parseSku(r.sku);
      if (!p) continue;
      const cur = map.get(p.prefix);
      if (!cur) map.set(p.prefix, { maxNum: p.num, width: p.width });
      else map.set(p.prefix, { maxNum: Math.max(cur.maxNum, p.num), width: Math.max(cur.width, p.width) });
    }

    // Asegurar que los 3 prefijos por tipo existan en la lista (aunque no se hayan usado).
    for (const px of Object.values(PREFIJO_TIPO)) {
      if (!map.has(px)) map.set(px, { maxNum: 0, width: 4 });
    }

    /** Encuentra el próximo número libre a partir de maxNum+1 (salta huecos ocupados). */
    function proximoLibre(prefix: string, maxNum: number, width: number): string {
      const w = Math.max(width, 4);
      let n = maxNum + 1;
      // Guard contra loop infinito: 10_000 intentos es más que suficiente.
      for (let i = 0; i < 10_000; i++) {
        const candidato = `${prefix}-${pad(n, w)}`;
        if (!taken.has(candidato.toUpperCase())) return candidato;
        n++;
      }
      return `${prefix}-${pad(n, w)}`;
    }

    const patrones = [...map.entries()]
      .map(([prefix, v]) => ({
        prefix,
        siguiente: proximoLibre(prefix, v.maxNum, v.width),
      }))
      .sort((a, b) => a.prefix.localeCompare(b.prefix));

    const def = map.get(prefijoTipo) ?? { maxNum: 0, width: 4 };
    const sugerido = proximoLibre(prefijoTipo, def.maxNum, def.width);

    return NextResponse.json(successResponse({ sugerido, prefijo_tipo: prefijoTipo, patrones }));
  } catch (err) {
    console.error("[/api/productos/sku-sugerencias]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron generar sugerencias de SKU."), { status: 500 });
  }
}
