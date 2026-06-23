"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2, Plus, X } from "lucide-react";

type Compatibilidad = {
  id: string;
  producto_id: string;
  marca_vehiculo: string;
  modelo_vehiculo: string;
  anio_desde: number | null;
  anio_hasta: number | null;
  motor: string | null;
  version: string | null;
  observacion: string | null;
  created_at: string;
};

type Props = {
  productoId: string;
  /** Opcional: aviso para el padre cuando cambia la cantidad. */
  onCountChange?: (count: number) => void;
};

/**
 * Editor de vehículos compatibles para un producto (autopartes).
 * Lee de /api/productos/{id}/compatibilidades. Permite agregar y eliminar.
 */
export default function CompatibilidadVehicularEditor({ productoId, onCountChange }: Props) {
  const [items, setItems] = useState<Compatibilidad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    marca_vehiculo: "",
    modelo_vehiculo: "",
    anio_desde: "",
    anio_hasta: "",
    motor: "",
    version: "",
    observacion: "",
  });

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/productos/${encodeURIComponent(productoId)}/compatibilidades`, {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error((json as { error?: string })?.error ?? `Error ${res.status}`);
      }
      const list = ((json.data?.compatibilidades ?? []) as Compatibilidad[]) || [];
      setItems(list);
      onCountChange?.(list.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las compatibilidades.");
    } finally {
      setLoading(false);
    }
  }, [productoId, onCountChange]);

  useEffect(() => {
    if (!productoId) return;
    void reload();
  }, [productoId, reload]);

  function resetForm() {
    setForm({
      marca_vehiculo: "",
      modelo_vehiculo: "",
      anio_desde: "",
      anio_hasta: "",
      motor: "",
      version: "",
      observacion: "",
    });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.marca_vehiculo.trim() || !form.modelo_vehiculo.trim()) {
      setError("Marca y modelo son obligatorios.");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(`/api/productos/${encodeURIComponent(productoId)}/compatibilidades`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          marca_vehiculo: form.marca_vehiculo.trim(),
          modelo_vehiculo: form.modelo_vehiculo.trim(),
          anio_desde: form.anio_desde.trim() === "" ? null : parseInt(form.anio_desde) || null,
          anio_hasta: form.anio_hasta.trim() === "" ? null : parseInt(form.anio_hasta) || null,
          motor: form.motor.trim() || null,
          version: form.version.trim() || null,
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
      setError(e instanceof Error ? e.message : "No se pudo agregar la compatibilidad.");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(compatId: string) {
    if (!window.confirm("¿Eliminar esta compatibilidad?")) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/productos/${encodeURIComponent(productoId)}/compatibilidades/${encodeURIComponent(compatId)}`,
        { method: "DELETE", credentials: "include" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error((json as { error?: string })?.error ?? `Error ${res.status}`);
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar la compatibilidad.");
    }
  }

  function formatRango(c: Compatibilidad): string {
    if (c.anio_desde && c.anio_hasta) return `${c.anio_desde}–${c.anio_hasta}`;
    if (c.anio_desde) return `${c.anio_desde}+`;
    if (c.anio_hasta) return `hasta ${c.anio_hasta}`;
    return "—";
  }

  const inputCls =
    "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">
          Vehículos compatibles {items.length > 0 && <span className="font-normal text-slate-400">({items.length})</span>}
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
            <input
              type="text" placeholder="Marca vehículo *"
              value={form.marca_vehiculo}
              onChange={(e) => setForm((p) => ({ ...p, marca_vehiculo: e.target.value }))}
              className={inputCls}
            />
            <input
              type="text" placeholder="Modelo *"
              value={form.modelo_vehiculo}
              onChange={(e) => setForm((p) => ({ ...p, modelo_vehiculo: e.target.value }))}
              className={inputCls}
            />
            <input
              type="number" placeholder="Año desde" min={1900} max={2100}
              value={form.anio_desde}
              onChange={(e) => setForm((p) => ({ ...p, anio_desde: e.target.value }))}
              className={inputCls}
            />
            <input
              type="number" placeholder="Año hasta" min={1900} max={2100}
              value={form.anio_hasta}
              onChange={(e) => setForm((p) => ({ ...p, anio_hasta: e.target.value }))}
              className={inputCls}
            />
            <input
              type="text" placeholder="Motor (ej. 2.8 TDI)"
              value={form.motor}
              onChange={(e) => setForm((p) => ({ ...p, motor: e.target.value }))}
              className={inputCls}
            />
            <input
              type="text" placeholder="Versión / variante"
              value={form.version}
              onChange={(e) => setForm((p) => ({ ...p, version: e.target.value }))}
              className={inputCls}
            />
            <input
              type="text" placeholder="Observación" className={`${inputCls} sm:col-span-2`}
              value={form.observacion}
              onChange={(e) => setForm((p) => ({ ...p, observacion: e.target.value }))}
            />
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
        <p className="text-xs text-slate-400">Sin vehículos compatibles cargados.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
          {items.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800">
                  {c.marca_vehiculo} {c.modelo_vehiculo}{" "}
                  <span className="font-normal text-slate-500">({formatRango(c)})</span>
                </p>
                {(c.motor || c.version) && (
                  <p className="text-xs text-slate-500">
                    {[c.motor, c.version].filter(Boolean).join(" · ")}
                  </p>
                )}
                {c.observacion && <p className="text-xs italic text-slate-400">{c.observacion}</p>}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(c.id)}
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
