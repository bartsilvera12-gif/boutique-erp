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

    query = query.order("nombre").limit(limit);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

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

    // Firmar URLs solo para los primeros 20 visibles (optimización).
    const SIGN_TOP = 20;
    const signedUrls: (string | null)[] = await Promise.all(
      rows.slice(0, SIGN_TOP).map(async (r) =>
        r.imagen_path ? await signProductoImagen(supabase, r.imagen_path, 3600) : null
      )
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
    }));

    return NextResponse.json(successResponse({ items: hits, count: hits.length, q, vehiculo: vehiculoRaw || null }));
  } catch (err) {
    console.error("[/api/productos/search]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo realizar la búsqueda. Intentá nuevamente."),
      { status: 500 }
    );
  }
}
