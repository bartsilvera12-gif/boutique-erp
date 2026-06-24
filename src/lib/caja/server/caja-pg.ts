import { createServiceRoleClientWithDbSchema } from "@/lib/supabase/empresa-data-schema";
import type {
  Caja,
  CajaMovimiento,
  CajaResumen,
  EstadoCaja,
  MedioPagoCaja,
  TipoMovimientoCaja,
} from "@/lib/caja/types";

// ── Helpers de mapeo ──────────────────────────────────────────────────────────

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

interface CajaRow {
  id: string;
  numero_caja: number | string;
  estado: string;
  abierta_por: string | null;
  cerrada_por: string | null;
  fecha_apertura: string;
  fecha_cierre: string | null;
  monto_apertura: number | string;
  monto_cierre_contado: number | string | null;
  monto_esperado_efectivo: number | string | null;
  diferencia: number | string | null;
  observacion_apertura: string | null;
  observacion_cierre: string | null;
}

function mapCaja(r: CajaRow): Caja {
  return {
    id: r.id,
    numero_caja: num(r.numero_caja),
    estado: (r.estado === "cerrada" ? "cerrada" : "abierta") as EstadoCaja,
    abierta_por: r.abierta_por,
    cerrada_por: r.cerrada_por,
    fecha_apertura: r.fecha_apertura,
    fecha_cierre: r.fecha_cierre,
    monto_apertura: num(r.monto_apertura),
    monto_cierre_contado: r.monto_cierre_contado == null ? null : num(r.monto_cierre_contado),
    monto_esperado_efectivo: r.monto_esperado_efectivo == null ? null : num(r.monto_esperado_efectivo),
    diferencia: r.diferencia == null ? null : num(r.diferencia),
    observacion_apertura: r.observacion_apertura,
    observacion_cierre: r.observacion_cierre,
  };
}

const CAJA_COLS =
  "id, numero_caja, estado, abierta_por, cerrada_por, fecha_apertura, fecha_cierre, monto_apertura, monto_cierre_contado, monto_esperado_efectivo, diferencia, observacion_apertura, observacion_cierre";

// ── Lecturas ──────────────────────────────────────────────────────────────────

