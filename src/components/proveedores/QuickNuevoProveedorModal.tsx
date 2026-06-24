"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { createProveedor } from "@/lib/proveedores/storage";
import type { Proveedor } from "@/lib/proveedores/types";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Se llama con el proveedor recién creado para que el padre lo agregue
   *  a su lista y lo auto-seleccione en el select que activó el modal. */
  onCreated: (proveedor: Proveedor) => void;
};

/**
 * Modal liviano para crear un proveedor sin perder el contexto del form que
 * lo invocó (ej. Nuevo producto). Sólo pide los campos mínimos; los datos
 * comerciales avanzados se completan después desde /proveedores.
 */
export default function QuickNuevoProveedorModal({ open, onClose, onCreated }: Props) {
  const [nombre, setNombre] = useState("");
  const [ruc, setRuc] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset cuando se abre.
  useEffect(() => {
    if (open) {
      setNombre("");
      setRuc("");
      setTelefono("");
      setEmail("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  // Cerrar con Escape.
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
    const res = await createProveedor({
      nombre: nom.toUpperCase(),
      nombre_comercial: null,
      razon_social: null,
      ruc: ruc.trim() || null,
      telefono: telefono.trim() || null,
      email: email.trim() || null,
      direccion: null,
      contacto: null,
      estado: "activo",
      condicion_pago: null,
      plazo_pago_dias: null,
      moneda_preferida: null,
      observaciones: null,
      categoria_ids: [],
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onCreated(res.proveedor);
    onClose();
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
          <h3 className="text-base font-semibold text-slate-800">Nuevo proveedor</h3>
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
              Razón social / Nombre *
            </label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              autoFocus
              placeholder="EJ: DISTRIBUIDORA EJEMPLO S.A."
              className={input}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">RUC</label>
              <input
                type="text"
                value={ruc}
                onChange={(e) => setRuc(e.target.value)}
                placeholder="opcional"
                className={input}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Teléfono</label>
              <input
                type="text"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="opcional"
                className={input}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="opcional"
              className={input}
            />
          </div>

          <p className="text-xs text-slate-400">
            Podés completar los datos comerciales después desde Proveedores.
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
