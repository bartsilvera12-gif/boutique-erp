"use client";

import { useEffect, useState } from "react";
import {
  hasStoredPassword,
  setStoredPassword,
  verifyPassword,
  unlock,
} from "@/lib/edit-password";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditPasswordGate({ open, onClose, onSuccess }: Props) {
  const [mode, setMode] = useState<"set" | "enter">("enter");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMode(hasStoredPassword() ? "enter" : "set");
      setP1("");
      setP2("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "set") {
        if (p1.length < 4) {
          setError("La contraseña debe tener al menos 4 caracteres.");
          return;
        }
        if (p1 !== p2) {
          setError("Las contraseñas no coinciden.");
          return;
        }
        await setStoredPassword(p1);
        unlock();
        onSuccess();
      } else {
        const ok = await verifyPassword(p1);
        if (!ok) {
          setError("Contraseña incorrecta.");
          return;
        }
        unlock();
        onSuccess();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-slate-900">
          {mode === "set" ? "Setear contraseña de edición" : "Contraseña requerida"}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {mode === "set"
            ? "Esta contraseña se te pedirá cada vez que quieras editar o borrar productos."
            : "Ingresá la contraseña para editar o borrar productos."}
        </p>

        <div className="mt-4 space-y-3">
          <input
            type="password"
            autoFocus
            value={p1}
            onChange={(e) => setP1(e.target.value)}
            placeholder={mode === "set" ? "Nueva contraseña" : "Contraseña"}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
          />
          {mode === "set" && (
            <input
              type="password"
              value={p2}
              onChange={(e) => setP2(e.target.value)}
              placeholder="Confirmar contraseña"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || !p1}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {mode === "set" ? "Guardar" : "Desbloquear"}
          </button>
        </div>
      </form>
    </div>
  );
}
