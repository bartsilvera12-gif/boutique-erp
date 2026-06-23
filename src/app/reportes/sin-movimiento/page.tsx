"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Item = {
  id: string;
  nombre: string;
  sku: string;
  marca_repuesto: string | null;
  codigo_oem: string | null;
  stock_actual: number;
  costo_promedio: number;
  valor_inmovilizado: number;
  ultima_salida_fecha: string | null;
  dias_sin_movimiento: number | null;
};

function fmtGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function fmtFecha(iso: string | null) {
  if (!iso) return "Nunca";
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return "—";
  }
}

export default function SinMovimientoPage() {
  const [dias, setDias] = useState(90);
  const [items, setItems] = useState<Item[]>([]);
  const [valorTotal, setValorTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    setError(null);
    fetchWithSupabaseSession(`/api/reportes/sin-movimiento?dias=${dias}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        if (!j?.success) {
          setError(j?.error ?? "Error al cargar el reporte");
          setItems([]);
          setValorTotal(0);
        } else {
          setItems((j.data?.items ?? []) as Item[]);
          setValorTotal(Number(j.data?.valor_total_inmovilizado ?? 0));
        }
      })
      .catch((e) => {
        if (cancel) return;
        setError(e instanceof Error ? e.message : "Error de red");
      })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [dias]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Productos sin movimiento"
        description="Stock con capital inmovilizado: productos con stock > 0 que no tuvieron salidas en el período"
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
            <option value={365}>Último año</option>
          </select>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard compact label="Productos sin movimiento" value={String(items.length)} accent
          hint={`en los últimos ${dias} días`} />
        <StatCard compact label="Valor inmovilizado" value={fmtGs(valorTotal)}
          hint="stock × costo promedio" />
        <StatCard compact label="Promedio por producto" value={fmtGs(items.length ? valorTotal / items.length : 0)}
          hint="por unidad de SKU" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Producto</th>
                <th className="px-4 py-3 text-left hidden sm:table-cell">Marca</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3 text-right">Costo unit.</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-right hidden md:table-cell">Última salida</th>
                <th className="px-4 py-3 text-right hidden md:table-cell">Días sin movim.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">Cargando…</td></tr>
              )}
              {!cargando && error && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-red-600">{error}</td></tr>
              )}
              {!cargando && !error && items.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">No hay productos sin movimiento en este período. 👌</td></tr>
              )}
              {!cargando && !error && items.map((it) => (
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
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{fmtGs(it.costo_promedio)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-800">{fmtGs(it.valor_inmovilizado)}</td>
                  <td className="px-4 py-3 text-right hidden md:table-cell text-slate-500">{fmtFecha(it.ultima_salida_fecha)}</td>
                  <td className="px-4 py-3 text-right hidden md:table-cell">
                    {it.dias_sin_movimiento == null
                      ? <span className="text-xs text-slate-400">Sin historial</span>
                      : <span className={`text-sm tabular-nums ${it.dias_sin_movimiento > 180 ? "text-red-600 font-semibold" : it.dias_sin_movimiento > 90 ? "text-amber-600" : "text-slate-700"}`}>
                          {it.dias_sin_movimiento}
                        </span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
