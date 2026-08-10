import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { signProductoImagen } from "@/lib/inventario/imagen-storage";

interface ProductoSearchHit {
  id: string;
  nombre: string;
  sku: string;
  codigo_barras: string | null;
  codigo_barras_interno: boolean;
  precio_venta: number;
  precio_mayorista: number;
  precio_distribuidor: number | null;
  costo_promedio: number;
  stock_actual: number;
  stock_minimo: number;
  unidad_medida: string;
  metodo_valuacion: string;
  imagen_path: string | null;
  imagen_url: string | null;
  categoria_nombre: string | null;
  proveedor_nombre: string | null;
  ubicacion_nombre: string | null;
  ubicacion_tipo: string | null;
  es_vendible: boolean;
  controla_stock: boolean;
  modo_receta: string;
  // Autopartes
  codigo_oem: string | null;
  codigo_alternativo: string | null;
  marca_repuesto: string | null;
  /** Unidades vendidas en los últimos 90 días. 0 si no hubo ventas o si la
   *  request tenía un query/filtro (en ese caso ordenamos por nombre, no por
   *  ventas). Sirve al cliente para badges tipo "🔥 Top". */
  ventas_90d: number;
}

const DEFAULT_LIMIT = 30;
// Subido a 500: con catálogos grandes (autopartes ~6000 productos), un cap de 100
// hace que el picker de venta parezca "cortado" cuando el usuario abre el modal
// sin tipear. El frontend usa límites altos cuando renderiza una lista
// navegable; el búsqueda-as-you-type sigue siendo el camino feliz para >500.
const MAX_LIMIT = 500;

