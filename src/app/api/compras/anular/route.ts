import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * POST /api/compras/anular
 *
 * Anula una compra completa (todas las filas con el mismo numero_control,
 * porque compras es un modelo multi-row plano: 1 fila = 1 producto).
 *
 *  1) UPDATE compras.estado='anulada' + auditoría en todas las filas del
 *     numero_control.
 *  2) Por cada item (que controle stock): UPDATE productos.stock_actual -= qty
 *     + INSERT movimiento SALIDA (origen='ajuste_manual', referencia=ANUL-COMP-X).
 *  3) Si la compra tiene pagos en compras_pagos → BLOQUEA con 409. El cliente
 *     debe primero anular/eliminar los pagos manualmente (no automatizamos
 *     porque podría afectar el arqueo de caja del momento del pago).
 *
 * Body: { numero_control: string, motivo: string }
 *
 * Si el stock queda negativo (caso: parte de la mercadería ya se vendió y se
 * anula la compra), se permite igual con un warning. Es decisión del usuario.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;
    const empresaId = auth.empresa_id;

    const body = (await request.json().catch(() => ({}))) as { numero_control?: unknown; motivo?: unknown };
    const numeroControl = typeof body.numero_control === "string" ? body.numero_control.trim() : "";
    const motivo = typeof body.motivo === "string" ? body.motivo.trim().slice(0, 500) : "";
    if (!numeroControl) {
      return NextResponse.json(errorResponse("Falta el número de control de la compra."), { status: 400 });
    }
    if (motivo.length < 3) {
      return NextResponse.json(errorResponse("El motivo de anulación es obligatorio (mínimo 3 caracteres)."), { status: 400 });
    }

    // 1) Cargar TODAS las filas de la compra
    const cQ = await sb
      .from("compras")
      .select("id, producto_id, producto_nombre, cantidad, costo_unitario, estado")
      .eq("empresa_id", empresaId)
      .eq("numero_control", numeroControl);
    if (cQ.error) throw new Error(cQ.error.message);
    const filas = (cQ.data ?? []) as Array<{
      id: string; producto_id: string; producto_nombre: string | null;
      cantidad: number | string; costo_unitario: number | string | null; estado: string;
    }>;
    if (filas.length === 0) {
      return NextResponse.json(errorResponse("Compra no encontrada."), { status: 404 });
    }
    if (filas.every((f) => f.estado === "anulada")) {
      return NextResponse.json(errorResponse("La compra ya está anulada."), { status: 409 });
    }

    // 2) Validar que NO tenga pagos registrados (CxP)
    const pQ = await sb
      .from("compras_pagos")
      .select("id, monto", { count: "exact" })
      .eq("empresa_id", empresaId)
      .eq("numero_control", numeroControl);
    if (pQ.error) throw new Error(pQ.error.message);
    const pagos = (pQ.data ?? []) as Array<{ id: string; monto: number | string }>;
    if (pagos.length > 0) {
      const totalPagado = pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0);
      return NextResponse.json(errorResponse(
        `La compra tiene ${pagos.length} pago(s) registrado(s) por un total de Gs. ${Math.round(totalPagado).toLocaleString("es-PY")}. ` +
        `Eliminá primero los pagos desde "Pagos a proveedores" antes de anular.`
      ), { status: 409 });
    }

    const ahora = new Date().toISOString();

    // 3) Marcar TODAS las filas como anuladas PRIMERO (idempotente)
    const updC = await sb
      .from("compras")
      .update({
        estado: "anulada",
        anulada_at: ahora,
        anulada_por_id: auth.usuarioCatalogId ?? null,
        motivo_anulacion: motivo,
      })
      .eq("empresa_id", empresaId)
      .eq("numero_control", numeroControl)
      .neq("estado", "anulada");
    if (updC.error) throw new Error(updC.error.message);

    // 4) Reversar stock por cada producto (best-effort)
    const warnings: string[] = [];
    for (const f of filas) {
      const qty = Number(f.cantidad) || 0;
      if (qty <= 0) continue;
      try {
        const pgQ = await sb
          .from("productos")
          .select("stock_actual, controla_stock, sku")
          .eq("empresa_id", empresaId)
          .eq("id", f.producto_id)
          .maybeSingle();
        if (pgQ.error || !pgQ.data) continue;
        const prod = pgQ.data as { stock_actual: number | string; controla_stock: boolean; sku: string | null };
        if (prod.controla_stock !== true) continue;

        const stockAct = Number(prod.stock_actual) || 0;
        const stockNew = stockAct - qty;
        if (stockNew < 0) {
          warnings.push(`${prod.sku ?? f.producto_id}: stock queda negativo (${stockNew}). Posiblemente ya se vendió parte.`);
        }
        const upStock = await sb
          .from("productos")
          .update({ stock_actual: stockNew })
          .eq("empresa_id", empresaId)
          .eq("id", f.producto_id);
        if (upStock.error) {
          warnings.push(`stock ${prod.sku ?? f.producto_id}: ${upStock.error.message}`);
          continue;
        }

        const insMov = await sb.from("movimientos_inventario").insert({
          empresa_id: empresaId,
          producto_id: f.producto_id,
          producto_nombre: f.producto_nombre ?? "",
          producto_sku: prod.sku ?? "",
          tipo: "SALIDA",
          cantidad: qty,
          costo_unitario: Number(f.costo_unitario) || 0,
          origen: "ajuste_manual",
          referencia: `ANUL-${numeroControl}`,
          fecha: ahora,
          created_by: auth.usuarioCatalogId ?? null,
          usuario_nombre: auth.user?.email ?? null,
        });
        if (insMov.error) warnings.push(`mov ${prod.sku ?? f.producto_id}: ${insMov.error.message}`);
      } catch (e) {
        warnings.push(`item ${f.producto_id}: ${e instanceof Error ? e.message : "error"}`);
      }
    }

    return NextResponse.json(successResponse({
      anulada: true,
      numero_control: numeroControl,
      filas_anuladas: filas.length,
      warnings: warnings.length > 0 ? warnings : null,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo anular la compra.";
    console.error("[/api/compras/anular]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
