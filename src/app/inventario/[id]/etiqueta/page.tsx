"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ean13Svg } from "@/lib/etiquetas/ean13";

type Producto = {
  id: string;
  nombre: string;
  sku: string;
  codigo_barras: string | null;
  precio_venta: number | string;
};

function fmtGs(v: number): string {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}

export default function EtiquetaPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const copias = Math.max(1, Math.min(500, Number(search.get("copias") || "1") || 1));
  const mostrarPrecio = search.get("precio") !== "0";
  const anchoMm = Number(search.get("w") || "50") || 50;
  const altoMm = Number(search.get("h") || "30") || 30;

  const [producto, setProducto] = useState<Producto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch(`/api/productos/${params.id}`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        if (j?.success && j?.data?.producto) setProducto(j.data.producto as Producto);
        else setError(j?.error || "No se pudo cargar el producto.");
      })
      .catch((e) => { if (!cancel) setError(e instanceof Error ? e.message : "Error de red."); });
    return () => { cancel = true; };
  }, [params.id]);

  const barcodeSvg = useMemo(() => {
    if (!producto?.codigo_barras) return null;
    try { return ean13Svg(producto.codigo_barras, { width: 190, barHeight: 55, fontSize: 12 }); }
    catch { return null; }
  }, [producto?.codigo_barras]);

  if (error) return <div style={{ padding: 24, color: "#b91c1c" }}>{error}</div>;
  if (!producto) return <div style={{ padding: 24 }}>Cargando…</div>;
  if (!producto.codigo_barras) {
    return (
      <div style={{ padding: 24 }}>
        Este producto no tiene código de barras. Volvé al editor y usá <b>Generar código de barras</b>.
      </div>
    );
  }
  if (!barcodeSvg) {
    return <div style={{ padding: 24, color: "#b91c1c" }}>Código de barras inválido (debe ser EAN-13, 13 dígitos).</div>;
  }

  const precioNum = Number(producto.precio_venta) || 0;

  return (
    <>
      <style>{`
        @page { size: ${anchoMm}mm ${altoMm}mm; margin: 0; }
        html, body { margin: 0; padding: 0; background: #f3f4f6; }
        .toolbar {
          position: sticky; top: 0; z-index: 10;
          background: white; border-bottom: 1px solid #e5e7eb;
          padding: 12px 20px; display: flex; gap: 12px; align-items: center;
          font-family: system-ui, sans-serif; font-size: 14px;
        }
        .toolbar button {
          background: #4FAEB2; color: white; border: 0; padding: 8px 16px;
          border-radius: 8px; font-weight: 600; cursor: pointer;
        }
        .toolbar button:hover { background: #3F8E91; }
        .toolbar .info { color: #64748b; }
        .sheet { padding: 20px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .label {
          width: ${anchoMm}mm; height: ${altoMm}mm;
          background: white;
          padding: 1.5mm 2mm;
          box-sizing: border-box;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 0.6mm;
          overflow: hidden;
          page-break-after: always;
          box-shadow: 0 1px 2px rgba(0,0,0,.1);
        }
        .label:last-child { page-break-after: auto; }
        .label .name {
          font: 700 8.5px/1.1 Helvetica, Arial, sans-serif;
          text-align: center;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          max-width: 100%;
        }
        .label .barcode { width: 100%; display: flex; justify-content: center; }
        .label .barcode svg { width: 100%; height: auto; max-height: ${altoMm * 0.55}mm; }
        .label .price {
          font: 700 10.5px/1 Helvetica, Arial, sans-serif;
        }
        @media print {
          html, body { background: white; }
          .toolbar { display: none; }
          .sheet { padding: 0; gap: 0; }
          .label { box-shadow: none; }
          /* Oculta Sidebar / Header / MobileBottomNav del AppShell — sólo deja las etiquetas. */
          #neura-app-shell > *:not(#neura-main-column),
          #neura-main-column > *:not(#neura-main-content) { display: none !important; }
          #neura-app-shell,
          #neura-main-column,
          #neura-main-content {
            display: block !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
          }
        }
      `}</style>
      <div className="toolbar">
        <button type="button" onClick={() => window.print()}>Imprimir</button>
        <span className="info">
          {copias} etiqueta{copias === 1 ? "" : "s"} · {anchoMm}×{altoMm} mm · {producto.nombre}
        </span>
      </div>
      <div className="sheet">
        {Array.from({ length: copias }, (_, i) => (
          <div className="label" key={i}>
            <div className="name">{producto.nombre}</div>
            <div className="barcode" dangerouslySetInnerHTML={{ __html: barcodeSvg }} />
            {mostrarPrecio && precioNum > 0 && <div className="price">{fmtGs(precioNum)}</div>}
          </div>
        ))}
      </div>
    </>
  );
}
