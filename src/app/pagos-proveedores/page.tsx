"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type EstadoPago = "pendiente" | "parcial" | "pagado";

type CxPItem = {
  numero_control: string;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  fecha: string;
  total_documento: number;
  total_pagado: number;
  saldo_pendiente: number;
  dias_desde_fecha: number;
  items_count: number;
  estado_pago: EstadoPago;
};

type Summary = {
  total_documentos: number;
  total_deuda: number;
  documentos_con_saldo: number;
  vencidos_mas_30_dias: number;
};

function fmtGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function fmtFecha(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch { return "—"; }
}

const ESTADO_BADGE: Record<EstadoPago, string> = {
  pendiente: "bg-rose-100 text-rose-700",
  parcial:   "bg-amber-100 text-amber-700",
  pagado:    "bg-emerald-100 text-emerald-700",
};

type PageSize = 10 | 50 | 100 | "todos";

export default function PagosProveedoresPage() {
  const [tab, setTab] = useState<"pendientes" | "todos">("pendientes");
  const [items, setItems] = useState<CxPItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtroProveedor, setFiltroProveedor] = useState("");
  const [pageSize, setPageSize] = useState<PageSize>(50);
  const [paginaActual, setPaginaActual] = useState(0);

  // Modal "Registrar pago"
  const [modalDoc, setModalDoc] = useState<CxPItem | null>(null);
  const [pagoMonto, setPagoMonto] = useState("");
  const [pagoMetodo, setPagoMetodo] = useState<"efectivo" | "transferencia" | "tarjeta" | "cheque" | "otro">("efectivo");
  const [pagoReferencia, setPagoReferencia] = useState("");
  const [pagoObs, setPagoObs] = useState("");
  const [pagoSaving, setPagoSaving] = useState(false);
  const [pagoError, setPagoError] = useState<string | null>(null);

  // Pagos registrados del documento abierto (para mostrar arriba del form
  // con opción de eliminar uno).
  type PagoExistente = {
    id: string;
    monto: number;
    metodo_pago: string | null;
    referencia: string | null;
    fecha: string;
  };
  const [pagosDoc, setPagosDoc] = useState<PagoExistente[]>([]);
  const [pagosDocLoading, setPagosDocLoading] = useState(false);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);

  // Anulación de compra (mismo endpoint que /compras → /api/compras/anular)
  const [anularDoc, setAnularDoc] = useState<CxPItem | null>(null);
  const [anularMotivo, setAnularMotivo] = useState("");
  const [anularLoading, setAnularLoading] = useState(false);
  const [anularError, setAnularError] = useState<string | null>(null);

  async function confirmarAnulacionCompra() {
    if (!anularDoc) return;
    const motivo = anularMotivo.trim();
    if (motivo.length < 3) { setAnularError("El motivo es obligatorio (mínimo 3 caracteres)."); return; }
    setAnularLoading(true); setAnularError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/compras/anular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero_control: anularDoc.numero_control, motivo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      setAnularDoc(null); setAnularMotivo("");
      await cargar(); // refresca lista (la compra anulada deja de aparecer)
    } catch (e) {
      setAnularError(e instanceof Error ? e.message : "No se pudo anular la compra.");
    } finally {
      setAnularLoading(false);
    }
  }

  const cargarPagosDoc = useCallback(async (numeroControl: string) => {
    setPagosDocLoading(true);
    try {
      const r = await fetchWithSupabaseSession(
        `/api/compras/pagos?numero_control=${encodeURIComponent(numeroControl)}`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (j?.success) setPagosDoc((j.data?.pagos ?? []) as PagoExistente[]);
      else setPagosDoc([]);
    } catch {
      setPagosDoc([]);
    } finally {
      setPagosDocLoading(false);
    }
  }, []);

  async function eliminarPago(p: PagoExistente) {
    if (!modalDoc) return;
    if (!window.confirm(
      `¿Eliminar este pago?\n\nMonto: ${fmtGs(p.monto)} · ${p.metodo_pago ?? ""}\n${p.referencia ? `Ref: ${p.referencia}` : ""}\n\nEl saldo del documento se va a actualizar automáticamente.`
    )) return;
    setEliminandoId(p.id);
    try {
      const r = await fetchWithSupabaseSession(`/api/compras/pagos/${p.id}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      // Refrescar pagos del modal Y la lista de docs (saldo cambió).
      await cargarPagosDoc(modalDoc.numero_control);
      await cargar();
    } catch (e) {
      setPagoError(e instanceof Error ? e.message : "No se pudo eliminar el pago.");
    } finally {
      setEliminandoId(null);
    }
  }

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const url = tab === "todos" ? "/api/compras/cuentas-por-pagar?incluir=pagados" : "/api/compras/cuentas-por-pagar";
      const r = await fetchWithSupabaseSession(url, { cache: "no-store" });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error ?? "Error al cargar");
      setItems((j.data?.items ?? []) as CxPItem[]);
      setSummary((j.data?.summary ?? null) as Summary | null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
      setItems([]);
      setSummary(null);
    } finally {
      setCargando(false);
    }
  }, [tab]);

  useEffect(() => { void cargar(); }, [cargar]);

  const filtrados = useMemo(() => {
    const q = filtroProveedor.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => (i.proveedor_nombre ?? "").toLowerCase().includes(q) || i.numero_control.toLowerCase().includes(q));
  }, [items, filtroProveedor]);

  useEffect(() => { setPaginaActual(0); }, [tab, filtroProveedor, pageSize]);

  const totalPaginas = pageSize === "todos" ? 1 : Math.max(1, Math.ceil(filtrados.length / pageSize));
  const paginaSegura = Math.min(paginaActual, totalPaginas - 1);
  const visibles = pageSize === "todos" ? filtrados : filtrados.slice(paginaSegura * pageSize, (paginaSegura + 1) * pageSize);

  function abrirPago(d: CxPItem) {
    setModalDoc(d);
    setPagoMonto(String(d.saldo_pendiente));
    setPagoMetodo("efectivo");
    setPagoReferencia("");
    setPagoObs("");
    setPagoError(null);
    setPagosDoc([]);
    void cargarPagosDoc(d.numero_control);
  }

  async function registrarPago(e: React.FormEvent) {
    e.preventDefault();
    if (!modalDoc) return;
    const monto = parseFloat(pagoMonto);
    if (!Number.isFinite(monto) || monto <= 0) { setPagoError("Monto inválido."); return; }
    if (monto > modalDoc.saldo_pendiente) {
      setPagoError(`El monto (${fmtGs(monto)}) supera el saldo pendiente (${fmtGs(modalDoc.saldo_pendiente)}).`);
      return;
    }
    setPagoSaving(true);
    try {
      const r = await fetchWithSupabaseSession("/api/compras/pagos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero_control: modalDoc.numero_control,
          proveedor_id: modalDoc.proveedor_id,
          proveedor_nombre: modalDoc.proveedor_nombre,
          monto,
          metodo_pago: pagoMetodo,
          referencia: pagoReferencia || null,
          observaciones: pagoObs || null,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "Error al registrar el pago");
      setModalDoc(null);
      await cargar();
    } catch (err) {
      setPagoError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setPagoSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Zentra · Finanzas"
        title="Pagos a proveedores"
        description="Cuentas por pagar: documentos de compra pendientes y registro de pagos"
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard compact label="Documentos pendientes" value={String(summary?.documentos_con_saldo ?? 0)} accent
          hint="con saldo > 0" />
        <StatCard compact label="Deuda total" value={fmtGs(summary?.total_deuda ?? 0)}
          hint="suma de saldos" />
        <StatCard compact label="Vencidos +30 días" value={String(summary?.vencidos_mas_30_dias ?? 0)}
          hint="por antigüedad" />
        <StatCard compact label="Documentos totales" value={String(summary?.total_documentos ?? 0)}
          hint={tab === "todos" ? "incluye pagados" : "solo con saldo"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          <button onClick={() => setTab("pendientes")}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === "pendientes" ? "bg-[#4FAEB2] text-white" : "text-slate-600 hover:bg-slate-50"}`}>
            Pendientes
          </button>
          <button onClick={() => setTab("todos")}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === "todos" ? "bg-[#4FAEB2] text-white" : "text-slate-600 hover:bg-slate-50"}`}>
            Todos
          </button>
        </div>
        <input
          type="text"
          value={filtroProveedor}
          onChange={(e) => setFiltroProveedor(e.target.value)}
          placeholder="Buscar por proveedor o N° de control…"
          className="flex-1 min-w-[14rem] max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30"
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">N° Control</th>
                <th className="px-4 py-3 text-left">Proveedor</th>
                <th className="px-4 py-3 text-right">Fecha</th>
                <th className="px-4 py-3 text-right">Total doc.</th>
                <th className="px-4 py-3 text-right">Pagado</th>
                <th className="px-4 py-3 text-right">Saldo</th>
                <th className="px-4 py-3 text-center">Antig.</th>
                <th className="px-4 py-3 text-center">Estado</th>
                <th className="px-4 py-3 text-center">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-sm text-slate-400">
                    <div className="inline-flex items-center gap-2">
                      <svg className="h-4 w-4 animate-spin text-[#4FAEB2]" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Cargando cuentas por pagar…
                    </div>
                  </td>
                </tr>
              )}
              {!cargando && error && (
                <tr><td colSpan={9} className="py-12 text-center text-sm text-red-600">{error}</td></tr>
              )}
              {!cargando && !error && visibles.length === 0 && (
                <tr><td colSpan={9} className="py-12 text-center text-sm text-slate-400">
                  {tab === "pendientes" ? "No hay cuentas pendientes 👌" : "Sin documentos de compra."}
                </td></tr>
              )}
              {!cargando && !error && visibles.map((d) => (
                <tr key={d.numero_control} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    <Link href={`/compras?nc=${encodeURIComponent(d.numero_control)}`} className="hover:underline">
                      {d.numero_control}
                    </Link>
                    <span className="ml-2 text-[10px] text-slate-400">({d.items_count} items)</span>
                  </td>
                  <td className="px-4 py-3 text-slate-800">{d.proveedor_nombre ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{fmtFecha(d.fecha)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtGs(d.total_documento)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{fmtGs(d.total_pagado)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">{fmtGs(d.saldo_pendiente)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs tabular-nums ${d.dias_desde_fecha > 90 ? "text-red-600 font-semibold" : d.dias_desde_fecha > 30 ? "text-amber-600" : "text-slate-500"}`}>
                      {d.dias_desde_fecha}d
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${ESTADO_BADGE[d.estado_pago]}`}>
                      {d.estado_pago === "pendiente" ? "Pendiente" : d.estado_pago === "parcial" ? "Parcial" : "Pagado"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {d.saldo_pendiente > 0 ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button onClick={() => abrirPago(d)}
                          className="rounded-md bg-[#4FAEB2] px-3 py-1 text-xs font-medium text-white hover:bg-[#3F8E91]">
                          Registrar pago
                        </button>
                        <button onClick={() => { setAnularDoc(d); setAnularMotivo(""); setAnularError(null); }}
                          className="rounded-md border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                          title="Anular compra (reversa stock)">
                          Anular
                        </button>
                      </div>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paginación */}
      {filtrados.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2 text-slate-600">
            <label className="text-xs text-slate-500">Mostrar</label>
            <select value={String(pageSize)}
              onChange={(e) => setPageSize(e.target.value === "todos" ? "todos" : (parseInt(e.target.value) as 10 | 50 | 100))}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
              <option value="10">10</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="todos">Todos</option>
            </select>
            <span className="text-xs text-slate-400">
              {pageSize === "todos"
                ? `${filtrados.length} documento(s)`
                : `${paginaSegura * pageSize + 1}–${Math.min((paginaSegura + 1) * pageSize, filtrados.length)} de ${filtrados.length}`}
            </span>
          </div>
          {pageSize !== "todos" && totalPaginas > 1 && (
            <div className="flex items-center gap-1">
              <button onClick={() => setPaginaActual((p) => Math.max(0, p - 1))} disabled={paginaSegura === 0}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs disabled:opacity-40">‹ Anterior</button>
              <span className="px-3 text-xs tabular-nums">Página <b>{paginaSegura + 1}</b> de {totalPaginas}</span>
              <button onClick={() => setPaginaActual((p) => Math.min(totalPaginas - 1, p + 1))} disabled={paginaSegura >= totalPaginas - 1}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs disabled:opacity-40">Siguiente ›</button>
            </div>
          )}
        </div>
      )}

      {/* Modal: Registrar pago */}
      {modalDoc && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => !pagoSaving && setModalDoc(null)}>
          <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="text-base font-semibold text-slate-800">Registrar pago</h3>
              <button onClick={() => !pagoSaving && setModalDoc(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">✕</button>
            </div>
            <form onSubmit={registrarPago} className="space-y-3 px-5 py-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <div><b>{modalDoc.proveedor_nombre ?? "—"}</b></div>
                <div className="font-mono">N° {modalDoc.numero_control}</div>
                <div className="mt-1">
                  Total <b>{fmtGs(modalDoc.total_documento)}</b> · Pagado {fmtGs(modalDoc.total_pagado)} ·
                  <span className="text-rose-600 font-semibold"> Saldo {fmtGs(modalDoc.saldo_pendiente)}</span>
                </div>
              </div>

              {/* Pagos ya registrados — con botón eliminar por cada uno */}
              {pagosDocLoading ? (
                <div className="text-xs text-slate-400">Cargando pagos…</div>
              ) : pagosDoc.length > 0 ? (
                <div className="rounded-md border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Pagos registrados ({pagosDoc.length})
                  </div>
                  <ul className="divide-y divide-slate-100 max-h-40 overflow-y-auto">
                    {pagosDoc.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold tabular-nums text-slate-800">{fmtGs(p.monto)}</div>
                          <div className="text-[11px] text-slate-500">
                            {p.metodo_pago ?? "—"}
                            {p.referencia ? ` · ${p.referencia}` : ""}
                            {p.fecha ? ` · ${new Date(p.fecha).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" })}` : ""}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => eliminarPago(p)}
                          disabled={eliminandoId === p.id}
                          className="shrink-0 rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          {eliminandoId === p.id ? "…" : "Eliminar"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {pagoError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{pagoError}</div>}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Monto a pagar</label>
                <input type="number" min="0" step="0.01" value={pagoMonto} onChange={(e) => setPagoMonto(e.target.value)} autoFocus
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Método de pago</label>
                <select value={pagoMetodo} onChange={(e) => setPagoMetodo(e.target.value as "efectivo" | "transferencia" | "tarjeta" | "cheque" | "otro")}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="cheque">Cheque</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Referencia (opcional)</label>
                <input type="text" value={pagoReferencia} onChange={(e) => setPagoReferencia(e.target.value)}
                  placeholder="N° de cheque / transferencia"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Observaciones</label>
                <textarea value={pagoObs} onChange={(e) => setPagoObs(e.target.value)} rows={2}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModalDoc(null)} disabled={pagoSaving}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancelar</button>
                <button type="submit" disabled={pagoSaving || !pagoMonto}
                  className="rounded-md bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50">
                  {pagoSaving ? "Guardando…" : "Registrar pago"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Anular compra */}
      {anularDoc && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
          onClick={() => { if (!anularLoading) { setAnularDoc(null); setAnularError(null); } }}>
          <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="text-base font-semibold text-slate-800">
                Anular compra {anularDoc.numero_control}
              </h3>
              <button onClick={() => { if (!anularLoading) { setAnularDoc(null); setAnularError(null); } }}
                className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">✕</button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <div><b>{anularDoc.proveedor_nombre ?? "—"}</b></div>
                <div>Total: <b>{fmtGs(anularDoc.total_documento)}</b></div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Se revertirá el stock de cada producto. Si la compra tiene pagos registrados, eliminálos primero desde "Registrar pago" → lista de pagos.
                </div>
              </div>
              {anularError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{anularError}</div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Motivo de la anulación *</label>
                <textarea value={anularMotivo} onChange={(e) => setAnularMotivo(e.target.value)} rows={3}
                  placeholder="Ej. Error de carga, devolución al proveedor…"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => { if (!anularLoading) { setAnularDoc(null); setAnularError(null); } }}
                  disabled={anularLoading}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  Volver
                </button>
                <button type="button" onClick={confirmarAnulacionCompra}
                  disabled={anularLoading || anularMotivo.trim().length < 3}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                  {anularLoading ? "Anulando…" : "Sí, anular compra"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
