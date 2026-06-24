import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/inventario/movimientos — lista movimientos via PostgREST (compat Hostinger sin pool PG).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    // PostgREST self-host aplica db-max-rows (~1000) que clampa cualquier
    // .range() grande. Paginamos en chunks de 1000 hasta agotar (mismo
    // patrón que en /api/productos). La paginación final visible al
    // usuario se hace client-side en la página de Movimientos.
    const CHUNK = 1000;
    const MAX_ROWS = 50000;
    const SELECT_COLS =
      "id, empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad, " +
      "costo_unitario, origen, referencia, fecha, created_at, updated_at, " +
      "created_by, usuario_nombre";
    const all: unknown[] = [];
    for (let offset = 0; offset < MAX_ROWS; offset += CHUNK) {
      const { data, error } = await ctx.supabase
        .from("movimientos_inventario")
        .select(SELECT_COLS)
        .eq("empresa_id", empresaId)
        .order("fecha", { ascending: false })
        .range(offset, offset + CHUNK - 1);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as unknown[];
      all.push(...batch);
      if (batch.length < CHUNK) break;
    }

    return NextResponse.json(successResponse({ movimientos: all }));
  } catch (err) {
    console.error("[/api/inventario/movimientos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los movimientos."), { status: 500 });
  }
}
