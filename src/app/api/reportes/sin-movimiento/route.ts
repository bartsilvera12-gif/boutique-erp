import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Reporte "Productos sin movimiento" (stock muerto).
 *
 * GET /api/reportes/sin-movimiento?dias=90
 *
 * Devuelve la lista de productos activos con stock > 0 que NO tuvieron
 * salidas (movimientos_inventario.tipo='SALIDA') en los últimos N días.
 * Crítico en autopartes: identifica capital inmovilizado en estantería.
 *
 * Para cada producto se incluye:
 *  - stock_actual, costo_promedio, valor_inmovilizado (stock × costo)
 *  - dias_sin_movimiento (días desde la última salida, o null si nunca)
 *  - ultima_salida_fecha (ISO o null)
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    const url = new URL(request.url);
    const diasRaw = parseInt(url.searchParams.get("dias") ?? "90", 10);
    const dias = Number.isFinite(diasRaw) && diasRaw > 0 && diasRaw <= 3650 ? diasRaw : 90;

    const corte = new Date(Date.now() - dias * 86400000).toISOString();

    // 1) Productos candidatos: activos, con stock real y que se valoricen.
    const prodQ = await supabase
      .from("productos")
      .select(
        "id, nombre, sku, marca_repuesto, codigo_oem, stock_actual, costo_promedio, " +
        "categoria_principal_id, proveedor_principal_id"
      )
      .eq("empresa_id", empresaId)
      .eq("activo", true)
      .eq("controla_stock", true)
      .gt("stock_actual", 0);
    if (prodQ.error) throw new Error(prodQ.error.message);
    const productos = ((prodQ.data ?? []) as unknown) as Array<{
      id: string; nombre: string; sku: string;
      marca_repuesto: string | null; codigo_oem: string | null;
      stock_actual: number; costo_promedio: number;
      categoria_principal_id: string | null; proveedor_principal_id: string | null;
    }>;
    if (productos.length === 0) {
      return NextResponse.json(successResponse({ items: [], dias, corte, count: 0 }));
    }
    const ids = productos.map((p) => p.id);

    // 2) Productos con salida en los últimos N días → exclusión.
    const movQ = await supabase
      .from("movimientos_inventario")
      .select("producto_id")
      .eq("empresa_id", empresaId)
      .eq("tipo", "SALIDA")
      .gte("fecha", corte)
      .in("producto_id", ids);
    if (movQ.error) throw new Error(movQ.error.message);
    const conMov = new Set((movQ.data ?? []).map((r) => String((r as { producto_id: string }).producto_id)));
    const sinMovIds = ids.filter((id) => !conMov.has(id));

    // 3) Última salida (cualquier fecha) para cada producto sin movimiento reciente.
    const ultimaSalida = new Map<string, string>();
    if (sinMovIds.length > 0) {
      const ultQ = await supabase
        .from("movimientos_inventario")
        .select("producto_id, fecha")
        .eq("empresa_id", empresaId)
        .eq("tipo", "SALIDA")
        .in("producto_id", sinMovIds)
        .order("fecha", { ascending: false });
      if (ultQ.error) throw new Error(ultQ.error.message);
      for (const r of (ultQ.data ?? []) as Array<{ producto_id: string; fecha: string }>) {
        if (!ultimaSalida.has(r.producto_id)) ultimaSalida.set(r.producto_id, r.fecha);
      }
    }

    const ahora = Date.now();
    const items = productos
      .filter((p) => !conMov.has(p.id))
      .map((p) => {
        const stock = Number(p.stock_actual) || 0;
        const costo = Number(p.costo_promedio) || 0;
        const valor = stock * costo;
        const ult = ultimaSalida.get(p.id) ?? null;
        const diasSin = ult ? Math.floor((ahora - new Date(ult).getTime()) / 86400000) : null;
        return {
          id: p.id,
          nombre: p.nombre,
          sku: p.sku,
          marca_repuesto: p.marca_repuesto,
          codigo_oem: p.codigo_oem,
          stock_actual: stock,
          costo_promedio: costo,
          valor_inmovilizado: valor,
          ultima_salida_fecha: ult,
          dias_sin_movimiento: diasSin, // null si nunca tuvo salida
        };
      })
      // Más capital inmovilizado primero.
      .sort((a, b) => b.valor_inmovilizado - a.valor_inmovilizado);

    const valorTotal = items.reduce((s, x) => s + x.valor_inmovilizado, 0);
    return NextResponse.json(
      successResponse({ items, count: items.length, dias, corte, valor_total_inmovilizado: valorTotal })
    );
  } catch (err) {
    console.error("[/api/reportes/sin-movimiento]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el reporte."), { status: 500 });
  }
}
