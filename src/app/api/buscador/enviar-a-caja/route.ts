import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * POST /api/buscador/enviar-a-caja
 *
 * Crea un pedido "buscador" en la tabla `proyectos` con metadata
 * `facturacion_estado = pendiente_caja`. La caja lo lee desde
 * /api/caja/pedidos-pendientes y lo factura desde /ventas/nueva?pedido_id=X.
 *
 * Asegura on-the-fly que existan los catálogos mínimos (tipo "Buscador",
 * estado "Pendiente") — el schema autorepuestosfelix arranca vacío.
 */

interface BodyItem {
  producto_id: string;
  producto_nombre: string;
  sku?: string | null;
  cantidad: number;
  precio_venta: number;
  tipo_precio?: "minorista" | "mayorista" | null;
}

interface Body {
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  cliente_telefono?: string | null;
  observacion?: string | null;
  items: BodyItem[];
}

async function ensureTipoBuscador(sb: AppSupabaseClient, empresaId: string): Promise<string> {
  const existing = await sb
    .from("proyecto_tipos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("slug", "buscador")
    .limit(1)
    .maybeSingle();
  if (existing.data) return String((existing.data as { id: string }).id);

  const ins = await sb
    .from("proyecto_tipos")
    .insert({
      empresa_id: empresaId,
      nombre: "Buscador",
      slug: "buscador",
      activo: true,
      orden: 99,
    })
    .select("id")
    .single();
  if (ins.error) throw new Error(ins.error.message);
  return String((ins.data as { id: string }).id);
}

async function ensureEstadoPendiente(sb: AppSupabaseClient, empresaId: string): Promise<string> {
  // Buscar estado inicial existente; si no hay ninguno, crear "Pendiente".
  const ex = await sb
    .from("proyecto_estados")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .order("orden", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (ex.data) return String((ex.data as { id: string }).id);

  const ins = await sb
    .from("proyecto_estados")
    .insert({
      empresa_id: empresaId,
      nombre: "Pendiente",
      color: "#f59e0b",
      orden: 1,
      es_estado_inicial: true,
      activo: true,
      tipo_sla: "abierto",
    })
    .select("id")
    .single();
  if (ins.error) throw new Error(ins.error.message);
  return String((ins.data as { id: string }).id);
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;
    const empresaId = auth.empresa_id;

    const body = (await request.json().catch(() => null)) as Body | null;
    if (!body || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(errorResponse("Agregá al menos un producto al pedido."), { status: 400 });
    }

    const items = body.items
      .filter((it) => it && it.producto_id && Number(it.cantidad) > 0)
      .map((it) => ({
        producto_id: String(it.producto_id),
        producto_nombre: String(it.producto_nombre ?? ""),
        sku: it.sku ?? null,
        cantidad: Number(it.cantidad),
        precio_venta: Math.max(0, Number(it.precio_venta) || 0),
        tipo_precio: it.tipo_precio === "mayorista" ? "mayorista" : "minorista",
      }));
    if (items.length === 0) {
      return NextResponse.json(errorResponse("Los productos no son válidos (cantidad debe ser > 0)."), { status: 400 });
    }

    const totalEstimado = items.reduce((s, it) => s + it.cantidad * it.precio_venta, 0);
    const clienteNombre = (body.cliente_nombre ?? "").trim() || null;
    const titulo =
      clienteNombre
        ? `Pedido ${clienteNombre}`
        : `Pedido (${items.length} producto${items.length === 1 ? "" : "s"})`;

    const tipoId = await ensureTipoBuscador(sb, empresaId);
    const estadoId = await ensureEstadoPendiente(sb, empresaId);
    const now = new Date().toISOString();

    const ins = await sb
      .from("proyectos")
      .insert({
        empresa_id: empresaId,
        titulo,
        tipo_id: tipoId,
        estado_id: estadoId,
        prioridad: "normal",
        cliente_id: body.cliente_id || null,
        archivado: false,
        fecha_ingreso: now,
        monto_vendido: totalEstimado,
        brief_data: {
          cliente_nombre: clienteNombre,
          cliente_telefono: (body.cliente_telefono ?? "").trim() || null,
          observacion: (body.observacion ?? "").trim() || null,
          items,
        },
        metadata: {
          source: "buscador",
          facturacion_estado: "pendiente_caja",
          enviado_a_caja_at: now,
          armado_por_email: auth.user?.email ?? null,
          armado_por_id: auth.usuarioCatalogId ?? null,
        },
        last_activity_at: now,
        ultimo_movimiento_at: now,
        created_by: auth.usuarioCatalogId ?? null,
      })
      .select("id, titulo")
      .single();
    if (ins.error) throw new Error(ins.error.message);

    return NextResponse.json(
      successResponse({
        id: (ins.data as { id: string }).id,
        titulo: (ins.data as { titulo: string }).titulo,
        total_estimado: totalEstimado,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo enviar el pedido a caja.";
    console.error("[/api/buscador/enviar-a-caja]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
