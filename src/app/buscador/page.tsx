"use client";

/**
 * Módulo "Consulta y envío a caja" — flujo para vendedor de salón.
 *
 * Flujo:
 *   1. Buscar producto (nombre/SKU/OEM/marca).
 *   2. Ver stock, ubicación física, compatibilidades y precios.
 *   3. Agregar al "carrito" del pedido (cantidad + tipo de precio).
 *   4. Opcional: elegir cliente.
 *   5. "Enviar a caja" → aparece en /ventas como pedido pendiente.
 *   6. Listado de "mis pedidos" abajo: estado pendiente / facturado.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getClientes } from "@/lib/clientes/storage";
import type { Cliente } from "@/lib/clientes/types";
import { Search, MapPin, Car, Trash2, Send, Loader2, CheckCircle2, Clock } from "lucide-react";

type ProductoHit = {
  id: string;
  nombre: string;
  sku: string;
  codigo_oem: string | null;
  codigo_alternativo: string | null;
  marca_repuesto: string | null;
  precio_venta: number;
  precio_mayorista: number;
  stock_actual: number;
  ubicacion_deposito?: string | null;
  ubicacion_pasillo?: string | null;
  ubicacion_estante?: string | null;
  ubicacion_caja?: string | null;
};

type Compatibilidad = {
  id: string;
  marca_vehiculo: string;
  modelo_vehiculo: string;
  anio_desde: number | null;
  anio_hasta: number | null;
};

type CartItem = {
  producto_id: string;
  producto_nombre: string;
  sku: string;
  stock_actual: number;
  cantidad: number;
  tipo_precio: "minorista" | "mayorista";
  precio_venta: number;
  precio_mayorista: number;
};

type MiPedido = {
  id: string;
  titulo: string;
  cliente_nombre: string | null;
  total_estimado: number;
  items_count: number;
  estado_facturacion: "pendiente_caja" | "facturado";
  venta_numero: string | null;
  created_at: string | null;
  facturado_at: string | null;
};

function fmtGs(v: number) {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}

function ubicacionTexto(p: ProductoHit) {
  const parts: string[] = [];
  if (p.ubicacion_deposito) parts.push(p.ubicacion_deposito);
  if (p.ubicacion_pasillo) parts.push(`P:${p.ubicacion_pasillo}`);
  if (p.ubicacion_estante) parts.push(`E:${p.ubicacion_estante}`);
  if (p.ubicacion_caja) parts.push(`C:${p.ubicacion_caja}`);
  return parts.length ? parts.join(" · ") : null;
}

function fmtFecha(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit" }) +
      " " + d.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export default function BuscadorPage() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductoHit[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [seleccionado, setSeleccionado] = useState<ProductoHit | null>(null);
  const [compat, setCompat] = useState<Compatibilidad[]>([]);
  const [cargandoCompat, setCargandoCompat] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState<string>("");
  const [enviando, setEnviando] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [misPedidos, setMisPedidos] = useState<MiPedido[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Búsqueda con debounce ──────────────────────────────────────────────
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) { setHits([]); return; }
    let cancel = false;
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await fetchWithSupabaseSession(
          `/api/productos/search?q=${encodeURIComponent(trimmed)}&limit=30`,
          { cache: "no-store" }
        );
        const j = await res.json();
        if (cancel) return;
        // /api/productos/search no devuelve ubicación; complementamos con /api/productos
        // si el cliente lo pidió. Por ahora levantamos ubicación con un GET masivo
        // (lo hacemos por id sobre los hits).
        const baseHits: ProductoHit[] = (j?.data?.items ?? []).map((p: Record<string, unknown>) => ({
          id: String(p.id),
          nombre: String(p.nombre ?? ""),
          sku: String(p.sku ?? ""),
          codigo_oem: (p.codigo_oem as string | null) ?? null,
          codigo_alternativo: (p.codigo_alternativo as string | null) ?? null,
          marca_repuesto: (p.marca_repuesto as string | null) ?? null,
          precio_venta: Number(p.precio_venta) || 0,
          precio_mayorista: Number(p.precio_mayorista) || 0,
          stock_actual: Number(p.stock_actual) || 0,
        }));
        // Enriquecer con ubicación leyendo /api/productos (que sí trae los 4 campos).
        if (baseHits.length > 0) {
          try {
            const rPro = await fetchWithSupabaseSession("/api/productos", { cache: "no-store" });
            const jPro = await rPro.json();
            const all: Record<string, Record<string, unknown>> = {};
            for (const p of (jPro?.data?.productos ?? [])) {
              all[String((p as { id: string }).id)] = p as Record<string, unknown>;
            }
            for (const h of baseHits) {
              const x = all[h.id];
              if (x) {
                h.ubicacion_deposito = (x.ubicacion_deposito as string | null) ?? null;
                h.ubicacion_pasillo = (x.ubicacion_pasillo as string | null) ?? null;
                h.ubicacion_estante = (x.ubicacion_estante as string | null) ?? null;
                h.ubicacion_caja = (x.ubicacion_caja as string | null) ?? null;
              }
            }
          } catch { /* opcional */ }
        }
        setHits(baseHits);
      } finally {
        if (!cancel) setBuscando(false);
      }
    }, 250);
    return () => { cancel = true; clearTimeout(t); };
  }, [q]);

  // ── Compatibilidad del producto seleccionado ──────────────────────────
  useEffect(() => {
    if (!seleccionado) { setCompat([]); return; }
    let cancel = false;
    setCargandoCompat(true);
    fetchWithSupabaseSession(`/api/productos/${seleccionado.id}/compatibilidades`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancel) setCompat((j?.data?.items ?? []) as Compatibilidad[]); })
      .finally(() => { if (!cancel) setCargandoCompat(false); });
    return () => { cancel = true; };
  }, [seleccionado]);

  // ── Cargas iniciales ──────────────────────────────────────────────────
  useEffect(() => {
    getClientes().then(setClientes).catch(() => setClientes([]));
    void refreshMisPedidos();
    inputRef.current?.focus();
  }, []);

  const refreshMisPedidos = useCallback(async () => {
    try {
      const r = await fetchWithSupabaseSession("/api/buscador/mis-pedidos", { cache: "no-store" });
      const j = await r.json();
      if (j?.success) setMisPedidos((j.data?.pedidos ?? []) as MiPedido[]);
    } catch { /* opcional */ }
  }, []);

  // ── Carrito ───────────────────────────────────────────────────────────
  function addToCart(p: ProductoHit) {
    setCart((prev) => {
      const ex = prev.find((x) => x.producto_id === p.id);
      if (ex) return prev.map((x) => x.producto_id === p.id ? { ...x, cantidad: x.cantidad + 1 } : x);
      return [...prev, {
        producto_id: p.id,
        producto_nombre: p.nombre,
        sku: p.sku,
        stock_actual: p.stock_actual,
        cantidad: 1,
        tipo_precio: "minorista",
        precio_venta: p.precio_venta,
        precio_mayorista: p.precio_mayorista,
      }];
    });
    setOkMsg(null); setErrMsg(null);
  }

  function updateCart(id: string, patch: Partial<CartItem>) {
    setCart((prev) => prev.map((x) => x.producto_id === id ? { ...x, ...patch } : x));
  }
  function removeFromCart(id: string) {
    setCart((prev) => prev.filter((x) => x.producto_id !== id));
  }

  const totalCart = useMemo(
    () => cart.reduce((s, it) => s + it.cantidad * (it.tipo_precio === "mayorista" ? it.precio_mayorista : it.precio_venta), 0),
    [cart]
  );

  async function enviar() {
    if (cart.length === 0) { setErrMsg("El pedido está vacío."); return; }
    setEnviando(true); setErrMsg(null); setOkMsg(null);
    try {
      const cliente = clientes.find((c) => c.id === clienteId);
      const nombreCli = cliente ? (cliente.empresa || cliente.nombre_contacto || null) : null;
      const body = {
        cliente_id: clienteId || null,
        cliente_nombre: nombreCli,
        cliente_telefono: cliente?.telefono ?? null,
        items: cart.map((it) => ({
          producto_id: it.producto_id,
          producto_nombre: it.producto_nombre,
          sku: it.sku,
          cantidad: it.cantidad,
          precio_venta: it.tipo_precio === "mayorista" ? it.precio_mayorista : it.precio_venta,
          tipo_precio: it.tipo_precio,
        })),
      };
      const r = await fetchWithSupabaseSession("/api/buscador/enviar-a-caja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      setOkMsg(`Pedido "${j.data.titulo}" enviado a caja.`);
      setCart([]); setClienteId("");
      void refreshMisPedidos();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "No se pudo enviar el pedido.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Zentra · Salón"
        title="Consulta de productos"
        description="Buscá un repuesto, verificá stock y ubicación, y mandá el pedido a caja para cobrar."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* COLUMNA IZQUIERDA: Buscador + resultados + detalle */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <Search className="h-5 w-5 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre, SKU, OEM o marca…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
              autoComplete="off"
            />
            {buscando && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          </div>

          {q.trim().length < 2 ? (
            <p className="text-sm text-slate-400 px-1">Escribí al menos 2 caracteres para buscar.</p>
          ) : hits.length === 0 && !buscando ? (
            <p className="text-sm text-slate-400 px-1">Sin resultados para "{q}".</p>
          ) : (
            <ul className="space-y-2">
              {hits.map((p) => {
                const ub = ubicacionTexto(p);
                return (
                  <li
                    key={p.id}
                    onClick={() => setSeleccionado(p)}
                    className={`cursor-pointer rounded-xl border bg-white p-4 shadow-sm transition-colors ${
                      seleccionado?.id === p.id ? "border-[#4FAEB2] ring-2 ring-[#4FAEB2]/20" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-medium text-slate-900 truncate">{p.nombre}</h3>
                          {p.marca_repuesto && <span className="text-[10px] font-semibold uppercase tracking-wide text-[#3F8E91] bg-[#4FAEB2]/10 px-1.5 py-0.5 rounded">{p.marca_repuesto}</span>}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                          <span className="font-mono">{p.sku}</span>
                          {p.codigo_oem && <span>OEM: <span className="font-mono text-slate-700">{p.codigo_oem}</span></span>}
                          {p.codigo_alternativo && <span>ALT: <span className="font-mono text-slate-700">{p.codigo_alternativo}</span></span>}
                        </div>
                        {ub && (
                          <div className="mt-1 flex items-center gap-1 text-xs text-slate-600">
                            <MapPin className="h-3 w-3 text-slate-400" />
                            <span>{ub}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-xs font-medium ${p.stock_actual <= 0 ? "text-red-600" : p.stock_actual < 5 ? "text-amber-600" : "text-emerald-700"}`}>
                          {p.stock_actual <= 0 ? "Sin stock" : `${p.stock_actual} u`}
                        </div>
                        <div className="mt-1 text-sm font-bold text-slate-900 tabular-nums">{fmtGs(p.precio_venta)}</div>
                        {p.precio_mayorista > 0 && p.precio_mayorista !== p.precio_venta && (
                          <div className="text-[11px] text-slate-500 tabular-nums">May: {fmtGs(p.precio_mayorista)}</div>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                      {seleccionado?.id === p.id ? (
                        <div className="text-xs text-slate-500">
                          {cargandoCompat ? "Cargando compatibilidades…" :
                            compat.length === 0 ? "Sin vehículos asociados" :
                              <span className="flex items-center gap-1 flex-wrap">
                                <Car className="h-3 w-3" />
                                {compat.slice(0, 3).map((c, i) => (
                                  <span key={c.id} className="rounded-full bg-slate-100 px-1.5 py-0.5">
                                    {c.marca_vehiculo} {c.modelo_vehiculo}{c.anio_desde ? ` ${c.anio_desde}${c.anio_hasta ? `-${c.anio_hasta}` : "+"}` : ""}
                                    {i < Math.min(2, compat.length - 1) ? "" : ""}
                                  </span>
                                ))}
                                {compat.length > 3 && <span className="text-slate-400">+{compat.length - 3}</span>}
                              </span>}
                        </div>
                      ) : <span className="text-xs text-slate-400">Click para ver compatibilidades</span>}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); addToCart(p); }}
                        disabled={p.stock_actual <= 0}
                        className="shrink-0 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:bg-slate-300 disabled:cursor-not-allowed"
                      >
                        Agregar al pedido
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* COLUMNA DERECHA: Carrito + enviar */}
        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm h-fit sticky top-4">
          <h2 className="text-sm font-semibold text-slate-900">Pedido a armar</h2>
          <p className="text-xs text-slate-500">Cuando termines, lo mandás a caja para que se cobre.</p>

          {cart.length === 0 ? (
            <p className="mt-6 text-center text-sm text-slate-400">No hay productos.<br/>Buscá uno y agregalo.</p>
          ) : (
            <>
              <ul className="mt-3 space-y-2 max-h-80 overflow-y-auto">
                {cart.map((it) => {
                  const precio = it.tipo_precio === "mayorista" ? it.precio_mayorista : it.precio_venta;
                  return (
                    <li key={it.producto_id} className="rounded-lg border border-slate-200 p-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-800 truncate">{it.producto_nombre}</p>
                          <p className="text-[11px] text-slate-500 font-mono">{it.sku}</p>
                        </div>
                        <button onClick={() => removeFromCart(it.producto_id)} className="text-slate-400 hover:text-red-500" aria-label="Quitar">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-1.5">
                        <div>
                          <label className="block text-[10px] uppercase text-slate-400 mb-0.5">Cant.</label>
                          <input
                            type="number"
                            min={1}
                            max={Math.max(1, it.stock_actual)}
                            value={it.cantidad}
                            onChange={(e) => updateCart(it.producto_id, { cantidad: Math.max(1, parseInt(e.target.value) || 1) })}
                            className="w-full rounded border border-slate-200 px-1.5 py-1 text-center tabular-nums"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-[10px] uppercase text-slate-400 mb-0.5">Precio</label>
                          <select
                            value={it.tipo_precio}
                            onChange={(e) => updateCart(it.producto_id, { tipo_precio: e.target.value as "minorista" | "mayorista" })}
                            className="w-full rounded border border-slate-200 px-1.5 py-1 text-[11px]"
                          >
                            <option value="minorista">Minorista ({fmtGs(it.precio_venta)})</option>
                            {it.precio_mayorista > 0 && it.precio_mayorista !== it.precio_venta &&
                              <option value="mayorista">Mayorista ({fmtGs(it.precio_mayorista)})</option>}
                          </select>
                        </div>
                      </div>
                      <div className="mt-1.5 text-right text-[11px] font-semibold text-slate-700 tabular-nums">
                        Subtotal: {fmtGs(it.cantidad * precio)}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-3 border-t border-slate-200 pt-3 space-y-2">
                <div>
                  <label className="block text-[10px] uppercase text-slate-400 mb-1">Cliente (opcional)</label>
                  <select
                    value={clienteId}
                    onChange={(e) => setClienteId(e.target.value)}
                    className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs"
                  >
                    <option value="">— Sin cliente —</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>{c.empresa || c.nombre_contacto || "Cliente"}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between text-sm border-t border-slate-200 pt-2">
                  <span className="font-medium text-slate-700">Total:</span>
                  <span className="font-bold tabular-nums text-slate-900">{fmtGs(totalCart)}</span>
                </div>

                {errMsg && <p className="text-xs text-red-600">{errMsg}</p>}
                {okMsg && <p className="text-xs text-emerald-700">{okMsg}</p>}

                <button
                  type="button"
                  onClick={enviar}
                  disabled={enviando || cart.length === 0}
                  className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                >
                  {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Enviar a caja
                </button>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* MIS PEDIDOS */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Mis pedidos enviados</h2>
          <p className="text-xs text-slate-500">Últimos 50 — pendientes en caja y ya facturados.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-left">Pedido</th>
                <th className="px-4 py-2.5 text-left">Cliente</th>
                <th className="px-4 py-2.5 text-right">Items</th>
                <th className="px-4 py-2.5 text-right">Total</th>
                <th className="px-4 py-2.5 text-left">Estado</th>
                <th className="px-4 py-2.5 text-left">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {misPedidos.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-slate-400">Todavía no enviaste ningún pedido.</td></tr>
              ) : misPedidos.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{p.titulo}</td>
                  <td className="px-4 py-2.5 text-slate-600">{p.cliente_nombre ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{p.items_count}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">{fmtGs(p.total_estimado)}</td>
                  <td className="px-4 py-2.5">
                    {p.estado_facturacion === "facturado" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" />
                        Cobrado{p.venta_numero ? ` · ${p.venta_numero}` : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        <Clock className="h-3 w-3" />
                        Pendiente
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{fmtFecha(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
