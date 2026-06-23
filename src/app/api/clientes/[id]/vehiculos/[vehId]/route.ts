import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * DELETE de un vehículo del cliente. Soft-delete (activo=false) para
 * no romper FKs si llegan a colgarse de ventas u órdenes en el futuro.
 */
export async function DELETE(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string; vehId: string }> }
) {
  try {
    const { id, vehId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const upd = await ctx.supabase
      .from("cliente_vehiculo")
      .update({ activo: false })
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("cliente_id", id)
      .eq("id", vehId)
      .select("id")
      .maybeSingle();

    if (upd.error) throw new Error(upd.error.message);
    if (!upd.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    return NextResponse.json(successResponse({ id: vehId }));
  } catch (err) {
    console.error("[/api/clientes/[id]/vehiculos/[vehId] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo eliminar el vehículo."), { status: 500 });
  }
}
