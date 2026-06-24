"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Wallet } from "lucide-react";

function fmtGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}

/**
 * Card resumen de Cuentas por Pagar para el dashboard financiero.
 * Auto-fetch silencioso al endpoint /api/compras/cuentas-por-pagar.
 * Si no hay deuda, la card no se renderiza (cero clutter).
 */
export default function CuentasPorPagarCard() {
  const [docs, setDocs] = useState<number>(0);
  const [deuda, setDeuda] = useState<number>(0);
  const [vencidos, setVencidos] = useState<number>(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancel = false;
    fetch("/api/compras/cuentas-por-pagar", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel || !j?.success) return;
        const s = j.data?.summary ?? {};
        setDocs(Number(s.documentos_con_saldo ?? 0));
        setDeuda(Number(s.total_deuda ?? 0));
        setVencidos(Number(s.vencidos_mas_30_dias ?? 0));
      })
      .catch(() => { /* silencioso */ })
      .finally(() => { if (!cancel) setLoaded(true); });
    return () => { cancel = true; };
  }, []);

  if (!loaded) return null;
  if (docs === 0 && deuda === 0) return null;

  return (
    <Link href="/pagos-proveedores" className="block">
      <motion.div
        whileHover={{ y: -2 }}
        className="rounded-2xl border border-rose-200 bg-rose-50/40 p-6 shadow-sm hover:shadow-md transition-shadow"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-rose-100 p-2">
              <Wallet className="h-5 w-5 text-rose-700" />
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-800">
              Cuentas por pagar
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-rose-700/60" />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <p className="text-3xl font-bold tabular-nums text-[#4FAEB2]">{docs}</p>
            <p className="mt-0.5 text-xs text-slate-500">documentos</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-rose-800">{fmtGs(deuda)}</p>
            <p className="mt-0.5 text-xs text-slate-500">deuda total</p>
          </div>
          <div>
            <p className="text-3xl font-bold tabular-nums text-amber-700">{vencidos}</p>
            <p className="mt-0.5 text-xs text-slate-500">vencidos +30d</p>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
