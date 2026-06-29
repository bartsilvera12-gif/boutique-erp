import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * DELETE /api/compras/pagos/[id]
 *
 * Elimina físicamente un pago a proveedor. No es soft delete: el pago
 * desaparece de la tabla y libera el saldo pendiente del documento
 * (el saldo se calcula como total compras − Σ pagos en runtime, así que
 * borrarlo automáticamente actualiza el saldo en la próxima carga).
 *
 * Para anular una compra que tenía pagos, el flujo es:
 *   1) /pagos-proveedores → eliminar cada pago.
 *   2) /compras → anular el documento.
 */
export async function DELETE(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    if (!id) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;

    // Verificar que el pago existe y pertenece a la empresa.
    const pQ = await sb
      .from("compras_pagos")
      .select("id, numero_control, monto")
      .eq("empresa_id", auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (pQ.error) return NextResponse.json(errorResponse(pQ.error.message), { status: 400 });
    if (!pQ.data) return NextResponse.json(errorResponse("Pago no encontrado."), { status: 404 });

    const del = await sb
      .from("compras_pagos")
      .delete()
      .eq("empresa_id", auth.empresa_id)
      .eq("id", id);
    if (del.error) return NextResponse.json(errorResponse(del.error.message), { status: 400 });

    return NextResponse.json(successResponse({ eliminado: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo eliminar el pago.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
