"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  emptyUsuarioForm,
  rolFromNivelForm,
  UsuarioFormFields,
  type UsuarioFormValues,
} from "@/components/usuarios/UsuarioForm";
import { ALLOWED_MENU_KEYS } from "@/components/layout/Sidebar";

type ModuloEmpresa = { id: string; nombre: string; slug: string };

export default function NuevoUsuarioPage() {
  const router = useRouter();

  const [form, setForm] = useState(emptyUsuarioForm());
  const [showPwd, setShowPwd] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Módulos activos de la empresa (para mostrar checkboxes "Pantallas que puede ver").
  const [modulosEmpresa, setModulosEmpresa] = useState<ModuloEmpresa[]>([]);
  const [moduloIds, setModuloIds] = useState<string[]>([]);

  useEffect(() => {
    fetchWithSupabaseSession("/api/empresas/module-access", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const ms = Array.isArray(j?.modulos) ? (j.modulos as ModuloEmpresa[]) : [];
        // Filtrar al allowlist del sidebar para no mostrar módulos heredados
        // del repo base (Marketing, CRM, Omnicanal, etc.) que en esta instancia
        // no están visibles.
        setModulosEmpresa(ms.filter((m) => ALLOWED_MENU_KEYS.has(m.slug)));
      })
      .catch(() => setModulosEmpresa([]));
  }, []);

  function toggleModulo(id: string) {
    setModuloIds((prev) => prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]);
  }

  // El rol "admin" tiene acceso a todo por definición; solo mostramos el bloque
  // de selección si es un nivel acotado (supervisor / usuario).
  const rolFinal = rolFromNivelForm(form.nivel);
  const esRolAdmin = ["admin", "administrador", "super_admin"].includes(rolFinal);
  const mostrarModulos = !esRolAdmin && modulosEmpresa.length > 0;

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    const upper = ["nombre"];
    if (type === "checkbox") {
      setForm((prev) => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      let normalized = value;
      if (name === "email" || type === "email") normalized = value.toLowerCase();
      else if (upper.includes(name)) normalized = value.toUpperCase();
      setForm((prev) => ({ ...prev, [name]: normalized } as UsuarioFormValues));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.nombre.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    if (!form.email.trim()) {
      setError("El email es obligatorio.");
      return;
    }
    if (!form.password) {
      setError("La contraseña es obligatoria.");
      return;
    }
    if (form.password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (form.password !== form.password2) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    const pct = form.porcentaje_comision.trim();
    const pctNum = pct === "" ? null : Number(pct);
    if (pctNum !== null && (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100)) {
      setError("La comisión debe estar entre 0 y 100.");
      return;
    }

    setGuardando(true);

    try {
      const res = await fetchWithSupabaseSession("/api/empresas/usuarios/nuevo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
          password: form.password,
          nombre: form.nombre.trim(),
          telefono: form.telefono.trim() || undefined,
          fecha_nacimiento: form.fecha_nacimiento || undefined,
          fecha_ingreso: form.fecha_ingreso || undefined,
          tipo_contrato: form.tipo_contrato,
          salario_base: form.salario_base.trim() || undefined,
          porcentaje_comision: pct.trim() || undefined,
          ips: form.ips,
          area: form.area,
          rol: rolFinal,
          modulo_ids: mostrarModulos ? moduloIds : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Error al crear usuario");
      }
    } catch (err: unknown) {
      setGuardando(false);
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
      setError(`Error al crear usuario: ${msg}`);
      return;
    }

    setGuardando(false);
    router.push("/usuarios");
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/usuarios" className="hover:text-gray-700 transition-colors">
          Usuarios
        </Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Nuevo usuario</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nuevo usuario</h1>
        <p className="text-sm text-gray-500 mt-1">Código generado automáticamente al guardar.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <UsuarioFormFields
          variant="create"
          form={form}
          onChange={handleChange}
          onSalarioBaseChange={(n) => setForm((prev) => ({ ...prev, salario_base: String(n) }))}
          showPwd={showPwd}
          setShowPwd={setShowPwd}
          showPwd2={showPwd2}
          setShowPwd2={setShowPwd2}
        />

        {/* Pantallas que puede ver. Solo para roles no-admin (admin ve todo). */}
        {mostrarModulos && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-slate-900">Pantallas que puede ver</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Marcá los módulos que esta persona puede usar. Si no marcás nada, no verá ningún módulo en su sidebar.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {modulosEmpresa.map((m) => {
                const checked = moduloIds.includes(m.id);
                return (
                  <label
                    key={m.id}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                      checked ? "border-[#4FAEB2] bg-[#4FAEB2]/5" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleModulo(m.id)}
                      className="rounded border-slate-300 text-[#4FAEB2] focus:ring-[#4FAEB2]/20"
                    />
                    <span className="flex-1 text-sm font-medium text-slate-800">{m.nombre}</span>
                    <span className="text-[10px] font-mono text-slate-400">{m.slug}</span>
                  </label>
                );
              })}
            </div>
            {moduloIds.length === 0 && (
              <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                ⚠️ Sin pantallas marcadas, el usuario solo podrá iniciar sesión pero no verá módulos.
              </p>
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={guardando}
            className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
          >
            {guardando ? "Creando usuario…" : "Guardar usuario"}
          </button>
          <Link href="/usuarios" className="text-sm text-gray-500 hover:text-gray-800 transition-colors px-4 py-2.5">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
