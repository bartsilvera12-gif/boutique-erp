/**
 * Importa productos masivamente desde un Excel (.xls/.xlsx) al schema
 * autorepuestosfelix de Postgres. Pensado para el catálogo de Felix
 * Bogado (~6000 SKUs).
 *
 * Uso:
 *   npx tsx scripts/importar-productos-excel.ts <ruta.xls>            # dry-run
 *   npx tsx scripts/importar-productos-excel.ts <ruta.xls> --apply    # ejecuta
 *
 * Variables:
 *   SUPABASE_DB_URL (o DIRECT_URL / DATABASE_URL) en .env.local
 *
 * Columnas esperadas en el Excel (orden no importa, se matchea por header):
 *   Código  Producto  P. Costo  P. Venta  P. Mayoreo  Departamento
 *   Existencia  Inv. Mínimo  Inv. Máximo  Tipo de Venta
 */
import { config } from "dotenv";
import * as XLSX from "xlsx";
import path from "node:path";
import pg from "pg";

config({ path: path.resolve(process.cwd(), ".env.local") });

const NOMBRE_EMPRESA = "Autorepuestos Felix Bogado";
const BATCH_SIZE = 500;

const file = process.argv[2];
const apply = process.argv.includes("--apply");
if (!file) {
  console.error("Uso: npx tsx scripts/importar-productos-excel.ts <ruta.xls> [--apply]");
  process.exit(1);
}
const url =
  process.env.SUPABASE_DB_URL?.trim() ||
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("Falta SUPABASE_DB_URL / DIRECT_URL / DATABASE_URL en .env.local");
  process.exit(1);
}

type Row = Record<string, unknown>;

interface ProductoImport {
  sku: string;
  nombre: string;
  codigo_barras: string | null;
  costo_promedio: number;
  precio_venta: number;
  precio_mayorista: number | null;
  ubicacion_deposito: string | null;
  stock_actual: number;
  stock_minimo: number;
  unidad_medida: string;
}

/**
 * Heurística para detectar EAN/UPC/barcodes en la columna "Código":
 * - Sólo dígitos (sin paréntesis ni letras).
 * - 12 o más caracteres.
 * Si matchea, el "Código" es en realidad un código de barras y la columna
 * "Producto" trae el SKU corto/interno (caso Patrón 2 del Excel).
 */
function esCodigoBarras(raw: string): boolean {
  const s = raw.trim();
  if (s.length < 12) return false;
  return /^\d+$/.test(s);
}

