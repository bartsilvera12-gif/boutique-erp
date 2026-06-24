import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type {
  Caja,
  CajaResumen,
  MedioPagoCaja,
  TipoMovimientoCaja,
} from "./types";

type Ok<T> = { success: true } & T;
type Err = { success: false; error: string };

async function postJson<T>(url: string, body: unknown): Promise<Ok<T> | Err> {
  try {
    const res = await fetchWithSupabaseSession(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { success?: boolean; data?: T; error?: string };
    if (!res.ok || !json.success || !json.data) {
      return { success: false, error: json.error ?? `Error (${res.status}).` };
    }
    return { success: true, ...(json.data as T) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error de red." };
  }
}

/** Caja abierta actual (o null si no hay). */
export async function getCajaAbierta(): Promise<Caja | null> {
  try {
    const res = await fetchWithSupabaseSession("/api/caja/abierta", { cache: "no-store" });
    const json = (await res.json()) as { success?: boolean; data?: { caja: Caja | null }; error?: string };
    if (!res.ok || !json.success) return null;
    return json.data?.caja ?? null;
  } catch {
    return null;
  }
}

export function abrirCaja(montoApertura: number, observacion: string | null) {
  return postJson<{ caja: Caja }>("/api/caja/abrir", {
    monto_apertura: montoApertura,
    observacion,
  });
}

export function cerrarCaja(montoCierreContado: number, observacion: string | null, cajaId?: string) {
  return postJson<{ resumen: CajaResumen }>("/api/caja/cerrar", {
    monto_cierre_contado: montoCierreContado,
    observacion,
    caja_id: cajaId ?? null,
  });
}

export function registrarMovimiento(payload: {
  tipo: TipoMovimientoCaja;
  concepto: string;
  monto: number;
  medio_pago: MedioPagoCaja;
  observacion: string | null;
}) {
  return postJson<{ movimiento: unknown }>("/api/caja/movimiento", payload);
}

/** Resumen/arqueo de la caja abierta (sin id) o de una caja puntual. */
export async function getResumenCaja(cajaId?: string): Promise<CajaResumen | null> {
  try {
    const url = cajaId ? `/api/caja/resumen?caja_id=${encodeURIComponent(cajaId)}` : "/api/caja/resumen";
    const res = await fetchWithSupabaseSession(url, { cache: "no-store" });
    const json = (await res.json()) as { success?: boolean; data?: { resumen: CajaResumen | null }; error?: string };
    if (!res.ok || !json.success) return null;
    return json.data?.resumen ?? null;
  } catch {
    return null;
  }
}

export async function getHistorialCajas(): Promise<CajaResumen[]> {
  try {
    const res = await fetchWithSupabaseSession("/api/caja/historial", { cache: "no-store" });
    const json = (await res.json()) as { success?: boolean; data?: { cajas: CajaResumen[] }; error?: string };
    if (!res.ok || !json.success) return [];
    return json.data?.cajas ?? [];
  } catch {
    return [];
  }
}
