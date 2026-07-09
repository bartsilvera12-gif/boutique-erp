import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { signProductoImagen, pathBelongsToEmpresa } from "@/lib/inventario/imagen-storage";

/**
 * GET /api/inventario/imagen?path=<empresa_id>/<producto_id>/principal.jpg
 *
 * Proxy que firma la URL de la imagen del producto (bucket privado) y hace
 * un 302 al signed URL. Verifica que el path pertenezca al empresa del usuario
 * antes de firmar para evitar cross-tenant.
 *
 * Se usa desde <img src="..."> en la lista de inventario, así el navegador
 * cachea la imagen aunque la URL firmada expire (mientras el usuario esté
 * logueado, cada request refresca).
 */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("Unauthorized", { status: 401 });

  const path = new URL(request.url).searchParams.get("path");
  if (!path) return new NextResponse("Missing path", { status: 400 });
  if (!pathBelongsToEmpresa(path, ctx.auth.empresa_id)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const signed = await signProductoImagen(ctx.supabase, path, 3600);
  if (!signed) return new NextResponse("Not found", { status: 404 });

  // 302 con caché privada de 5 min: el navegador reutiliza la imagen sin volver
  // a firmar en cada scroll/refresh de la lista.
  return NextResponse.redirect(signed, {
    status: 302,
    headers: { "cache-control": "private, max-age=300" },
  });
}
