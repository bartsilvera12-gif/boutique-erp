"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Banda = "alta" | "media" | "baja" | "nula";
type Item = {
  id: string;
  nombre: string;
  sku: string;
  marca_repuesto: string | null;
  codigo_oem: string | null;
  stock_actual: number;
  costo_promedio: number;
  precio_venta: number;
  unidades_vendidas: number;
  rotacion: number;
  banda: Banda;
  ingreso_estimado: number;
};
type Resumen = {
  total_productos: number;
  con_movimiento: number;
  sin_movimiento: number;
  unidades_vendidas_total: number;
  ingreso_total: number;
};

function fmtGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}

const BANDA_LBL: Record<Banda, { label: string; cls: string }> = {
  alta:  { label: "Alta",  cls: "bg-emerald-100 text-emerald-700" },
  media: { label: "Media", cls: "bg-sky-100 text-sky-700" },
  baja:  { label: "Baja",  cls: "bg-amber-100 text-amber-700" },
  nula:  { label: "Nula",  cls: "bg-rose-100 text-rose-700" },
};

export default function RotacionPage() {
  const [dias, setDias] = useState(90);
  const [filtroBanda, setFiltroBanda] = useState<Banda | "todas">("todas");
  const [items, setItems] = useState<Item[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    setError(null);
    fetchWithSupabaseSession(`/api/reportes/rotacion?dias=${dias}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        if (!j?.success) {
          setError(j?.error ?? "Error al cargar el reporte");
          setItems([]);
          setResumen(null);
        } else {
          setItems((j.data?.items ?? []) as Item[]);
          setResumen((j.data?.resumen ?? null) as Resumen | null);
        }
      })
      .catch((e) => {
        if (cancel) return;
        setError(e instanceof Error ? e.message : "Error de red");
      })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [dias]);

  const visibles = filtroBanda === "todas" ? items : items.filter((i) => i.banda === filtroBanda);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Rotación de inventario"
        description="Cuántas veces se vendió el stock de cada producto en el período"
        backHref="/reportes"
        backLabel="Reportes"
        actions={
          <select
            value={dias}
            onChange={(e) => setDias(parseInt(e.target.value) || 90)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/30"
          >
            <option value={30}>Últimos 30 días</option>
            <option value={60}>Últimos 60 días</option>
            <option value={90}>Últimos 90 días</option>
            <option value={180}>Últimos 180 días</option>
          </select>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard compact label="Productos totales" value={String(resumen?.total_productos ?? 0)}
          hint="con control de stock" />
        <StatCard compact label="Con movimiento" value={String(resumen?.con_movimiento ?? 0)} accent
          hint="vendieron en el período" />
        <StatCard compact label="Sin movimiento" value={String(resumen?.sin_movimiento ?? 0)}
          hint="cero ventas" />
        <StatCard compact label="Ingreso estimado" value={fmtGs(resumen?.ingreso_total ?? 0)}
          hint="unidades × precio venta" />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">Banda:</span>
        {(["todas","alta","media","baja","nula"] as const).map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setFiltroBanda(b)}
            className={`px-2.5 py-1 rounded-full font-medium transition-colors ${
              filtroBanda === b
                ? "bg-[#4FAEB2] text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {b === "todas" ? "Todas" : BANDA_LBL[b].label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Producto</th>
                <th className="px-4 py-3 text-left hidden sm:table-cell">Marca</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3 text-right">Vendido</th>
                <th className="px-4 py-3 text-right">Rotación</th>
                <th className="px-4 py-3 text-center">Banda</th>
                <th className="px-4 py-3 text-right hidden md:table-cell">Ingreso est.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">Cargando…</td></tr>
              )}
              {!cargando && error && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-red-600">{error}</td></tr>
              )}
              {!cargando && !error && visibles.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">Sin datos para el filtro seleccionado.</td></tr>
              )}
              {!cargando && !error && visibles.map((it) => (
                <tr key={it.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{it.nombre}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                      <span className="font-mono">{it.sku}</span>
                      {it.codigo_oem && <span className="font-mono text-[#3F8E91]">· OEM {it.codigo_oem}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell text-slate-600">{it.marca_repuesto ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{it.stock_actual}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{it.unidades_vendidas}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{it.rotacion.toFixed(2)}×</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${BANDA_LBL[it.banda].cls}`}>
                      {BANDA_LBL[it.banda].label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right hidden md:table-cell tabular-nums text-slate-700">{fmtGs(it.ingreso_estimado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
        <strong>Fórmula:</strong> rotación = unidades vendidas en el período ÷ stock actual. Es una aproximación al ratio
        clásico (COGS ÷ inventario promedio), útil para identificar productos que se mueven rápido (alta &gt;= 2x), normales
        (media), lentos (baja) o muertos (nula).
      </p>
    </div>
  );
}
