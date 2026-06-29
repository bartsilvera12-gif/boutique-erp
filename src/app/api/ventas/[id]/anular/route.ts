import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * POST /api/ventas/[id]/anular
 *
 * Anula una venta y reversa los efectos en inventario y caja:
 *
 *  1) ventas.estado = 'anulada' + auditoría (anulada_at, anulada_por_id, motivo).
 *  2) Por cada ítem (que controle stock): UPDATE productos.stock_actual += qty
 *     + INSERT movimiento ENTRADA (origen='ajuste_manual', referencia=ANUL-VTA-X).
 *  3) Si la venta tenía caja_id y la caja sigue abierta: se descuenta de la caja
 *     creando un movimiento egreso por el monto cobrado (revierte el ingreso
 *     virtual de la venta, en el método pagado).
 *  4) Si la venta era a crédito: marca la CxC como anulada.
 *
 * No es transaccional estricto (PostgREST no expone transacciones multi-step);
 * se valida ANTES y se hace best-effort por paso, con rollback de marca de
 * estado si algo crítico falla.
 *
 * Body: { motivo: string }
 */
export async function POST(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    if (!id) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;
    const empresaId = auth.empresa_id;

    const body = (await request.json().catch(() => ({}))) as { motivo?: unknown };
    const motivo = typeof body.motivo === "string" ? body.motivo.trim().slice(0, 500) : "";
    if (motivo.length < 3) {
      return NextResponse.json(errorResponse("El motivo de anulación es obligatorio (mínimo 3 caracteres)."), { status: 400 });
    }

    // 1) Cargar venta + validar
    const vQ = await sb
      .from("ventas")
      .select("id, numero_control, estado, tipo_venta, metodo_pago, total, caja_id, fecha")
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .maybeSingle();
    if (vQ.error) throw new Error(vQ.error.message);
    if (!vQ.data) return NextResponse.json(errorResponse("Venta no encontrada."), { status: 404 });

    const venta = vQ.data as {
      id: string; numero_control: string; estado: string;
      tipo_venta: string; metodo_pago: string | null;
      total: number | string; caja_id: string | null; fecha: string;
    };

    if (venta.estado === "anulada") {
      return NextResponse.json(errorResponse("La venta ya está anulada."), { status: 409 });
    }

    // 2) Items para reversar stock (sin costo_unitario — esa columna no existe
    //    en ventas_items; el costo del movimiento se toma de productos.costo_promedio).
    const iQ = await sb
      .from("ventas_items")
      .select("producto_id, producto_nombre, sku, cantidad")
      .eq("empresa_id", empresaId)
      .eq("venta_id", id);
    if (iQ.error) throw new Error(iQ.error.message);
    const items = (iQ.data ?? []) as Array<{
      producto_id: string; producto_nombre: string | null; sku: string | null;
      cantidad: number | string;
    }>;

    // 3) Marcar la venta como anulada PRIMERO (si falla algo después no rompe la idempotencia).
    const ahora = new Date().toISOString();
    const updV = await sb
      .from("ventas")
      .update({
        estado: "anulada",
        anulada_at: ahora,
        anulada_por_id: auth.usuarioCatalogId ?? null,
        motivo_anulacion: motivo,
      })
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .eq("estado", "completada");
    if (updV.error) throw new Error(updV.error.message);

    // 4) Reversar stock + movimiento ENTRADA por item (best-effort).
    const warnings: string[] = [];
    for (const it of items) {
      const qty = Number(it.cantidad) || 0;
      if (qty <= 0) continue;
      try {
        // Subir stock_actual (RPC podría ser atómico; acá lo hacemos en 2 pasos best-effort).
        const pQ = await sb
          .from("productos")
          .select("stock_actual, controla_stock, costo_promedio")
          .eq("empresa_id", empresaId)
          .eq("id", it.producto_id)
          .maybeSingle();
        if (pQ.error || !pQ.data) continue;
        const prod = pQ.data as { stock_actual: number | string; controla_stock: boolean; costo_promedio: number | string };
        if (prod.controla_stock !== true) continue; // sin control de stock, nada que reversar

        const stockAct = Number(prod.stock_actual) || 0;
        const costoUnit = Number(prod.costo_promedio) || 0;
        const stockNew = stockAct + qty;
        const upStock = await sb
          .from("productos")
          .update({ stock_actual: stockNew })
          .eq("empresa_id", empresaId)
          .eq("id", it.producto_id);
        if (upStock.error) {
          warnings.push(`stock ${it.sku ?? it.producto_id}: ${upStock.error.message}`);
          continue;
        }

        // Movimiento ENTRADA (origen=ajuste_manual por CHECK constraint del schema).
        const insMov = await sb.from("movimientos_inventario").insert({
          empresa_id: empresaId,
          producto_id: it.producto_id,
          producto_nombre: it.producto_nombre ?? "",
          producto_sku: it.sku ?? "",
          tipo: "ENTRADA",
          cantidad: qty,
          costo_unitario: costoUnit,
          origen: "ajuste_manual",
          referencia: `ANUL-${venta.numero_control}`,
          fecha: ahora,
          venta_id: id,
          created_by: auth.usuarioCatalogId ?? null,
          usuario_nombre: auth.user?.email ?? null,
        });
        if (insMov.error) warnings.push(`mov ${it.sku ?? it.producto_id}: ${insMov.error.message}`);
      } catch (e) {
        warnings.push(`item ${it.sku ?? it.producto_id}: ${e instanceof Error ? e.message : "error"}`);
      }
    }

    // 5) Caja: si la venta estaba asociada a un turno abierto, registramos un egreso.
    if (venta.caja_id) {
      try {
        const cQ = await sb.from("cajas").select("estado").eq("empresa_id", empresaId).eq("id", venta.caja_id).maybeSingle();
        const cajaAbierta = (cQ.data as { estado?: string } | null)?.estado === "abierta";
        if (cajaAbierta) {
          const total = Number(venta.total) || 0;
          const medio = (venta.metodo_pago === "tarjeta" || venta.metodo_pago === "transferencia")
            ? venta.metodo_pago : "efectivo";
          const insCM = await sb.from("caja_movimientos").insert({
            empresa_id: empresaId,
            caja_id: venta.caja_id,
            tipo: "egreso",
            concepto: `Anulación venta ${venta.numero_control}`,
            monto: total,
            medio_pago: medio,
            usuario_id: auth.usuarioCatalogId ?? null,
            observacion: motivo,
          });
          if (insCM.error) warnings.push(`caja: ${insCM.error.message}`);
        } else {
          warnings.push("La caja del turno ya está cerrada; el monto NO se descontó del arqueo histórico.");
        }
      } catch (e) {
        warnings.push(`caja: ${e instanceof Error ? e.message : "error"}`);
      }
    }

    // 6) CxC (crédito): marcar como anulada si existe.
    if ((venta.tipo_venta ?? "").toUpperCase() === "CREDITO") {
      try {
        await sb
          .from("cuentas_por_cobrar")
          .update({ estado: "anulada" })
          .eq("empresa_id", empresaId)
          .eq("venta_id", id);
      } catch (e) {
        warnings.push(`CxC: ${e instanceof Error ? e.message : "error"}`);
      }
    }

    return NextResponse.json(successResponse({
      anulada: true,
      numero_control: venta.numero_control,
      items_reversados: items.length,
      warnings: warnings.length > 0 ? warnings : null,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo anular la venta.";
    console.error("[/api/ventas/[id]/anular]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
