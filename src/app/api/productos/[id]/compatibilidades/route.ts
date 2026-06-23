import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Compatibilidades vehiculares de un producto.
 * GET   → lista de vehículos compatibles del producto.
 * POST  → agrega un nuevo vehículo compatible.
 */

const COMPAT_COLS =
  "id, producto_id, marca_vehiculo, modelo_vehiculo, anio_desde, anio_hasta, motor, version, observacion, created_at";

export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const { data, error } = await ctx.supabase
      .from("producto_compatibilidad_vehiculo")
      .select(COMPAT_COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("producto_id", id)
      .order("marca_vehiculo")
      .order("modelo_vehiculo");

    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ compatibilidades: data ?? [] }));
  } catch (err) {
    console.error("[/api/productos/[id]/compatibilidades GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las compatibilidades."), { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sb = ctx.supabase;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const marca = typeof body.marca_vehiculo === "string" ? body.marca_vehiculo.trim() : "";
    const modelo = typeof body.modelo_vehiculo === "string" ? body.modelo_vehiculo.trim() : "";
    if (!marca) return NextResponse.json(errorResponse("La marca del vehículo es obligatoria."), { status: 400 });
    if (!modelo) return NextResponse.json(errorResponse("El modelo del vehículo es obligatorio."), { status: 400 });

    const anioDesde =
      body.anio_desde === undefined || body.anio_desde === null || body.anio_desde === ""
        ? null
        : Math.floor(Number(body.anio_desde));
    const anioHasta =
      body.anio_hasta === undefined || body.anio_hasta === null || body.anio_hasta === ""
        ? null
        : Math.floor(Number(body.anio_hasta));
    if (anioDesde !== null && (!Number.isFinite(anioDesde) || anioDesde < 1900 || anioDesde > 2100)) {
      return NextResponse.json(errorResponse("Año desde inválido."), { status: 400 });
    }
    if (anioHasta !== null && (!Number.isFinite(anioHasta) || anioHasta < 1900 || anioHasta > 2100)) {
      return NextResponse.json(errorResponse("Año hasta inválido."), { status: 400 });
    }
    if (anioDesde !== null && anioHasta !== null && anioDesde > anioHasta) {
      return NextResponse.json(errorResponse("\"Año desde\" no puede ser mayor a \"año hasta\"."), { status: 400 });
    }

    // Validar que el producto exista y pertenezca a la empresa
    const owns = await sb
      .from("productos")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .maybeSingle();
    if (owns.error) throw new Error(owns.error.message);
    if (!owns.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    const motor = typeof body.motor === "string" ? body.motor.trim() || null : null;
    const version = typeof body.version === "string" ? body.version.trim() || null : null;
    const observacion = typeof body.observacion === "string" ? body.observacion.trim() || null : null;

    const ins = await sb
      .from("producto_compatibilidad_vehiculo")
      .insert({
        empresa_id: empresaId,
        producto_id: id,
        marca_vehiculo: marca,
        modelo_vehiculo: modelo,
        anio_desde: anioDesde,
        anio_hasta: anioHasta,
        motor,
        version,
        observacion,
      })
      .select(COMPAT_COLS)
      .single();

    if (ins.error) {
      console.error("[/api/productos/[id]/compatibilidades POST] insert", ins.error.message);
      return NextResponse.json(errorResponse("No se pudo registrar la compatibilidad."), { status: 500 });
    }

    return NextResponse.json(successResponse({ compatibilidad: ins.data }));
  } catch (err) {
    console.error("[/api/productos/[id]/compatibilidades POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo registrar la compatibilidad."), { status: 500 });
  }
}
