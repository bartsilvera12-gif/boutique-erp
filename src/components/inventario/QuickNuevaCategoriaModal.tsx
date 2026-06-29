"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

export type QuickCategoria = { id: string; nombre: string };

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (categoria: QuickCategoria) => void;
};

export default function QuickNuevaCategoriaModal({ open, onClose, onCreated }: Props) {
  const [nombre, setNombre] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNombre("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const nom = nombre.trim();
    if (!nom) {
      setError("El nombre es obligatorio.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/inventario/categorias", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nom }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.data?.categoria) {
        setError(json?.error || "No se pudo crear la categoría.");
        setSaving(false);
        return;
      }
      const cat = json.data.categoria as { id: string; nombre: string };
      onCreated({ id: cat.id, nombre: cat.nombre });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red.");
    } finally {
      setSaving(false);
    }
  }

  const input =
    "w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="text-base font-semibold text-slate-800">Nueva categoría</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 px-5 py-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Nombre *
            </label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              autoFocus
              placeholder="EJ: VESTIDOS"
              className={input}
            />
          </div>

          <p className="text-xs text-slate-400">
            Podés gestionar las categorías después desde Inventario → Categorías.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !nombre.trim()}
              className="rounded-md bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Guardando…" : "Crear y seleccionar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
