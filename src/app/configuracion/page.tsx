"use client";

import {
  BarChart3,
  FileText,
  Landmark,
  PieChart,
  Receipt,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsModuleCard } from "@/components/config/SettingsModuleCard";
import { getConfig } from "@/lib/config/storage";

export default function ConfiguracionPage() {
  const [meta, setMeta] = useState<{ updated_at?: string; updated_by?: string } | null>(null);

  useEffect(() => {
    try {
      const c = getConfig();
      setMeta({ updated_at: c.updated_at, updated_by: c.updated_by });
    } catch {
      setMeta({});
    }
  }, []);

  const editorBadge = { label: "Editor", tone: "neutral" as const };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 px-4 pb-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Configuración Global</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Parámetros globales del ERP. Elegí un módulo y tocá <span className="font-semibold">Editar</span> para
            abrir el detalle.
          </p>
        </div>
        {meta?.updated_at && (
          <div className="shrink-0 text-right">
            <p className="text-xs text-slate-400">Última actualización</p>
            <p className="mt-0.5 text-xs font-medium text-slate-600">
              {new Date(meta.updated_at).toLocaleString("es-PY")}
            </p>
            {meta.updated_by && <p className="mt-0.5 text-xs text-slate-400">por {meta.updated_by}</p>}
          </div>
        )}
      </div>

      <section aria-label="Accesos a módulos" className="space-y-4">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Centro de configuración</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Cada tarjeta te lleva a su pantalla de edición. El omnicanal abre flows dedicados cuando el módulo está
            activo.
          </p>
        </div>
        <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
          <li>
            <SettingsModuleCard
              title="Facturación"
              subtitle="GLOBAL · DOCUMENTOS"
              description="Numeración, condiciones de pago y acceso a SIFEN / facturación electrónica."
              icon={Receipt}
              badge={editorBadge}
              href="/configuracion/facturacion"
            />
          </li>
          <li>
            <SettingsModuleCard
              title="Entidades bancarias"
              subtitle="GLOBAL · COBROS"
              description="Cajas, bancos, tarjetas/POS y billeteras para el cobro de ventas y la conciliación. Código corto para búsqueda rápida del cajero."
              icon={Landmark}
              badge={editorBadge}
              href="/configuracion/entidades-bancarias"
            />
          </li>
          <li>
            <SettingsModuleCard
              title="Políticas del sistema"
              subtitle="GLOBAL · COMERCIAL"
              description="Descuentos máximos, retención de clientes y límites por empresa."
              icon={FileText}
              badge={editorBadge}
              href="/configuracion/politicas"
            />
          </li>
          <li>
            <SettingsModuleCard
              title="Preferencias"
              subtitle="GLOBAL · LOCALIZACIÓN"
              description="Moneda base, zona horaria, idioma y formato de fecha."
              icon={SlidersHorizontal}
              badge={editorBadge}
              href="/configuracion/preferencias"
            />
          </li>
          <li>
            <SettingsModuleCard
              title="Métricas"
              subtitle="GLOBAL · OBJETIVOS"
              description="Metas comerciales y financieras para tableros y seguimiento."
              icon={BarChart3}
              badge={editorBadge}
              href="/configuracion/metricas"
            />
          </li>
          <li>
            <SettingsModuleCard
              title="Vistas del dashboard"
              subtitle="EMPRESA · TABLERO PRINCIPAL"
              description="El inicio ofrece varias pestañas según la organización. Configurá qué aplica a la empresa (admin global) y qué ve cada usuario (admin+usuarios) desde el hub dedicado; no hace falta adivinar la pantalla."
              icon={PieChart}
              badge={{ label: "Empresa / usuarios", tone: "neutral" as const }}
              href="/configuracion/vistas-dashboard"
              actionLabel="Configurar"
            />
          </li>
        </ul>
      </section>
    </div>
  );
}
