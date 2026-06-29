/**
 * Helpers de unidad de medida.
 *
 * Las unidades continuas (metro, kg, lt, etc.) aceptan decimales — al vender o
 * comprar 2.5 m de cable, 0.75 kg de algo, etc. Las discretas (unidad, caja,
 * docena) solo enteros.
 *
 * `acceptaDecimal()` se usa en inputs <input type="number" step={...} /> para
 * permitir 0.01 vs 1 según corresponda.
 *
 * `formatCantidad()` muestra el stock con su sufijo: "459.60 m", "12 u",
 * "3.25 kg". Para enteros muestra sin decimales; para decimales muestra 2.
 */

const UNIDADES_CONTINUAS = new Set([
  "METRO", "METROS", "M",
  "CM",
  "KG", "G",
  "LT", "L", "ML",
]);

const SUFIJO_CORTO: Record<string, string> = {
  UNIDAD: "u",
  METRO: "m",
  METROS: "m",
  M: "m",
  CM: "cm",
  KG: "kg",
  G: "g",
  LT: "L",
  L: "L",
  ML: "ml",
  CAJA: "cj",
  BOLSA: "bls",
  PAQUETE: "pq",
  DOCENA: "dz",
  LATA: "lt",
  BOTELLA: "bot",
  PORCION: "por",
  COMBO: "cb",
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