/** Parsea valores tipo "₲22.500" → 22500. Cualquier no-dígito se descarta. */
function parseGs(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).replace(/[^\d-]/g, ""); // deja dígitos y signo
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function trim(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** SKU: quita el paréntesis inicial "(" si lo trae. */
function normSku(v: unknown): string {
  let s = trim(v);
  if (s.startsWith("(")) s = s.slice(1);
  return s.toUpperCase();
}

function parseRow(r: Row): ProductoImport | { error: string; raw: Row } {
  const codigoRaw = trim(r["Código"] ?? r["Codigo"]);
  const productoRaw = trim(r["Producto"]);
  if (!codigoRaw && !productoRaw) return { error: "Fila vacía", raw: r };

  let sku: string;
  let nombre: string;
  let codigoBarras: string | null;

  if (esCodigoBarras(codigoRaw)) {
    // Patrón 2: Código es EAN/UPC, Producto es el SKU corto/interno.
    // SKU = Producto, codigo_barras = Código (limpio), nombre = Producto.
    sku = productoRaw.toUpperCase();
    nombre = productoRaw.toUpperCase();
    codigoBarras = codigoRaw;
  } else {
    // Patrón 1 (mayoritario): Código es SKU interno, Producto es nombre.
    sku = normSku(codigoRaw);
    nombre = productoRaw.toUpperCase();
    codigoBarras = null;
  }

  if (!sku) return { error: "SKU vacío tras parseo", raw: r };
  if (!nombre) return { error: "Nombre vacío tras parseo", raw: r };

  const costo = parseGs(r["P. Costo"]);
  const venta = parseGs(r["P. Venta"]);
  const mayoreoRaw = parseGs(r["P. Mayoreo"]);
  const mayoreo = mayoreoRaw > 0 ? mayoreoRaw : null;
  const depto = trim(r["Departamento"]) || null;
  const stockActual = Math.max(parseGs(r["Existencia"]), 0);
  const stockMin = Math.max(parseGs(r["Inv. Mínimo"] ?? r["Inv. Minimo"]), 0);
  const unidadRaw = trim(r["Tipo de Venta"]).toUpperCase() || "UNIDAD";
  return {
    sku,
    nombre,
    codigo_barras: codigoBarras,
    costo_promedio: costo,
    precio_venta: venta,
    precio_mayorista: mayoreo,
    ubicacion_deposito: depto,
    stock_actual: stockActual,
    stock_minimo: stockMin,
    unidad_medida: unidadRaw,
  };
}

async function main() {
  console.log("• Archivo :", file);
  console.log("• Modo    :", apply ? "APPLY (escritura real)" : "DRY-RUN");
  console.log("");

  // Leer Excel
  const wb = XLSX.readFile(path.resolve(file));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Row>(ws, { defval: null });
  console.log(`• Filas leídas: ${rows.length}`);

  const ok: ProductoImport[] = [];
  const erroresFila: Array<{ idx: number; error: string; raw: Row }> = [];
  for (let i = 0; i < rows.length; i++) {
    const parsed = parseRow(rows[i]);
    if ("error" in parsed) erroresFila.push({ idx: i + 2, ...parsed }); // +2 = 1 header + 1 index base 1
    else ok.push(parsed);
  }
  console.log(`• Filas válidas: ${ok.length}`);
  console.log(`• Filas con error parseo: ${erroresFila.length}`);
  const invertidas = ok.filter((p) => p.codigo_barras !== null).length;
  console.log(`• Filas con código de barras detectado (swap aplicado): ${invertidas}`);

  // Detectar duplicados de SKU dentro del Excel
  const skuCount = new Map<string, number>();
  for (const p of ok) skuCount.set(p.sku, (skuCount.get(p.sku) ?? 0) + 1);
  const dupsExcel = Array.from(skuCount.entries()).filter(([, n]) => n > 1);
  console.log(`• SKU duplicados DENTRO del Excel: ${dupsExcel.length}`);
  if (dupsExcel.length > 0 && dupsExcel.length <= 20) {
    console.log("  →", dupsExcel.map(([s, n]) => `${s}×${n}`).join(", "));
  }

  // Conectar a Postgres
  const client = new pg.Client({
    connectionString: url,
    ssl: url!.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    const emp = await client.query(
      `SELECT id FROM autorepuestosfelix.empresas WHERE nombre_empresa = $1 LIMIT 1`,
      [NOMBRE_EMPRESA],
    );
    if (!emp.rows.length) throw new Error(`Empresa "${NOMBRE_EMPRESA}" no encontrada`);
    const empresaId = emp.rows[0].id;
    console.log(`• Empresa: ${NOMBRE_EMPRESA} (${empresaId})`);

    // Detectar duplicados de SKU contra la base
    const skus = Array.from(new Set(ok.map((p) => p.sku)));
    let dupsDB: string[] = [];
    for (let i = 0; i < skus.length; i += 1000) {
      const batch = skus.slice(i, i + 1000);
      const r = await client.query(
        `SELECT sku FROM autorepuestosfelix.productos WHERE empresa_id = $1 AND sku = ANY($2)`,
        [empresaId, batch],
      );
      dupsDB.push(...r.rows.map((x) => x.sku as string));
    }
    console.log(`• SKU que YA existen en la base: ${dupsDB.length}`);
    if (dupsDB.length > 0 && dupsDB.length <= 20) {
      console.log("  →", dupsDB.slice(0, 20).join(", "));
    }

    // Resumen monto $
    const totalCosto = ok.reduce((s, p) => s + p.costo_promedio * p.stock_actual, 0);
    const totalVenta = ok.reduce((s, p) => s + p.precio_venta * p.stock_actual, 0);
    console.log("");
    console.log("• Stock valorizado (a costo) :", totalCosto.toLocaleString("es-PY"));
    console.log("• Stock valorizado (a venta) :", totalVenta.toLocaleString("es-PY"));

    if (!apply) {
      console.log("\n⏸  DRY-RUN — no se insertó nada.");
      console.log("Para aplicar de verdad: npx tsx scripts/importar-productos-excel.ts " + file + " --apply");
      return;
    }

    // Filtrar duplicados con base (no se insertan)
    const dupsSet = new Set(dupsDB);
    const aInsertar = ok.filter((p) => !dupsSet.has(p.sku));
    // Para duplicados internos del Excel, dejamos el primero y descartamos resto
    const visto = new Set<string>();
    const final = aInsertar.filter((p) => {
      if (visto.has(p.sku)) return false;
      visto.add(p.sku);
      return true;
    });
    console.log(`\n• A insertar tras dedup: ${final.length}`);

    // Insert en batches con transacción
    await client.query("BEGIN");
    let insertadas = 0;
    try {
      const COLS = [
        "empresa_id", "sku", "nombre", "codigo_barras", "costo_promedio", "precio_venta", "precio_mayorista",
        "ubicacion_deposito", "stock_actual", "stock_minimo", "unidad_medida",
        "metodo_valuacion", "activo", "es_vendible", "es_insumo", "controla_stock", "valorizado",
        "codigo_barras_interno", "factor_compra_receta", "tiempo_prep_minutos",
      ];
      for (let i = 0; i < final.length; i += BATCH_SIZE) {
        const chunk = final.slice(i, i + BATCH_SIZE);
        const placeholders: string[] = [];
        const values: unknown[] = [];
        let pi = 1;
        for (const p of chunk) {
          placeholders.push(`(${COLS.map(() => `$${pi++}`).join(",")})`);
          values.push(
            empresaId, p.sku, p.nombre, p.codigo_barras, p.costo_promedio, p.precio_venta, p.precio_mayorista,
            p.ubicacion_deposito, p.stock_actual, p.stock_minimo, p.unidad_medida,
            "CPP", true, true, false, true, true,
            false, 1, 0,
          );
        }
        const sql = `INSERT INTO autorepuestosfelix.productos (${COLS.join(",")}) VALUES ${placeholders.join(",")}`;
        const r = await client.query(sql, values);
        insertadas += r.rowCount ?? chunk.length;
        process.stdout.write(`  batch ${(i / BATCH_SIZE) + 1}: +${r.rowCount ?? chunk.length} (total ${insertadas})\r`);
      }
      await client.query("COMMIT");
      console.log(`\n✓ COMMIT — ${insertadas} productos insertados.`);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("\n✗ ROLLBACK —", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
