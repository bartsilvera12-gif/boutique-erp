import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * DELETE de una compatibilidad vehicular específica del producto.
 */
export async function DELETE(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string; compatId: string }> }
) {
  try {
    const { id, compatId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const del = await ctx.supabase
      .from("producto_compatibilidad_vehiculo")
      .delete()
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("producto_id", id)
      .eq("id", compatId)
      .select("id")
      .maybeSingle();

    if (del.error) throw new Error(del.error.message);
    if (!del.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    return NextResponse.json(successResponse({ id: compatId }));
  } catch (err) {
    console.error("[/api/productos/[id]/compatibilidades/[compatId] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo eliminar la compatibilidad."), { status: 500 });
  }
}
