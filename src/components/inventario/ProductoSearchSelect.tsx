"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

type Producto = {
  id: string;
  nombre: string;
  sku: string;
  stock_actual: number;
  codigo_barras?: string | null;
};

type Props = {
  value: string;
  onChange: (id: string) => void;
  productos: Producto[];
  placeholder?: string;
};

/**
 * Combobox con buscador para elegir un producto entre miles. Reemplazo del
 * `<select>` nativo, que era inmanejable con catálogos grandes (6k SKUs).
 *
 * - Filtra por nombre / SKU / código de barras (case-insensitive).
 * - Muestra los primeros 100 resultados para no fundir el DOM.
 * - Click fuera o Escape cierran el panel.
 * - Enter selecciona el primer resultado visible.
 */
export default function ProductoSearchSelect({ value, onChange, productos, placeholder = "Seleccionar producto…" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => productos.find((p) => p.id === value) ?? null, [productos, value]);

  // Cerrar con click afuera.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Focus al input apenas se abre.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    else setQuery("");
  }, [open]);

  // Cerrar con Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return productos.slice(0, 100);
    return productos
      .filter((p) =>
        p.nombre.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.codigo_barras ?? "").toLowerCase().includes(q)
      )
      .slice(0, 100);
  }, [productos, query]);

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm outline-none transition-colors hover:border-slate-300 focus:ring-2 focus:ring-[#4FAEB2]/30"
      >
        <span className={`flex-1 truncate ${selected ? "text-slate-800" : "text-slate-400"}`}>
          {selected
            ? `${selected.nombre} — ${selected.sku} (stock: ${selected.stock_actual})`
            : placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filtrados[0]) {
                  e.preventDefault();
                  pick(filtrados[0].id);
                }
              }}
              placeholder="Buscar por nombre, SKU o código de barras…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
              autoComplete="off"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="text-slate-400 hover:text-slate-700" aria-label="Limpiar">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <ul className="max-h-72 overflow-y-auto py-1">
            {filtrados.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-slate-400">Sin resultados</li>
            ) : (
              filtrados.map((p) => {
                const isSel = p.id === value;
                const sinStock = p.stock_actual <= 0;
                return (
                  <li
                    key={p.id}
                    onClick={() => pick(p.id)}
                    className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm transition-colors ${
                      isSel ? "bg-[#4FAEB2]/10 text-slate-900" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.nombre}</div>
                      <div className="text-xs text-slate-500 font-mono">{p.sku}</div>
                    </div>
                    <span className={`shrink-0 text-xs tabular-nums ${sinStock ? "text-red-500" : "text-slate-500"}`}>
                      {sinStock ? "Sin stock" : `${p.stock_actual} u`}
                    </span>
                  </li>
                );
              })
            )}
          </ul>

          {!query && productos.length > 100 && (
            <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
              Mostrando primeros 100 de {productos.length}. Tipeá para buscar entre todos.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
