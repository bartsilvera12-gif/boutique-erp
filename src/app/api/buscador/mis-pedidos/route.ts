import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { asMetadataObject, getFacturacionEstado } from "@/lib/caja/facturacion";

/**
 * GET /api/buscador/mis-pedidos
 *
 * Pedidos creados por el usuario actual desde el módulo Buscador. Muestra
 * estado (pendiente_caja / facturado), total y nº de items para que el
 * vendedor pueda hacer seguimiento de lo que mandó a cobrar.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;
    const empresaId = auth.empresa_id;
    const usuarioId = auth.usuarioCatalogId ?? null;

    let q = sb
      .from("proyectos")
      .select("id, titulo, monto_vendido, created_at, brief_data, metadata")
      .eq("empresa_id", empresaId)
      .eq("archivado", false)
      .eq("metadata->>source", "buscador")
      .order("created_at", { ascending: false })
      .limit(50);

    // Filtrar a "los míos": el vendedor solo ve los que armó él. Admin sin
    // usuarioCatalogId podría ver todos los del buscador (sin filtro).
    if (usuarioId) {
      q = q.eq("created_by", usuarioId);
    }

    const { data, error } = await q;
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const pedidos = ((data ?? []) as Record<string, unknown>[]).map((p) => {
      const brief = asMetadataObject(p.brief_data);
      const meta = asMetadataObject(p.metadata);
      const itemsRaw = Array.isArray(brief.items) ? (brief.items as Record<string, unknown>[]) : [];
      const estado = getFacturacionEstado(meta);
      return {
        id: String(p.id),
        titulo: typeof p.titulo === "string" ? p.titulo : "",
        cliente_nombre: typeof brief.cliente_nombre === "string" ? brief.cliente_nombre : null,
        total_estimado: Number(p.monto_vendido) || 0,
        items_count: itemsRaw.length,
        items: itemsRaw.map((it) => ({
          producto_nombre: typeof it.producto_nombre === "string" ? it.producto_nombre : "—",
          cantidad: Number(it.cantidad) || 0,
        })),
        estado_facturacion: estado ?? "pendiente_caja",
        venta_numero: typeof meta.venta_numero === "string" ? meta.venta_numero : null,
        created_at: typeof p.created_at === "string" ? p.created_at : null,
        enviado_a_caja_at: typeof meta.enviado_a_caja_at === "string" ? meta.enviado_a_caja_at : null,
        facturado_at: typeof meta.facturado_at === "string" ? meta.facturado_at : null,
      };
    });

    return NextResponse.json(successResponse({ pedidos }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudieron cargar tus pedidos.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
