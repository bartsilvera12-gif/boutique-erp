"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getCompras } from "@/lib/compras/storage";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { FancySelect } from "@/components/ui/FancySelect";
import MobileFab from "@/components/ui/MobileFab";
import type { Compra, TipoPago } from "@/lib/compras/types";

const inputFilterClass =
  "border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white";

function formatGs(valor: number) {
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}

function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch {
    return iso;
  }
}

const tipoPagoBadge: Record<TipoPago, string> = {
  contado: "bg-blue-50 text-blue-700",
  credito: "bg-orange-50 text-orange-700",
};

// ── Agrupación por numero_control: 1 compra = N filas ─────────────────────────
type GrupoCompra = {
  numero_control: string;
  proveedor_nombre: string;
  fecha: string;
  tipo_pago: TipoPago;
  plazo_dias?: number;
  items: Compra[];
  total: number;
  comprobante: boolean;
  anulada: boolean;
};

function agrupar(rows: Compra[]): GrupoCompra[] {
  const map = new Map<string, GrupoCompra>();
  for (const c of rows) {
    const key = c.numero_control || c.id;
    let g = map.get(key);
    if (!g) {
      g = {
        numero_control: c.numero_control,
        proveedor_nombre: c.proveedor_nombre,
        fecha: c.fecha,
        tipo_pago: c.tipo_pago,
        plazo_dias: c.plazo_dias,
        items: [],
        total: 0,
        comprobante: false,
        anulada: false,
      };
      map.set(key, g);
    }
    g.items.push(c);
    g.total += Number(c.total) || 0;
    if (c.comprobante_storage_path) g.comprobante = true;
    if (c.estado === "anulada") g.anulada = true;
  }
  return [...map.values()].sort(
    (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
  );
}

function resumenProductos(items: Compra[]): string {
  if (items.length === 0) return "—";
  if (items.length === 1) return items[0].producto_nombre;
  return `${items[0].producto_nombre} + ${items.length - 1} más`;
}

export default function ComprasPage() {
  const [todas, setTodas] = useState<Compra[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipoPago, setFiltroTipoPago] = useState<TipoPago | "">("");
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [cargandoLista, setCargandoLista] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Anulación
  const [anularTarget, setAnularTarget] = useState<{ numero_control: string; proveedor_nombre: string; total: number } | null>(null);
  const [anularMotivo, setAnularMotivo] = useState("");
  const [anularLoading, setAnularLoading] = useState(false);
  const [anularError, setAnularError] = useState<string | null>(null);

  async function confirmarAnulacion() {
    if (!anularTarget) return;
    const motivo = anularMotivo.trim();
    if (motivo.length < 3) { setAnularError("El motivo es obligatorio (mínimo 3 caracteres)."); return; }
    setAnularLoading(true); setAnularError(null);
    try {
      const r = await fetch("/api/compras/anular", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero_control: anularTarget.numero_control, motivo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      setAnularTarget(null); setAnularMotivo("");
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setAnularError(e instanceof Error ? e.message : "No se pudo anular la compra.");
    } finally {
      setAnularLoading(false);
    }
  }

  useEffect(() => {
    let cancel = false;
    setCargandoLista(true);
    getCompras().then((data) => {
      if (cancel) return;
      setTodas(data);
    }).finally(() => {
      if (!cancel) setCargandoLista(false);
    });
    return () => { cancel = true; };
  }, [refreshKey]);

  const grupos = useMemo(() => agrupar(todas), [todas]);

  const filtrados = useMemo(() => {
    const texto = busqueda.toLowerCase().trim();
    return grupos.filter((g) => {
      const coincideTexto =
        texto === "" ||
        g.proveedor_nombre.toLowerCase().includes(texto) ||
        g.numero_control.toLowerCase().includes(texto) ||
        g.items.some((i) => i.producto_nombre.toLowerCase().includes(texto));
      const coincideTipoPago = filtroTipoPago === "" || g.tipo_pago === filtroTipoPago;
      return coincideTexto && coincideTipoPago;
    });
  }, [grupos, busqueda, filtroTipoPago]);

  const hayFiltros = busqueda || filtroTipoPago;

  function toggle(numero: string) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(numero)) next.delete(numero);
      else next.add(numero);
      return next;
    });
  }

  return (
    <div className="space-y-8">

      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
            style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }} />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Zentra · Adquisiciones</p>
        </div>
        <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Compras</h1>
        <p className="mt-0.5 text-xs text-slate-500">Registro de órdenes de compra a proveedores</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-5 lg:p-6">

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Compras</h2>
          <div className="flex items-center gap-3">
            <ExportExcelButton url="/api/compras/export" />
            <Link href="/compras/nueva"
              className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] active:scale-95">
              + Nueva compra
            </Link>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3 mb-5 pb-5 border-b border-gray-100">
          <input type="text" placeholder="Buscar por proveedor, producto o N° control..."
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            className={`${inputFilterClass} min-w-0 flex-1 sm:min-w-72`} />
          <FancySelect value={filtroTipoPago} onChange={(v) => setFiltroTipoPago(v as TipoPago | "")}
            ariaLabel="Filtrar por tipo de pago" className="w-44" size="sm"
            options={[
              { value: "", label: "Todos los pagos" },
              { value: "contado", label: "Contado" },
              { value: "credito", label: "Crédito" },
            ]} />
          {hayFiltros && (
            <button onClick={() => { setBusqueda(""); setFiltroTipoPago(""); }}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors px-2">
              Limpiar filtros
            </button>
          )}
          <span className="ml-auto text-sm text-gray-400">
            {filtrados.length} de {grupos.length} compras
          </span>
        </div>

        {/* Tabla agrupada por compra */}
        <EdgeScrollArea>
          <table className="w-full min-w-[760px] lg:min-w-0 text-left text-sm">
            <thead>
              <tr className="border-b text-gray-500">
                <th className="py-3 pr-4 font-medium">N° Control</th>
                <th className="py-3 pr-4 font-medium">Proveedor</th>
                <th className="py-3 pr-4 font-medium">Productos</th>
                <th className="py-3 pr-4 font-medium text-right">Ítems</th>
                <th className="py-3 pr-4 font-medium text-right">Total</th>
                <th className="hidden py-3 pr-4 font-medium lg:table-cell">Pago</th>
                <th className="py-3 pr-4 font-medium">Fecha</th>
                <th className="py-3 font-medium text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {cargandoLista ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-sm text-slate-400">
                    <div className="inline-flex items-center gap-2">
                      <svg className="h-4 w-4 animate-spin text-[#4FAEB2]" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Cargando compras…
                    </div>
                  </td>
                </tr>
              ) : filtrados.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400">
                    {grupos.length === 0 ? "No hay compras registradas" : "Ninguna compra coincide con los filtros"}
                  </td>
                </tr>
              ) : (
                filtrados.map((g) => {
                  const abierto = expandidos.has(g.numero_control);
                  const multi = g.items.length > 1;
                  return (
                    <FragmentRow key={g.numero_control}>
                      <tr
                        className={`border-b border-slate-200 transition-colors hover:bg-[#4FAEB2]/[0.04] ${multi ? "cursor-pointer" : ""}`}
                        onClick={() => multi && toggle(g.numero_control)}
                      >
                        <td className="py-4 pr-4 font-mono text-xs text-gray-500">
                          {multi && <span className="mr-1 inline-block text-gray-400">{abierto ? "▾" : "▸"}</span>}
                          {g.numero_control}
                        </td>
                        <td className="py-4 pr-4 font-medium text-gray-800">{g.proveedor_nombre}</td>
                        <td className="py-4 pr-4 text-gray-600">
                          <div>{resumenProductos(g.items)}</div>
                          {g.comprobante && (
                            <a
                              href={`/api/compras/comprobante?numero_control=${encodeURIComponent(g.numero_control)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-[#4FAEB2] hover:text-[#3F8E91] hover:underline"
                            >
                              📎 Ver comprobante
                            </a>
                          )}
                          {g.tipo_pago === "credito" && (
                            <Link
                              href={`/pagos-proveedores`}
                              onClick={(e) => e.stopPropagation()}
                              className="ml-2 mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-900 hover:underline"
                              title="Registrar pago a este proveedor"
                            >
                              💰 Pagar
                            </Link>
                          )}
                        </td>
                        <td className="py-4 pr-4 text-right tabular-nums text-gray-700">{g.items.length}</td>
                        <td className="py-4 pr-4 text-right tabular-nums font-semibold text-gray-800">{formatGs(g.total)}</td>
                        <td className="hidden py-4 pr-4 lg:table-cell">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${g.tipo_pago ? tipoPagoBadge[g.tipo_pago] : "bg-gray-100 text-gray-500"}`}>
                            {g.tipo_pago === "contado" ? "Contado" : g.tipo_pago === "credito" ? `Crédito ${g.plazo_dias ?? ""}d` : "—"}
                          </span>
                        </td>
                        <td className="py-4 pr-4 text-gray-500 text-xs tabular-nums">{formatFecha(g.fecha)}</td>
                        <td className="py-4 text-right" onClick={(e) => e.stopPropagation()}>
                          {g.anulada ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200">
                              Anulada
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAnularTarget({ numero_control: g.numero_control, proveedor_nombre: g.proveedor_nombre, total: g.total });
                                setAnularMotivo("");
                                setAnularError(null);
                              }}
                              className="inline-flex items-center justify-center rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:border-red-300 hover:bg-red-50 transition-colors"
                              title="Anular compra (reversa stock)"
                            >
                              Anular
                            </button>
                          )}
                        </td>
                      </tr>

                      {abierto && multi && g.items.map((it) => (
                        <tr key={it.id} className="border-b border-slate-100 bg-slate-50/50 text-xs">
                          <td className="py-2 pr-4" />
                          <td className="py-2 pr-4" />
                          <td className="py-2 pr-4 text-gray-700">
                            <span className="font-medium">{it.producto_nombre}</span>
                            <span className="ml-2 font-mono text-gray-400">{formatGs(it.costo_unitario)}/u</span>
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-600">{it.cantidad}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-700">{formatGs(it.total)}</td>
                          <td className="hidden lg:table-cell" />
                          <td />
                          <td />
                        </tr>
                      ))}
                    </FragmentRow>
                  );
                })
              )}
            </tbody>
          </table>
        </EdgeScrollArea>

      </div>

      <MobileFab href="/compras/nueva" label="Nueva compra" />

      {anularTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { if (!anularLoading) { setAnularTarget(null); setAnularError(null); } }}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Anular compra {anularTarget.numero_control}
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Proveedor: <strong>{anularTarget.proveedor_nombre}</strong><br/>
                Total: <strong>Gs. {Math.round(anularTarget.total).toLocaleString("es-PY")}</strong>
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Se revertirá el stock de cada producto. Si la compra tiene pagos registrados en "Pagos a proveedores", la anulación queda bloqueada — eliminá los pagos primero.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Motivo de la anulación *</label>
              <textarea
                value={anularMotivo}
                onChange={(e) => setAnularMotivo(e.target.value)}
                placeholder="Ej. Error de carga, devolución al proveedor, mercadería en mal estado…"
                rows={3}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500/30"
              />
            </div>
            {anularError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{anularError}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { if (!anularLoading) { setAnularTarget(null); setAnularError(null); } }}
                disabled={anularLoading}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={confirmarAnulacion}
                disabled={anularLoading || anularMotivo.trim().length < 3}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {anularLoading ? "Anulando…" : "Sí, anular compra"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Wrapper para agrupar fila principal + filas de detalle sin <div> en <tbody>. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
