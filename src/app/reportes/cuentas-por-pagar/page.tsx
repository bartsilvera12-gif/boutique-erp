"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Item = {
  numero_control: string;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  fecha: string;
  total_documento: number;
  total_pagado: number;
  saldo_pendiente: number;
  dias_desde_fecha: number;
  items_count: number;
  estado_pago: "pendiente" | "parcial" | "pagado";
};

function fmtGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}

type Banda = "0-30" | "31-60" | "61-90" | "+90";
function banda(dias: number): Banda {
  if (dias <= 30) return "0-30";
  if (dias <= 60) return "31-60";
  if (dias <= 90) return "61-90";
  return "+90";
}

const BANDA_COLOR: Record<Banda, string> = {
  "0-30":  "text-emerald-700",
  "31-60": "text-amber-700",
  "61-90": "text-orange-700",
  "+90":   "text-red-700",
};

export default function ReporteCuentasPorPagarPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancel = false;
    fetchWithSupabaseSession("/api/compras/cuentas-por-pagar", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancel && j?.success) setItems((j.data?.items ?? []) as Item[]); })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, []);

  // Agrupar por proveedor
  const porProveedor = useMemo(() => {
    const map = new Map<string, {
      proveedor_id: string | null;
      proveedor_nombre: string;
      total_deuda: number;
      docs_count: number;
      bandas: Record<Banda, number>;
    }>();
    for (const i of items) {
      const key = i.proveedor_id ?? i.proveedor_nombre ?? "(sin proveedor)";
      const ex = map.get(key);
      if (ex) {
        ex.total_deuda += i.saldo_pendiente;
        ex.docs_count += 1;
        ex.bandas[banda(i.dias_desde_fecha)] += i.saldo_pendiente;
      } else {
        map.set(key, {
          proveedor_id: i.proveedor_id,
          proveedor_nombre: i.proveedor_nombre ?? "(sin proveedor)",
          total_deuda: i.saldo_pendiente,
          docs_count: 1,
          bandas: { "0-30": 0, "31-60": 0, "61-90": 0, "+90": 0,
            [banda(i.dias_desde_fecha)]: i.saldo_pendiente } as Record<Banda, number>,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total_deuda - a.total_deuda);
  }, [items]);

  const totales = useMemo(() => {
    const total = porProveedor.reduce((s, p) => s + p.total_deuda, 0);
    const b: Record<Banda, number> = { "0-30": 0, "31-60": 0, "61-90": 0, "+90": 0 };
    for (const p of porProveedor) {
      b["0-30"] += p.bandas["0-30"];
      b["31-60"] += p.bandas["31-60"];
      b["61-90"] += p.bandas["61-90"];
      b["+90"] += p.bandas["+90"];
    }
    return { total, bandas: b, proveedores: porProveedor.length };
  }, [porProveedor]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Cuentas por pagar"
        description="Deuda total con proveedores, agrupada por proveedor y antigüedad"
        backHref="/reportes"
        backLabel="Reportes"
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard compact label="Deuda total" value={fmtGs(totales.total)} accent
          hint={`${totales.proveedores} proveedor(es)`} />
        <StatCard compact label="0-30 días" value={fmtGs(totales.bandas["0-30"])} hint="al día" />
        <StatCard compact label="31-60 días" value={fmtGs(totales.bandas["31-60"])} hint="alerta" />
        <StatCard compact label="61-90 días" value={fmtGs(totales.bandas["61-90"])} hint="crítico" />
        <StatCard compact label="+90 días" value={fmtGs(totales.bandas["+90"])} hint="incobrable" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Proveedor</th>
                <th className="px-4 py-3 text-right">Docs</th>
                <th className="px-4 py-3 text-right">0-30d</th>
                <th className="px-4 py-3 text-right">31-60d</th>
                <th className="px-4 py-3 text-right">61-90d</th>
                <th className="px-4 py-3 text-right">+90d</th>
                <th className="px-4 py-3 text-right">Total deuda</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando && (
                <tr><td colSpan={7} className="py-12 text-center text-sm text-slate-400">Cargando…</td></tr>
              )}
              {!cargando && porProveedor.length === 0 && (
                <tr><td colSpan={7} className="py-12 text-center text-sm text-slate-400">No hay deuda con proveedores. 👌</td></tr>
              )}
              {!cargando && porProveedor.map((p) => (
                <tr key={(p.proveedor_id ?? "_") + p.proveedor_nombre} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/pagos-proveedores`} className="font-medium text-slate-800 hover:underline">{p.proveedor_nombre}</Link>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600 tabular-nums">{p.docs_count}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${BANDA_COLOR["0-30"]}`}>{p.bandas["0-30"] ? fmtGs(p.bandas["0-30"]) : "—"}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${BANDA_COLOR["31-60"]}`}>{p.bandas["31-60"] ? fmtGs(p.bandas["31-60"]) : "—"}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${BANDA_COLOR["61-90"]}`}>{p.bandas["61-90"] ? fmtGs(p.bandas["61-90"]) : "—"}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${BANDA_COLOR["+90"]}`}>{p.bandas["+90"] ? fmtGs(p.bandas["+90"]) : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">{fmtGs(p.total_deuda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
        <strong>Antigüedad de deuda:</strong> los días se calculan desde la fecha de la compra
        hasta hoy. La columna "+90d" representa deuda crítica que generalmente requiere
        renegociación con el proveedor.
      </p>
    </div>
  );
}
