"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2, Plus, X, Car } from "lucide-react";

type Vehiculo = {
  id: string;
  cliente_id: string;
  marca: string;
  modelo: string;
  anio: number | null;
  motor: string | null;
  chapa: string | null;
  observacion: string | null;
  activo: boolean;
  created_at: string;
};

type Props = {
  clienteId: string;
  onCountChange?: (count: number) => void;
};

/**
 * Editor de vehículos del cliente (rubro autopartes).
 * Lee de /api/clientes/{id}/vehiculos. CRUD básico (agregar / soft-delete).
 */
export default function ClienteVehiculoEditor({ clienteId, onCountChange }: Props) {
  const [items, setItems] = useState<Vehiculo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    marca: "",
    modelo: "",
    anio: "",
    motor: "",
    chapa: "",
    observacion: "",
  });

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clientes/${encodeURIComponent(clienteId)}/vehiculos`, {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error((json as { error?: string })?.error ?? `Error ${res.status}`);
      }
      const list = ((json.data?.vehiculos ?? []) as Vehiculo[]) || [];
      setItems(list);
      onCountChange?.(list.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los vehículos.");
    } finally {
      setLoading(false);
    }
  }, [clienteId, onCountChange]);

  useEffect(() => {
    if (!clienteId) return;
    void reload();
  }, [clienteId, reload]);

  function resetForm() {
    setForm({ marca: "", modelo: "", anio: "", motor: "", chapa: "", observacion: "" });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.marca.trim() || !form.modelo.trim()) {
      setError("Marca y modelo son obligatorios.");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(`/api/clientes/${encodeURIComponent(clienteId)}/vehiculos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          marca: form.marca.trim(),
          modelo: form.modelo.trim(),
          anio: form.anio.trim() === "" ? null : parseInt(form.anio) || null,
          motor: form.motor.trim() || null,
          chapa: form.chapa.trim() || null,
          observacion: form.observacion.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error((json as { error?: string })?.error ?? `Error ${res.status}`);
      }
      resetForm();
      setFormOpen(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo agregar el vehículo.");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(vehId: string) {
    if (!window.confirm("¿Eliminar este vehículo del cliente?")) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/clientes/${encodeURIComponent(clienteId)}/vehiculos/${encodeURIComponent(vehId)}`,
        { method: "DELETE", credentials: "include" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error((json as { error?: string })?.error ?? `Error ${res.status}`);
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar el vehículo.");
    }
  }

  const inputCls =
    "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Car className="h-4 w-4 text-slate-500" />
          Vehículos del cliente {items.length > 0 && <span className="font-normal text-slate-400">({items.length})</span>}
        </h4>
        {!formOpen ? (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-[#4FAEB2] bg-white px-2.5 py-1 text-xs font-medium text-[#4FAEB2] hover:bg-[#4FAEB2]/5"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { setFormOpen(false); resetForm(); setError(null); }}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <X className="h-3.5 w-3.5" /> Cancelar
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {formOpen && (
        <form onSubmit={handleAdd} className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input type="text" placeholder="Marca *" value={form.marca}
              onChange={(e) => setForm((p) => ({ ...p, marca: e.target.value }))} className={inputCls} />
            <input type="text" placeholder="Modelo *" value={form.modelo}
              onChange={(e) => setForm((p) => ({ ...p, modelo: e.target.value }))} className={inputCls} />
            <input type="number" placeholder="Año" min={1900} max={2100} value={form.anio}
              onChange={(e) => setForm((p) => ({ ...p, anio: e.target.value }))} className={inputCls} />
            <input type="text" placeholder="Motor (ej. 2.8 TDI)" value={form.motor}
              onChange={(e) => setForm((p) => ({ ...p, motor: e.target.value }))} className={inputCls} />
            <input type="text" placeholder="Chapa" value={form.chapa}
              onChange={(e) => setForm((p) => ({ ...p, chapa: e.target.value.toUpperCase() }))} className={inputCls} />
            <input type="text" placeholder="Observación" value={form.observacion}
              onChange={(e) => setForm((p) => ({ ...p, observacion: e.target.value }))} className={inputCls} />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={adding}
              className="rounded-md bg-[#4FAEB2] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50"
            >
              {adding ? "Agregando..." : "Agregar vehículo"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-xs text-slate-400">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-400">El cliente no tiene vehículos registrados.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
          {items.map((v) => (
            <li key={v.id} className="flex items-start justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800">
                  {v.marca} {v.modelo}
                  {v.anio ? <span className="font-normal text-slate-500"> · {v.anio}</span> : null}
                  {v.chapa ? <span className="ml-2 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-slate-700">{v.chapa}</span> : null}
                </p>
                {v.motor && <p className="text-xs text-slate-500">Motor: {v.motor}</p>}
                {v.observacion && <p className="text-xs italic text-slate-400">{v.observacion}</p>}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(v.id)}
                title="Eliminar"
                className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
