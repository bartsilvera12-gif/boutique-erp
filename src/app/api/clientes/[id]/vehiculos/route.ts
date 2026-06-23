import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Vehículos del cliente (rubro autopartes).
 * GET   → lista de vehículos del cliente.
 * POST  → registrar un nuevo vehículo.
 */

const VEH_COLS =
  "id, cliente_id, marca, modelo, anio, motor, chapa, observacion, activo, created_at";

export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const { data, error } = await ctx.supabase
      .from("cliente_vehiculo")
      .select(VEH_COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("cliente_id", id)
      .eq("activo", true)
      .order("marca")
      .order("modelo");

    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ vehiculos: data ?? [] }));
  } catch (err) {
    console.error("[/api/clientes/[id]/vehiculos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los vehículos."), { status: 500 });
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

    const marca = typeof body.marca === "string" ? body.marca.trim() : "";
    const modelo = typeof body.modelo === "string" ? body.modelo.trim() : "";
    if (!marca) return NextResponse.json(errorResponse("La marca es obligatoria."), { status: 400 });
    if (!modelo) return NextResponse.json(errorResponse("El modelo es obligatorio."), { status: 400 });

    const anio =
      body.anio === undefined || body.anio === null || body.anio === ""
        ? null
        : Math.floor(Number(body.anio));
    if (anio !== null && (!Number.isFinite(anio) || anio < 1900 || anio > 2100)) {
      return NextResponse.json(errorResponse("Año inválido."), { status: 400 });
    }

    // Ownership del cliente
    const owns = await sb
      .from("clientes")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .maybeSingle();
    if (owns.error) throw new Error(owns.error.message);
    if (!owns.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    const motor = typeof body.motor === "string" ? body.motor.trim() || null : null;
    const chapa = typeof body.chapa === "string" ? body.chapa.trim().toUpperCase() || null : null;
    const observacion = typeof body.observacion === "string" ? body.observacion.trim() || null : null;

    const ins = await sb
      .from("cliente_vehiculo")
      .insert({
        empresa_id: empresaId,
        cliente_id: id,
        marca,
        modelo,
        anio,
        motor,
        chapa,
        observacion,
        activo: true,
      })
      .select(VEH_COLS)
      .single();

    if (ins.error) {
      console.error("[/api/clientes/[id]/vehiculos POST]", ins.error.message);
      return NextResponse.json(errorResponse("No se pudo registrar el vehículo."), { status: 500 });
    }

    return NextResponse.json(successResponse({ vehiculo: ins.data }));
  } catch (err) {
    console.error("[/api/clientes/[id]/vehiculos POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo registrar el vehículo."), { status: 500 });
  }
}
