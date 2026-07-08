import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { ean13Svg } from "@/lib/etiquetas/ean13";

/**
 * GET /api/productos/[id]/etiqueta?copias=N&w=50&h=30&precio=1
 *
 * Devuelve una página HTML imprimible con N etiquetas del producto, cada una
 * de w × h mm. Va como raw HTML (no dentro del AppShell) para que `@page`
 * arme correctamente el tamaño de página y la vista previa del navegador
 * muestre etiquetas al tamaño real — mismo patrón que /api/ventas/[id]/ticket.
 */
export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await ctxParams.params;
  const url = new URL(request.url);
  const copias = Math.max(1, Math.min(500, Number(url.searchParams.get("copias") || "1") || 1));
  const anchoMm = Math.max(20, Math.min(120, Number(url.searchParams.get("w") || "50") || 50));
  const altoMm = Math.max(15, Math.min(80, Number(url.searchParams.get("h") || "30") || 30));
  const mostrarPrecio = url.searchParams.get("precio") !== "0";

  const { data, error } = await ctx.supabase
    .from("productos")
    .select("id, nombre, sku, codigo_barras, precio_venta")
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("id", id)
    .maybeSingle();

  if (error) return new NextResponse(`Error: ${error.message}`, { status: 500 });
  if (!data) return new NextResponse("Producto no encontrado.", { status: 404 });

  const codigo = String(data.codigo_barras ?? "").trim();
  if (!/^\d{13}$/.test(codigo)) {
    return new NextResponse(
      `<!doctype html><html><body style="font-family:sans-serif;padding:24px">
        Este producto no tiene un código de barras EAN-13 válido.
        Volvé al editor y usá <b>Generar código de barras</b>.
      </body></html>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  const barcodeSvg = ean13Svg(codigo, { width: 285, barHeight: 90, fontSize: 18 });
  const precio = Number(data.precio_venta) || 0;
  const nombre = String(data.nombre || "").replace(/</g, "&lt;");
  const precioTxt = `Gs. ${Math.round(precio).toLocaleString("es-PY")}`;

  const labels = Array.from({ length: copias }, () => `
    <div class="label">
      <div class="name">${nombre}</div>
      <div class="barcode">${barcodeSvg}</div>
      ${mostrarPrecio && precio > 0 ? `<div class="price">${precioTxt}</div>` : ""}
    </div>
  `).join("");

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Etiqueta · ${nombre}</title>
<style>
  @page { size: ${anchoMm}mm ${altoMm}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #e5e7eb; }
  body { font-family: Helvetica, Arial, sans-serif; }
  .toolbar {
    position: sticky; top: 0; z-index: 10;
    background: white; border-bottom: 1px solid #d1d5db;
    padding: 12px 20px; display: flex; gap: 12px; align-items: center;
    font-size: 14px;
  }
  .toolbar button {
    background: #4FAEB2; color: white; border: 0; padding: 8px 16px;
    border-radius: 8px; font-weight: 600; cursor: pointer;
  }
  .toolbar button:hover { background: #3F8E91; }
  .toolbar .info { color: #64748b; }
  .sheet { padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .label {
    width: ${anchoMm}mm; height: ${altoMm}mm;
    background: white;
    padding: 1.2mm 1.5mm;
    box-sizing: border-box;
    display: flex; flex-direction: column;
    align-items: center; justify-content: space-between;
    overflow: hidden;
    page-break-after: always;
    box-shadow: 0 1px 3px rgba(0,0,0,.15);
  }
  .label:last-child { page-break-after: auto; }
  .label .name {
    font: 700 2.4mm/1.1 Helvetica, Arial, sans-serif;
    text-align: center;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: 100%;
  }
  .label .barcode { width: 100%; flex: 1; display: flex; align-items: center; justify-content: center; min-height: 0; }
  .label .barcode svg { width: 100%; height: 100%; }
  .label .price { font: 700 3mm/1 Helvetica, Arial, sans-serif; }
  @media print {
    html, body { background: white; }
    .toolbar { display: none; }
    .sheet { padding: 0; gap: 0; }
    .label { box-shadow: none; }
  }
</style>
</head>
<body>
<div class="toolbar">
  <button type="button" onclick="window.print()">Imprimir</button>
  <span class="info">${copias} etiqueta${copias === 1 ? "" : "s"} · ${anchoMm}×${altoMm} mm · ${nombre}</span>
</div>
<div class="sheet">${labels}</div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
