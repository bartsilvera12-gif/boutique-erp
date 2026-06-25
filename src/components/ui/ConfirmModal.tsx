"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

type Variant = "danger" | "neutral";

interface Props {
  open: boolean;
  title: string;
  /** Cuerpo principal. Si pasás varias líneas usá \n — se renderiza con whitespace-pre-line. */
  message: string;
  /** Mensaje secundario (gris, debajo del principal). Opcional. */
  hint?: string;
  /** Texto del botón de confirmar. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" → botón rojo + icono triángulo amarillo. "neutral" → teal. */
  variant?: Variant;
  /** Bloquea botones mientras se procesa. */
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Modal de confirmación estilo app (reemplazo a window.confirm).
 * Click en backdrop o Esc cierra. Acepta variantes danger/neutral.
 */
export default function ConfirmModal({
  open,
  title,
  message,
  hint,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "danger",
  loading = false,
  onConfirm,
  onClose,
}: Props) {
  // Esc cierra
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !loading) onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, onClose]);

  if (!open) return null;

  const confirmCls = variant === "danger"
    ? "bg-red-600 hover:bg-red-700"
    : "bg-[#4FAEB2] hover:bg-[#3F8E91]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => { if (!loading) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {variant === "danger" && (
            <div className="shrink-0 rounded-full bg-red-50 p-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            <p className="mt-1 text-sm text-slate-700 whitespace-pre-line">{message}</p>
            {hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${confirmCls}`}
          >
            {loading ? "Procesando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
