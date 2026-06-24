import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Cuentas por Pagar — endpoint de pagos a proveedores.
 *
 * GET /api/compras/pagos
 *   ?numero_control=XXX      → historial de pagos de un documento
 *   ?proveedor_id=UUID       → historial por proveedor (chronological)
 *   sin params                → últimos 500 pagos (listado general)
 *
 * POST /api/compras/pagos
 *   Body: { numero_control, proveedor_id?, proveedor_nombre?, monto,
 *           moneda?, metodo_pago, entidad_id?, entidad_nombre?,
 *           referencia?, observaciones?, fecha? }
 *   Crea un registro de pago. Valida monto > 0 y método válido.
 */

const COLS =
  "id, numero_control, proveedor_id, proveedor_nombre, monto, moneda, " +
  "metodo_pago, entidad_id, entidad_nombre, referencia, observaciones, " +
  "fecha, created_at, usuario_nombre";

const METODOS = new Set(["efectivo", "transferencia", "tarjeta", "cheque", "otro"]);

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;

    const url = new URL(request.url);
    const numero = (url.searchParams.get("numero_control") ?? "").trim();
    const proveedorId = (url.searchParams.get("proveedor_id") ?? "").trim();

    let q = supabase
      .from("compras_pagos")
      .select(COLS)
      .eq("empresa_id", auth.empresa_id)
      .order("fecha", { ascending: false });

    if (numero) q = q.eq("numero_control", numero);
    if (proveedorId) q = q.eq("proveedor_id", proveedorId);
    if (!numero && !proveedorId) q = q.range(0, 499);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ pagos: data ?? [] }));
  } catch (err) {
    console.error("[/api/compras/pagos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los pagos."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const numeroControl = typeof body.numero_control === "string" ? body.numero_control.trim() : "";
    if (!numeroControl) return NextResponse.json(errorResponse("numero_control es obligatorio."), { status: 400 });

    const monto = Number(body.monto);
    if (!Number.isFinite(monto) || monto <= 0) {
      return NextResponse.json(errorResponse("monto debe ser un número > 0."), { status: 400 });
    }

    const metodo = typeof body.metodo_pago === "string" ? body.metodo_pago.toLowerCase() : "";
    if (!METODOS.has(metodo)) {
      return NextResponse.json(errorResponse("método de pago inválido."), { status: 400 });
    }

    // Confirmar que el documento (numero_control) existe en compras de esta empresa.
    const docCheck = await supabase
      .from("compras")
      .select("numero_control, proveedor_id, proveedor_nombre", { count: "exact", head: false })
      .eq("empresa_id", auth.empresa_id)
      .eq("numero_control", numeroControl)
      .limit(1);
    if (docCheck.error) throw new Error(docCheck.error.message);
    const docRow = (docCheck.data ?? [])[0] as
      | { numero_control: string; proveedor_id: string | null; proveedor_nombre: string | null }
      | undefined;
    if (!docRow) {
      return NextResponse.json(errorResponse("Documento de compra no encontrado."), { status: 404 });
    }

    const proveedorId = (typeof body.proveedor_id === "string" && body.proveedor_id) || docRow.proveedor_id || null;
    const proveedorNombre =
      (typeof body.proveedor_nombre === "string" && body.proveedor_nombre.trim()) ||
      docRow.proveedor_nombre || null;

    const ins = await supabase
      .from("compras_pagos")
      .insert({
        empresa_id: auth.empresa_id,
        numero_control: numeroControl,
        proveedor_id: proveedorId,
        proveedor_nombre: proveedorNombre,
        monto,
        moneda: typeof body.moneda === "string" ? body.moneda : "PYG",
        metodo_pago: metodo,
        entidad_id: typeof body.entidad_id === "string" ? body.entidad_id : null,
        entidad_nombre: typeof body.entidad_nombre === "string" ? body.entidad_nombre.trim() || null : null,
        referencia: typeof body.referencia === "string" ? body.referencia.trim() || null : null,
        observaciones: typeof body.observaciones === "string" ? body.observaciones.trim() || null : null,
        fecha: typeof body.fecha === "string" ? body.fecha : new Date().toISOString(),
        usuario_nombre: auth.user?.email ?? null,
        created_by: auth.user?.id ?? null,
      })
      .select(COLS)
      .single();

    if (ins.error) {
      console.error("[/api/compras/pagos POST]", ins.error.message);
      return NextResponse.json(errorResponse("No se pudo registrar el pago."), { status: 500 });
    }
    return NextResponse.json(successResponse({ pago: ins.data }));
  } catch (err) {
    console.error("[/api/compras/pagos POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo registrar el pago."), { status: 500 });
  }
}