/** Escape pattern para ILIKE evitando interpretación de % y _ del usuario. */
function escapeIlikePattern(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * GET /api/productos/search?q=...&limit=30
 *
 * Búsqueda case-insensitive en nombre/sku/codigo_barras vía PostgREST
 * (compatible Hostinger sin pool PG). Filtra a vendibles únicamente.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    const url = new URL(request.url);
    const qRaw = (url.searchParams.get("q") ?? "").trim();
    const q = qRaw.slice(0, 100);
    const limitParam = parseInt(url.searchParams.get("limit") ?? "", 10);
    const limit = Math.max(
      1,
      Math.min(MAX_LIMIT, Number.isFinite(limitParam) ? limitParam : DEFAULT_LIMIT)
    );

    let query = supabase
      .from("productos")
      .select(
        "id, nombre, sku, codigo_barras, codigo_barras_interno, " +
          "precio_venta, precio_mayorista, precio_distribuidor, costo_promedio, stock_actual, stock_minimo, " +
          "unidad_medida, metodo_valuacion, imagen_path, imagen_url, " +
          "categoria_principal_id, proveedor_principal_id, ubicacion_principal_id, " +
          "es_vendible, controla_stock, modo_receta, activo, " +
          // Autopartes (Fase 1)
          "codigo_oem, codigo_alternativo, marca_repuesto"
      )
      .eq("empresa_id", empresaId)
      .eq("activo", true)
      .eq("es_vendible", true);

    // Si vino ?vehiculo=<texto> filtramos por compatibilidad — el texto se matchea
    // contra marca_vehiculo o modelo_vehiculo de producto_compatibilidad_vehiculo.
    // Resolución previa para construir el IN (...).
    const vehiculoRaw = (url.searchParams.get("vehiculo") ?? "").trim();
    if (vehiculoRaw.length > 0) {
      const vPat = `%${escapeIlikePattern(vehiculoRaw)}%`;
      const compat = await supabase
        .from("producto_compatibilidad_vehiculo")
        .select("producto_id")
        .eq("empresa_id", empresaId)
        .or(`marca_vehiculo.ilike.${vPat},modelo_vehiculo.ilike.${vPat}`);
      if (compat.error) throw new Error(compat.error.message);
      const ids = Array.from(new Set((compat.data ?? []).map((r) => String((r as { producto_id: string }).producto_id))));
      if (ids.length === 0) {
        // Sin matches → corto temprano con resultados vacíos.
        return NextResponse.json(successResponse({ items: [], count: 0, q, vehiculo: vehiculoRaw }));
      }
      query = query.in("id", ids);
    }

    if (q.length > 0) {
      const pat = `%${escapeIlikePattern(q)}%`;
      // Búsqueda case-insensitive en nombre, sku, codigo_barras + autopartes (oem/alt/marca).
      query = query.or(
        `nombre.ilike.${pat},sku.ilike.${pat},codigo_barras.ilike.${pat},` +
          `codigo_oem.ilike.${pat},codigo_alternativo.ilike.${pat},marca_repuesto.ilike.${pat}`
      );
    }

    // ── Ranking por más vendidos (últimos 90 días) ─────────────────────────
    // Solo cuando NO hay búsqueda ni filtro por vehículo (modo "browse"). Si
    // el usuario tipea, ordenamos por nombre para que el match sea predecible.
    // Mismo patrón que el reporte de rotación: agregamos cantidades del
    // movimientos_inventario con tipo=SALIDA, origen=venta.
    let ventasPorProducto: Map<string, number> | null = null;
    let topIds: string[] = [];
    if (q.length === 0 && vehiculoRaw.length === 0) {
      const corte = new Date(Date.now() - 90 * 86400000).toISOString();
      const movQ = await supabase
        .from("movimientos_inventario")
        .select("producto_id, cantidad")
        .eq("empresa_id", empresaId)
        .eq("tipo", "SALIDA")
        .eq("origen", "venta")
        .gte("fecha", corte)
        .range(0, 49_999);
      if (!movQ.error) {
        ventasPorProducto = new Map();
        for (const r of ((movQ.data ?? []) as Array<{ producto_id: string; cantidad: number }>)) {
          const k = String(r.producto_id);
          ventasPorProducto.set(k, (ventasPorProducto.get(k) ?? 0) + (Number(r.cantidad) || 0));
        }
        // IDs de top sellers ordenados desc. Limitado a `limit` para no
        // pasarnos del tamaño visible del modal.
        topIds = Array.from(ventasPorProducto.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([id]) => id);
      }
    }

    // Si hay top sellers, los traemos PRIMERO (sin importar su posición
    // alfabética) y completamos con el listado alfabético hasta `limit`.
    type ProdRow = Record<string, unknown>;
    let rowsAccum: ProdRow[] = [];

    if (topIds.length > 0) {
      const topQ = await supabase
        .from("productos")
        .select(
          "id, nombre, sku, codigo_barras, codigo_barras_interno, " +
            "precio_venta, precio_mayorista, precio_distribuidor, costo_promedio, stock_actual, stock_minimo, " +
            "unidad_medida, metodo_valuacion, imagen_path, imagen_url, " +
            "categoria_principal_id, proveedor_principal_id, ubicacion_principal_id, " +
            "es_vendible, controla_stock, modo_receta, activo, " +
            "codigo_oem, codigo_alternativo, marca_repuesto"
        )
        .eq("empresa_id", empresaId)
        .eq("activo", true)
        .eq("es_vendible", true)
        .in("id", topIds);
      if (topQ.error) throw new Error(topQ.error.message);
      // Reordenar según topIds (que ya vienen ordenados por cantidad vendida).
      const byId = new Map<string, ProdRow>();
      for (const r of (topQ.data ?? []) as unknown as ProdRow[]) byId.set(String(r.id), r);
      rowsAccum = topIds.map((id) => byId.get(id)).filter(Boolean) as ProdRow[];
    }

    // Completar con productos alfabéticos hasta llegar a `limit`, excluyendo
    // los que ya tenemos (para no duplicar).
    const remaining = limit - rowsAccum.length;
    if (remaining > 0) {
      let fillQuery = query.order("nombre").limit(remaining);
      if (rowsAccum.length > 0) {
        const excludeIds = rowsAccum.map((r) => String(r.id));
        // not.in.(uuid1,uuid2,...) — escape de comas no necesario para UUIDs.
        fillQuery = fillQuery.not("id", "in", `(${excludeIds.join(",")})`);
      }
      const fillRes = await fillQuery;
      if (fillRes.error) throw new Error(fillRes.error.message);
      rowsAccum = rowsAccum.concat((fillRes.data ?? []) as unknown as ProdRow[]);
    }

    const data = rowsAccum;

    type Row = Record<string, unknown>;
    const rows = ((data ?? []) as unknown as Row[]).map((r) => ({
      id: String(r.id),
      nombre: String(r.nombre ?? ""),
      sku: String(r.sku ?? ""),
      codigo_barras: (r.codigo_barras as string | null) ?? null,
      codigo_barras_interno: r.codigo_barras_interno === true,
      precio_venta: Number(r.precio_venta ?? 0),
      precio_mayorista: Number(r.precio_mayorista ?? 0),
      precio_distribuidor: r.precio_distribuidor != null ? Number(r.precio_distribuidor) : null,
      costo_promedio: Number(r.costo_promedio ?? 0),
      stock_actual: Number(r.stock_actual ?? 0),
      stock_minimo: Number(r.stock_minimo ?? 0),
      unidad_medida: String(r.unidad_medida ?? "UNIDAD"),
      metodo_valuacion: String(r.metodo_valuacion ?? "CPP"),
      imagen_path: (r.imagen_path as string | null) ?? null,
      imagen_url: (r.imagen_url as string | null) ?? null,
      es_vendible: r.es_vendible !== false,
      controla_stock: r.controla_stock !== false,
      modo_receta: typeof r.modo_receta === "string" ? r.modo_receta : "preparado_al_vender",
      codigo_oem: (r.codigo_oem as string | null) ?? null,
      codigo_alternativo: (r.codigo_alternativo as string | null) ?? null,
      marca_repuesto: (r.marca_repuesto as string | null) ?? null,
    }));

    // Firmar URLs solo para los primeros 20 visibles (optimización). Si la
    // firma falla (bucket privado sin permiso, RLS, etc.) NO rompemos toda
    // la búsqueda — la miniatura simplemente queda vacía y el usuario ve
    // el placeholder.
    const SIGN_TOP = 20;
    const signedUrls: (string | null)[] = await Promise.all(
      rows.slice(0, SIGN_TOP).map(async (r) => {
        if (!r.imagen_path) return null;
        try {
          return await signProductoImagen(supabase, r.imagen_path, 3600);
        } catch {
          return null;
        }
      })
    );

    const hits: ProductoSearchHit[] = rows.map((r, i) => ({
      id: r.id,
      nombre: r.nombre,
      sku: r.sku,
      codigo_barras: r.codigo_barras,
      codigo_barras_interno: r.codigo_barras_interno,
      precio_venta: r.precio_venta,
      precio_mayorista: r.precio_mayorista,
      precio_distribuidor: r.precio_distribuidor,
      costo_promedio: r.costo_promedio,
      stock_actual: r.stock_actual,
      stock_minimo: r.stock_minimo,
      unidad_medida: r.unidad_medida,
      metodo_valuacion: r.metodo_valuacion,
      imagen_path: r.imagen_path,
      imagen_url: (i < SIGN_TOP ? signedUrls[i] : null) ?? r.imagen_url ?? null,
      categoria_nombre: null,
      proveedor_nombre: null,
      ubicacion_nombre: null,
      ubicacion_tipo: null,
      es_vendible: r.es_vendible,
      controla_stock: r.controla_stock,
      modo_receta: r.modo_receta,
      codigo_oem: r.codigo_oem,
      codigo_alternativo: r.codigo_alternativo,
      marca_repuesto: r.marca_repuesto,
      ventas_90d: ventasPorProducto?.get(r.id) ?? 0,
    }));

    return NextResponse.json(successResponse({ items: hits, count: hits.length, q, vehiculo: vehiculoRaw || null }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/productos/search]", msg);
    return NextResponse.json(
      errorResponse(`No se pudo realizar la búsqueda: ${msg}`),
      { status: 500 }
    );
  }
}