export async function getCajaAbiertaPg(schema: string, empresaId: string): Promise<Caja | null> {
  const sb = createServiceRoleClientWithDbSchema(schema);
  const q = await sb
    .from("cajas")
    .select(CAJA_COLS)
    .eq("empresa_id", empresaId)
    .eq("estado", "abierta")
    .order("fecha_apertura", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (q.error) throw new Error(q.error.message);
  return q.data ? mapCaja(q.data as unknown as CajaRow) : null;
}

export async function listarCajasPg(
  schema: string,
  empresaId: string,
  limit = 100
): Promise<CajaResumen[]> {
  const sb = createServiceRoleClientWithDbSchema(schema);
  const q = await sb
    .from("cajas")
    .select(CAJA_COLS)
    .eq("empresa_id", empresaId)
    .order("fecha_apertura", { ascending: false })
    .limit(limit);
  if (q.error) throw new Error(q.error.message);
  const cajas = (q.data ?? []) as unknown as CajaRow[];
  const resumenes: CajaResumen[] = [];
  for (const row of cajas) {
    resumenes.push(await computeResumen(sb, empresaId, mapCaja(row)));
  }
  await attachUsuarioNombres(sb, resumenes);
  return resumenes;
}

export async function getResumenCajaPg(
  schema: string,
  empresaId: string,
  cajaId: string
): Promise<CajaResumen | null> {
  const sb = createServiceRoleClientWithDbSchema(schema);
  const q = await sb
    .from("cajas")
    .select(CAJA_COLS)
    .eq("empresa_id", empresaId)
    .eq("id", cajaId)
    .maybeSingle();
  if (q.error) throw new Error(q.error.message);
  if (!q.data) return null;
  const resumen = await computeResumen(sb, empresaId, mapCaja(q.data as unknown as CajaRow));
  await attachUsuarioNombres(sb, [resumen]);
  return resumen;
}

type Sb = ReturnType<typeof createServiceRoleClientWithDbSchema>;

/** Resuelve nombres de usuario (apertura/cierre) desde zentra_erp.usuarios. */
async function attachUsuarioNombres(sb: Sb, resumenes: CajaResumen[]): Promise<void> {
  const ids = new Set<string>();
  for (const r of resumenes) {
    if (r.caja.abierta_por) ids.add(r.caja.abierta_por);
    if (r.caja.cerrada_por) ids.add(r.caja.cerrada_por);
  }
  if (ids.size === 0) return;
  try {
    const q = await sb.schema("zentra_erp").from("usuarios").select("id, nombre").in("id", [...ids]);
    if (q.error || !q.data) return;
    const byId = new Map<string, string>();
    for (const u of q.data as Array<{ id: string; nombre: string | null }>) {
      if (u.nombre) byId.set(u.id, u.nombre);
    }
    for (const r of resumenes) {
      r.abierta_por_nombre = r.caja.abierta_por ? byId.get(r.caja.abierta_por) ?? null : null;
      r.cerrada_por_nombre = r.caja.cerrada_por ? byId.get(r.caja.cerrada_por) ?? null : null;
    }
  } catch {
    /* nombres opcionales */
  }
}

/**
 * Calcula totales de una caja a partir de sus ventas (por metodo_pago) y de
 * sus movimientos manuales. El efectivo esperado es la verdad del arqueo:
 *   apertura + ventas efectivo + ingresos efectivo − egresos efectivo
 *   − retiros efectivo + ajustes efectivo.
 * Tarjeta y transferencia suman al total vendido pero NO al efectivo esperado.
 */
async function computeResumen(sb: Sb, empresaId: string, caja: Caja): Promise<CajaResumen> {
  const vQ = await sb
    .from("ventas")
    .select("total, metodo_pago, estado")
    .eq("empresa_id", empresaId)
    .eq("caja_id", caja.id)
    .neq("estado", "anulada");
  if (vQ.error) throw new Error(vQ.error.message);
  const ventas = (vQ.data ?? []) as unknown as Array<{ total: number | string; metodo_pago: string | null }>;

  let totalVendido = 0;
  let totalEfectivo = 0;
  let totalTarjeta = 0;
  let totalTransferencia = 0;
  for (const v of ventas) {
    const t = num(v.total);
    totalVendido += t;
    if (v.metodo_pago === "tarjeta") totalTarjeta += t;
    else if (v.metodo_pago === "transferencia") totalTransferencia += t;
    else totalEfectivo += t;
  }

  const mQ = await sb
    .from("caja_movimientos")
    .select("id, caja_id, tipo, concepto, monto, medio_pago, usuario_id, observacion, created_at")
    .eq("empresa_id", empresaId)
    .eq("caja_id", caja.id)
    .order("created_at", { ascending: true });
  if (mQ.error) throw new Error(mQ.error.message);
  const movsRows = (mQ.data ?? []) as unknown as Array<{
    id: string;
    caja_id: string;
    tipo: string;
    concepto: string;
    monto: number | string;
    medio_pago: string | null;
    usuario_id: string | null;
    observacion: string | null;
    created_at: string;
  }>;

  let ingresosEf = 0;
  let egresosEf = 0;
  let retirosEf = 0;
  let ajustesEf = 0;
  const movimientos: CajaMovimiento[] = movsRows.map((m) => {
    const medio = (m.medio_pago ?? "efectivo") as MedioPagoCaja;
    const tipo = m.tipo as TipoMovimientoCaja;
    const monto = num(m.monto);
    if (medio === "efectivo") {
      if (tipo === "ingreso") ingresosEf += monto;
      else if (tipo === "egreso") egresosEf += monto;
      else if (tipo === "retiro") retirosEf += monto;
      else if (tipo === "ajuste") ajustesEf += monto;
    }
    return {
      id: m.id,
      caja_id: m.caja_id,
      tipo,
      concepto: m.concepto,
      monto,
      medio_pago: medio,
      usuario_id: m.usuario_id,
      observacion: m.observacion,
      created_at: m.created_at,
    };
  });

  const efectivoEsperado =
    caja.monto_apertura + totalEfectivo + ingresosEf - egresosEf - retirosEf + ajustesEf;

  return {
    caja,
    abierta_por_nombre: null,
    cerrada_por_nombre: null,
    cantidad_ventas: ventas.length,
    total_vendido: totalVendido,
    total_efectivo: totalEfectivo,
    total_tarjeta: totalTarjeta,
    total_transferencia: totalTransferencia,
    ingresos_efectivo: ingresosEf,
    egresos_efectivo: egresosEf,
    retiros_efectivo: retirosEf,
    ajustes_efectivo: ajustesEf,
    efectivo_esperado: efectivoEsperado,
    movimientos,
  };
}

// ── Escrituras ────────────────────────────────────────────────────────────────

export async function abrirCajaPg(params: {
  schema: string;
  empresaId: string;
  montoApertura: number;
  observacion: string | null;
  usuarioId: string | null;
}): Promise<Caja> {
  const sb = createServiceRoleClientWithDbSchema(params.schema);

  const yaAbierta = await getCajaAbiertaPg(params.schema, params.empresaId);
  if (yaAbierta) {
    throw new Error("Ya hay una caja abierta. Cerrala antes de abrir una nueva.");
  }

  const maxQ = await sb
    .from("cajas")
    .select("numero_caja")
    .eq("empresa_id", params.empresaId)
    .order("numero_caja", { ascending: false })
    .limit(1);
  if (maxQ.error) throw new Error(maxQ.error.message);
  const lastNum = num((maxQ.data?.[0] as { numero_caja?: number | string } | undefined)?.numero_caja);
  const numeroCaja = lastNum + 1;

  const ins = await sb
    .from("cajas")
    .insert({
      empresa_id: params.empresaId,
      numero_caja: numeroCaja,
      estado: "abierta",
      abierta_por: params.usuarioId,
      monto_apertura: Math.round(params.montoApertura),
      observacion_apertura: params.observacion,
    })
    .select(CAJA_COLS)
    .single();
  if (ins.error) {
    if (ins.error.code === "23505") {
      throw new Error("Ya hay una caja abierta. Cerrala antes de abrir una nueva.");
    }
    throw new Error(ins.error.message);
  }
  return mapCaja(ins.data as unknown as CajaRow);
}

export async function registrarMovimientoPg(params: {
  schema: string;
  empresaId: string;
  cajaId: string;
  tipo: TipoMovimientoCaja;
  concepto: string;
  monto: number;
  medioPago: MedioPagoCaja;
  observacion: string | null;
  usuarioId: string | null;
}): Promise<CajaMovimiento> {
  const sb = createServiceRoleClientWithDbSchema(params.schema);

  const cQ = await sb
    .from("cajas")
    .select("id, estado")
    .eq("empresa_id", params.empresaId)
    .eq("id", params.cajaId)
    .maybeSingle();
  if (cQ.error) throw new Error(cQ.error.message);
  if (!cQ.data) throw new Error("Caja no encontrada en esta empresa.");
  if ((cQ.data as { estado: string }).estado !== "abierta") {
    throw new Error("La caja está cerrada; no se pueden registrar movimientos.");
  }

  const ins = await sb
    .from("caja_movimientos")
    .insert({
      empresa_id: params.empresaId,
      caja_id: params.cajaId,
      tipo: params.tipo,
      concepto: params.concepto.trim(),
      monto: Math.round(params.monto),
      medio_pago: params.medioPago,
      usuario_id: params.usuarioId,
      observacion: params.observacion,
    })
    .select("id, caja_id, tipo, concepto, monto, medio_pago, usuario_id, observacion, created_at")
    .single();
  if (ins.error) throw new Error(ins.error.message);
  const m = ins.data as unknown as {
    id: string;
    caja_id: string;
    tipo: string;
    concepto: string;
    monto: number | string;
    medio_pago: string | null;
    usuario_id: string | null;
    observacion: string | null;
    created_at: string;
  };
  return {
    id: m.id,
    caja_id: m.caja_id,
    tipo: m.tipo as TipoMovimientoCaja,
    concepto: m.concepto,
    monto: num(m.monto),
    medio_pago: (m.medio_pago ?? "efectivo") as MedioPagoCaja,
    usuario_id: m.usuario_id,
    observacion: m.observacion,
    created_at: m.created_at,
  };
}

export async function cerrarCajaPg(params: {
  schema: string;
  empresaId: string;
  cajaId: string;
  montoCierreContado: number;
  observacion: string | null;
  usuarioId: string | null;
}): Promise<CajaResumen> {
  const sb = createServiceRoleClientWithDbSchema(params.schema);

  const resumen = await getResumenCajaPg(params.schema, params.empresaId, params.cajaId);
  if (!resumen) throw new Error("Caja no encontrada en esta empresa.");
  if (resumen.caja.estado !== "abierta") {
    throw new Error("La caja ya está cerrada.");
  }

  const contado = Math.round(params.montoCierreContado);
  const esperado = Math.round(resumen.efectivo_esperado);
  const diferencia = contado - esperado;

  const upd = await sb
    .from("cajas")
    .update({
      estado: "cerrada",
      cerrada_por: params.usuarioId,
      fecha_cierre: new Date().toISOString(),
      monto_cierre_contado: contado,
      monto_esperado_efectivo: esperado,
      diferencia,
      observacion_cierre: params.observacion,
    })
    .eq("empresa_id", params.empresaId)
    .eq("id", params.cajaId)
    .eq("estado", "abierta")
    .select(CAJA_COLS)
    .single();
  if (upd.error) throw new Error(upd.error.message);

  return {
    ...resumen,
    caja: mapCaja(upd.data as unknown as CajaRow),
    efectivo_esperado: esperado,
  };
}
