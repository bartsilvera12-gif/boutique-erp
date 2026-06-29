/**
 * Helpers de unidad de medida. METRO acepta decimales (2.5 m de tela); el resto
 * (UNIDAD, COMBO, PAQUETE, DOCENA, CAJA) solo enteros.
 */

const UNIDADES_CONTINUAS = new Set([
  "METRO",
]);

const SUFIJO_CORTO: Record<string, string> = {
  UNIDAD: "u",
  COMBO: "cb",
  PAQUETE: "pq",
  DOCENA: "dz",
  CAJA: "cj",
  METRO: "m",
};

export function aceptaDecimal(unidad: string | null | undefined): boolean {
  if (!unidad) return false;
  return UNIDADES_CONTINUAS.has(unidad.trim().toUpperCase());
}

export function sufijoUnidad(unidad: string | null | undefined): string {
  if (!unidad) return "u";
  const k = unidad.trim().toUpperCase();
  return SUFIJO_CORTO[k] ?? "u";
}

/**
 * Formatea una cantidad con su sufijo. Si la unidad acepta decimales y la
 * cantidad NO es entera, muestra hasta 2 decimales. Sino, entero.
 */
export function formatCantidad(qty: number, unidad: string | null | undefined): string {
  const n = Number(qty) || 0;
  if (aceptaDecimal(unidad) && !Number.isInteger(n)) {
    return `${n.toFixed(2)} ${sufijoUnidad(unidad)}`;
  }
  return `${Math.round(n).toLocaleString("es-PY")} ${sufijoUnidad(unidad)}`;
}
