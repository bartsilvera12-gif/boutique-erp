"use client";

import { useState, useRef } from "react";
import type { PreviewResponse, CommitResponse } from "@/lib/excel/import-types";
import { MAX_BYTES, MAX_ROWS } from "@/lib/excel/import";

const MAX_MB = Math.round(MAX_BYTES / 1024 / 1024);
const MAX_ROWS_LABEL = MAX_ROWS.toLocaleString("es-PY");

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

interface Props {
  entidad: string;
  previewUrl: string;
  commitUrl: string;
  templateUrl: string;
  /** Si true, muestra checkbox "Crear faltantes" (categoria/proveedor/ubicacion). */
  permiteCrearFaltantes?: boolean;
  onClose?: () => void;
  onCompleted?: () => void;
}

export default function ExcelImportWizard({
  entidad, previewUrl, commitUrl, templateUrl, permiteCrearFaltantes = false,
  onClose, onCompleted,
}: Props) {
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [commit, setCommit] = useState<CommitResponse | null>(null);
  const [crearFaltantes, setCrearFaltantes] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function pickFile(f: File | null | undefined) {
    if (!f) { setFile(null); return; }
    setError(null);
    // Validación client-side amigable (el server vuelve a validar).
    if (f.size > MAX_BYTES) {
      setError(`El archivo pesa ${formatBytes(f.size)}. El máximo permitido es ${MAX_MB} MB.`);
      setFile(null);
      return;
    }
    const validExt = /\.(xlsx|xls|csv)$/i.test(f.name);
    if (!validExt) {
      setError(`Formato no soportado. Usá .xlsx, .xls o .csv.`);
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function handleUpload() {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch(previewUrl, { method: "POST", credentials: "include", body: fd });
      const j = await r.json();
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); return; }
      setPreview(j.data as PreviewResponse);
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally { setBusy(false); }
  }

  async function handleCommit() {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (permiteCrearFaltantes) fd.append("crear_faltantes", crearFaltantes ? "1" : "0");
      const r = await fetch(commitUrl, { method: "POST", credentials: "include", body: fd });
      const j = await r.json();
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); return; }
      setCommit(j.data as CommitResponse);
      setStep("done");
      onCompleted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center bg-slate-900/60 backdrop-blur-sm pt-16 px-4" onClick={onClose}>
      <div className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-800">Importar {entidad} desde Excel</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Subí tu archivo, revisá el preview y confirmá. Se valida fila por fila antes de escribir.
              </p>
            </div>
            <button onClick={onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700 text-2xl leading-none -mt-1">×</button>
          </div>
          <StepIndicator step={step} />
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              <span aria-hidden>⚠️</span>
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-sm" aria-label="Descartar">×</button>
            </div>
          )}

          {step === "upload" && (
            <div className="space-y-4">
              {/* Drop-zone clickeable + drag-and-drop. Reemplaza el input nativo
                  feo por una zona grande con instrucciones claras. */}
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  pickFile(e.dataTransfer.files?.[0]);
                }}
                className={`relative cursor-pointer border-2 border-dashed rounded-xl px-6 py-10 text-center transition-colors ${
                  dragOver
                    ? "border-[#4FAEB2] bg-[#4FAEB2]/5"
                    : file
                      ? "border-emerald-300 bg-emerald-50/40"
                      : "border-slate-300 bg-slate-50 hover:border-[#4FAEB2] hover:bg-[#4FAEB2]/5"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => pickFile(e.target.files?.[0])}
                  className="hidden"
                />
                {file ? (
                  <div className="space-y-2">
                    <div className="text-3xl" aria-hidden>📄</div>
                    <div className="text-sm font-medium text-slate-800 break-all">{file.name}</div>
                    <div className="text-xs text-slate-500">{formatBytes(file.size)} · listo para analizar</div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                      className="text-xs text-slate-500 underline hover:text-slate-800 mt-2"
                    >
                      Cambiar archivo
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-3xl" aria-hidden>📥</div>
                    <div className="text-sm font-medium text-slate-700">
                      Arrastrá tu archivo acá <span className="text-slate-400">o</span> hacé click para elegirlo
                    </div>
                    <div className="text-xs text-slate-500">
                      Excel (.xlsx, .xls) o CSV — máx. {MAX_MB} MB / {MAX_ROWS_LABEL} filas
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between text-xs">
                <a href={templateUrl} className="inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 underline">
                  ⬇ Descargar plantilla
                </a>
                <span className="text-slate-400">
                  ¿Primera vez? Usá la plantilla para evitar errores de columnas.
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t pt-4">
                <button onClick={onClose} className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50">Cancelar</button>
                <button onClick={handleUpload} disabled={!file || busy}
                  className="px-4 py-2 text-sm rounded-lg bg-[#0EA5E9] text-white hover:bg-[#0284C7] disabled:opacity-50 disabled:cursor-not-allowed">
                  {busy ? "Analizando..." : "Analizar archivo →"}
                </button>
              </div>
            </div>
          )}

          {step === "preview" && preview && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <Stat label="Total filas" value={preview.summary.total} color="slate" />
                <Stat label="Insertar" value={preview.summary.insertar} color="green" />
                <Stat label="Actualizar" value={preview.summary.actualizar} color="sky" />
                <Stat label="Omitir" value={preview.summary.omitir} color="amber" />
                <Stat label="Errores" value={preview.summary.errores} color="red" />
              </div>
              {preview.summary.warnings > 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  {preview.summary.warnings} advertencia(s) — revisá la tabla.
                </div>
              )}
              {typeof preview.summary.movimientos_a_generar === "number" && (
                <div className="text-xs bg-indigo-50 border border-indigo-200 rounded p-2 text-indigo-800">
                  <strong>Impacto en inventario:</strong>{" "}
                  {preview.summary.movimientos_a_generar} movimiento(s) ·
                  +{preview.summary.unidades_entrada ?? 0} entrada(s) ·
                  −{preview.summary.unidades_salida ?? 0} salida(s)
                </div>
              )}
              {preview.summary.faltantes && (
                <FaltantesBox f={preview.summary.faltantes} />
              )}
              {permiteCrearFaltantes && (
                <label className="flex items-center gap-2 text-sm text-slate-700 select-none">
                  <input type="checkbox" checked={crearFaltantes} onChange={(e) => setCrearFaltantes(e.target.checked)} />
                  Crear categorías, proveedores o ubicaciones faltantes durante la importación
                </label>
              )}
              <PreviewTable rows={preview.rows} />
              <div className="flex justify-between gap-2 pt-2">
                <button onClick={() => setStep("upload")} className="px-4 py-2 text-sm border rounded-lg">← Volver</button>
                <button onClick={handleCommit} disabled={busy || preview.summary.errores === preview.summary.total}
                  className="px-4 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
                  {busy ? "Importando..." : "Confirmar e importar"}
                </button>
              </div>
            </div>
          )}

          {step === "done" && commit && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
                <Stat label="Total" value={commit.summary.total} color="slate" />
                <Stat label="Insertados" value={commit.summary.inserted} color="green" />
                <Stat label="Actualizados" value={commit.summary.updated} color="sky" />
                <Stat label="Omitidos" value={commit.summary.skipped} color="amber" />
                <Stat label="Errores" value={commit.summary.errors} color="red" />
                <Stat label="Warnings" value={commit.summary.warnings} color="amber" />
              </div>
              {typeof commit.summary.movimientos_generados === "number" && (
                <div className="text-xs bg-indigo-50 border border-indigo-200 rounded p-2 text-indigo-800">
                  <strong>Movimientos generados:</strong> {commit.summary.movimientos_generados} ·
                  +{commit.summary.unidades_entrada ?? 0} entrada(s) ·
                  −{commit.summary.unidades_salida ?? 0} salida(s)
                </div>
              )}
              {commit.errors.length > 0 && (
                <ul className="text-xs bg-red-50 border border-red-200 rounded p-2 max-h-40 overflow-y-auto">
                  {commit.errors.map((e, i) => <li key={i}>• {e}</li>)}
                </ul>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-[#0EA5E9] text-white">Cerrar</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: "slate"|"green"|"sky"|"amber"|"red" }) {
  const colors: Record<string, string> = {
    slate: "bg-slate-50 border-slate-200 text-slate-700",
    green: "bg-emerald-50 border-emerald-200 text-emerald-700",
    sky: "bg-sky-50 border-sky-200 text-sky-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    red: "bg-red-50 border-red-200 text-red-700",
  };
  return (
    <div className={`border rounded-lg px-3 py-2 ${colors[color]}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-75">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function StepIndicator({ step }: { step: "upload" | "preview" | "done" }) {
  const steps = [
    { key: "upload", label: "Subir archivo" },
    { key: "preview", label: "Revisar preview" },
    { key: "done", label: "Importar" },
  ] as const;
  const currentIdx = steps.findIndex((s) => s.key === step);
  return (
    <ol className="flex items-center gap-2 mt-4 text-xs">
      {steps.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={`flex items-center justify-center w-6 h-6 rounded-full font-semibold text-[11px] transition-colors ${
                done
                  ? "bg-emerald-500 text-white"
                  : active
                    ? "bg-[#4FAEB2] text-white"
                    : "bg-slate-200 text-slate-500"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={`${active ? "font-semibold text-slate-800" : done ? "text-slate-600" : "text-slate-400"}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="text-slate-300 mx-1">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

function FaltantesBox({ f }: { f: { categorias: string[]; proveedores: string[]; ubicaciones: string[] } }) {
  const total = f.categorias.length + f.proveedores.length + f.ubicaciones.length;
  if (total === 0) return null;
  return (
    <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
      <p className="font-semibold text-amber-800">Referencias faltantes:</p>
      {f.categorias.length > 0 && <p>Categorías: {f.categorias.slice(0, 8).join(", ")}{f.categorias.length > 8 ? "…" : ""}</p>}
      {f.proveedores.length > 0 && <p>Proveedores: {f.proveedores.slice(0, 8).join(", ")}{f.proveedores.length > 8 ? "…" : ""}</p>}
      {f.ubicaciones.length > 0 && <p>Ubicaciones: {f.ubicaciones.slice(0, 8).join(", ")}{f.ubicaciones.length > 8 ? "…" : ""}</p>}
    </div>
  );
}

function PreviewTable({ rows }: { rows: import("@/lib/excel/import-types").PreviewRow[] }) {
  const visibles = rows.slice(0, 200);
  return (
    /* "overflow-auto" cubre ambos ejes (X + Y) en lugar de solo Y.
       "min-w-[640px]" fuerza scroll horizontal en mobile para que las columnas
       "Detalle" y "Mensajes" no se aplasten — sin esto el usuario importa a ciegas. */
    <div className="border rounded-lg overflow-auto max-h-[40vh]">
      <table className="w-full min-w-[640px] sm:min-w-0 text-xs">
        <thead className="bg-slate-50 text-slate-600 sticky top-0">
          <tr>
            <th className="text-left px-2 py-1.5">Fila</th>
            <th className="text-left px-2 py-1.5">Acción</th>
            <th className="text-left px-2 py-1.5">Detalle</th>
            <th className="text-left px-2 py-1.5">Mensajes</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((r) => {
            const badge =
              r.action === "INSERT" ? "bg-emerald-100 text-emerald-700" :
              r.action === "UPDATE" ? "bg-sky-100 text-sky-700" :
              r.action === "SKIP" ? "bg-amber-100 text-amber-700" :
              "bg-red-100 text-red-700";
            const summary = Object.entries(r.data).slice(0, 3).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(" · ");
            return (
              <tr key={r.row_number} className="border-t border-slate-100">
                <td className="px-2 py-1 text-slate-500">{r.row_number}</td>
                <td className="px-2 py-1"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge}`}>{r.action}</span></td>
                <td className="px-2 py-1 text-slate-700 truncate max-w-md">{summary}</td>
                <td className="px-2 py-1 text-xs">
                  {r.errors.map((e, i) => <div key={`e${i}`} className="text-red-700">⚠ {e}</div>)}
                  {r.warnings.map((w, i) => <div key={`w${i}`} className="text-amber-700">• {w}</div>)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > visibles.length && (
        <div className="text-xs text-slate-400 px-2 py-1 border-t">Mostrando primeras {visibles.length} de {rows.length} filas.</div>
      )}
    </div>
  );
}
