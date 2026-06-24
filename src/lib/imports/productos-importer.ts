/**
 * Logica compartida del importador de Productos para preview y commit.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { normalizeUpperText, normalizeUpperNullable } from "@/lib/text/normalize";
import type { PreviewRow, PreviewResponse } from "@/lib/excel/import-types";
import { pick, pickNumber, pickBool, chunked } from "./import-helpers";

interface ProductoExistente {
  id: string;
  sku: string;
  codigo_barras: string | null;
  stock_actual: number;
  // Snapshot completo para detectar UPDATEs no-op y saltarlos. Sin esto,
  // re-importar el mismo Excel sobre 6k SKUs hace 6k UPDATEs idénticos
  // y excede el timeout HTTP.
  nombre: string;
  costo_promedio: number;
  precio_venta: number;
  precio_mayorista: number | null;
  stock_minimo: number;
  unidad_medida: string;
  ubicacion_deposito: string | null;
}

export interface ProductoParsed {
  row_number: number;
  nombre: string;
  sku: string;
  codigo_barras: string;
  categoria_nombre: string;
  proveedor_nombre: string;
  ubicacion_nombre: string;
  /** Texto libre para "Departamento" del Excel autopartes — se guarda en productos.ubicacion_deposito. */
  ubicacion_deposito: string;
  unidad_medida: string;
  costo_promedio: number;
  precio_venta: number;
  /** Precio mayorista opcional (P. Mayoreo del Excel autopartes). 0 → se persiste como null. */
  precio_mayorista: number;
  stock_actual: number;
  stock_minimo: number;
  metodo_valuacion: "CPP" | "FIFO" | "LIFO";
  activo: boolean;
  errors: string[];
  warnings: string[];
  match_id?: string | null;
}

/**
 * Heurística para detectar EAN/UPC en una columna de "Código":
 * - 12+ caracteres
 * - Sólo dígitos
 * Si matchea, el header "Código" del Excel es en realidad un código de
 * barras escaneable y la columna "Producto" trae el SKU corto interno.
 */
function esCodigoBarras(s: string): boolean {
  const t = s.trim();
  return t.length >= 12 && /^\d+$/.test(t);
}

const METODOS = new Set(["CPP", "FIFO", "LIFO"]);

export function parseProductosRows(rows: Record<string, string>[]): ProductoParsed[] {
  return rows.map((r, idx) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // ── SKU / Nombre / Código de barras ──────────────────────────────
    // Aliases del Excel canónico ("SKU", "NOMBRE", "CODIGO_BARRAS") +
    // aliases del Excel autopartes Felix Bogado ("Código", "Producto").
    let skuRaw = pick(r, "SKU", "CODIGO", "CÓDIGO");
    const productoRaw = pick(r, "NOMBRE", "PRODUCTO");
    let codigoBarrasRaw = pick(r, "CODIGO_BARRAS", "CODIGOBARRAS", "CODIGO BARRAS", "EAN");

    // Patrón 2 del Excel autopartes: si el "Código" es un EAN largo y
    // no se pasó otro código de barras explícito, swap:
    //   sku           ← Producto (código corto memorable)
    //   codigo_barras ← Código   (EAN escaneable)
    if (!codigoBarrasRaw && skuRaw && esCodigoBarras(skuRaw)) {
      codigoBarrasRaw = skuRaw;
      skuRaw = productoRaw;
    } else if (skuRaw.startsWith("(")) {
      // Patrón 1: algunos códigos del Excel viejo empiezan con "(" suelto.
      skuRaw = skuRaw.slice(1);
    }

    const nombre = normalizeUpperText(productoRaw || skuRaw);
    if (!nombre) errors.push("NOMBRE obligatorio.");
    const sku = normalizeUpperText(skuRaw);
    const codigo_barras_raw = normalizeUpperText(codigoBarrasRaw);
    if (codigo_barras_raw && /^INT-/i.test(codigo_barras_raw)) {
      errors.push('Prefijo "INT-" reservado para códigos generados por el sistema.');
    }
    const mv = normalizeUpperText(pick(r, "METODO_VALUACION", "METODOVALUACION"));
    const metodo_valuacion = (METODOS.has(mv) ? mv : "CPP") as "CPP" | "FIFO" | "LIFO";

    // ── Precio mayorista (P. Mayoreo en el Excel autopartes) ─────────
    const mayoristaRaw = pickNumber(r, "PRECIO_MAYORISTA", "PRECIO MAYORISTA", "P MAYOREO", "P. MAYOREO", "MAYOREO", "MAYORISTA");
    return {
      row_number: idx + 2,
      nombre,
      sku,
      codigo_barras: codigo_barras_raw,
      categoria_nombre: normalizeUpperText(pick(r, "CATEGORIA", "CATEGORIA_PRINCIPAL", "CATEGORÍA")),
      proveedor_nombre: normalizeUpperText(pick(r, "PROVEEDOR_PRINCIPAL", "PROVEEDOR")),
      ubicacion_nombre: normalizeUpperText(pick(r, "UBICACION_PRINCIPAL", "UBICACION", "UBICACIÓN")),
      // "Departamento" del Excel autopartes → texto libre, va a ubicacion_deposito.
      ubicacion_deposito: pick(r, "DEPARTAMENTO", "DEPARTAMENTO_FISICO"),
      unidad_medida: normalizeUpperText(pick(r, "UNIDAD_MEDIDA", "UNIDADMEDIDA", "TIPO DE VENTA", "TIPO_VENTA")) || "UNIDAD",
      costo_promedio: pickNumber(r, "COSTO_PROMEDIO", "P COSTO", "P. COSTO", "COSTO"),
      precio_venta: pickNumber(r, "PRECIO_VENTA", "P VENTA", "P. VENTA", "PRECIO"),
      precio_mayorista: mayoristaRaw,
      stock_actual: pickNumber(r, "STOCK_ACTUAL", "EXISTENCIA", "STOCK"),
      stock_minimo: pickNumber(r, "STOCK_MINIMO", "INV MINIMO", "INV. MÍNIMO", "INV. MINIMO", "INVENTARIO MINIMO"),
      metodo_valuacion,
      activo: pickBool(r, "ACTIVO"),
      errors,
      warnings,
    };
  });
}

export interface ResolverMaps {
  productosBySku: Map<string, ProductoExistente>;
  productosByCodigo: Map<string, ProductoExistente>;
  categoriasByName: Map<string, string>;
  proveedoresByName: Map<string, string>;
  ubicacionesByName: Map<string, string>;
  ubicacionesByCodigo: Map<string, string>;
}

export async function buildResolverMaps(schemaRaw: string, empresaId: string): Promise<ResolverMaps> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");
  const tP = quoteSchemaTable(schema, "productos");
  const tC = quoteSchemaTable(schema, "categorias_productos");
  const tPr = quoteSchemaTable(schema, "proveedores");
  const tU = quoteSchemaTable(schema, "inventario_ubicaciones");

  const [prods, cats, provs, ubis] = await Promise.all([
    pool.query<ProductoExistente>(
      `SELECT id, sku, codigo_barras, stock_actual,
              nombre, costo_promedio, precio_venta, precio_mayorista,
              stock_minimo, unidad_medida, ubicacion_deposito
         FROM ${tP} WHERE empresa_id=$1::uuid`,
      [empresaId]
    ),
    pool.query<{ id: string; nombre: string }>(`SELECT id, nombre FROM ${tC} WHERE empresa_id=$1::uuid AND activo=true`, [empresaId]),
    pool.query<{ id: string; nombre: string }>(`SELECT id, nombre FROM ${tPr} WHERE empresa_id=$1::uuid`, [empresaId]),
    pool.query<{ id: string; nombre: string; codigo: string | null }>(`SELECT id, nombre, codigo FROM ${tU} WHERE empresa_id=$1::uuid AND activo=true`, [empresaId]),
  ]);

  const productosBySku = new Map<string, ProductoExistente>();
  const productosByCodigo = new Map<string, ProductoExistente>();
  for (const p of prods.rows) {
    const normalized: ProductoExistente = {
      id: p.id, sku: p.sku, codigo_barras: p.codigo_barras,
      stock_actual: Number(p.stock_actual),
      nombre: p.nombre ?? "",
      costo_promedio: Number(p.costo_promedio ?? 0),
      precio_venta: Number(p.precio_venta ?? 0),
      precio_mayorista: p.precio_mayorista == null ? null : Number(p.precio_mayorista),
      stock_minimo: Number(p.stock_minimo ?? 0),
      unidad_medida: p.unidad_medida ?? "",
      ubicacion_deposito: p.ubicacion_deposito ?? null,
    };
    if (p.sku) productosBySku.set(p.sku.toUpperCase(), normalized);
    if (p.codigo_barras) productosByCodigo.set(p.codigo_barras.toUpperCase(), normalized);
  }
  const categoriasByName = new Map<string, string>();
  for (const c of cats.rows) categoriasByName.set(c.nombre.trim().toUpperCase(), c.id);
  const proveedoresByName = new Map<string, string>();
  for (const p of provs.rows) proveedoresByName.set(p.nombre.trim().toUpperCase(), p.id);
  const ubicacionesByName = new Map<string, string>();
  const ubicacionesByCodigo = new Map<string, string>();
  for (const u of ubis.rows) {
    ubicacionesByName.set(u.nombre.trim().toUpperCase(), u.id);
    if (u.codigo) ubicacionesByCodigo.set(u.codigo.trim().toUpperCase(), u.id);
  }
  return { productosBySku, productosByCodigo, categoriasByName, proveedoresByName, ubicacionesByName, ubicacionesByCodigo };
}

export function buildPreview(parsed: ProductoParsed[], maps: ResolverMaps): PreviewResponse {
  const catsFaltantes = new Set<string>();
  const provsFaltantes = new Set<string>();
  const ubisFaltantes = new Set<string>();
  let insertar = 0, actualizar = 0, errores = 0, warnings = 0;
  let totalEntrada = 0, totalSalida = 0, movimientosGenerar = 0;
  const omitir = 0;
  const skuVistos = new Set<string>();
  const codbarVistos = new Set<string>();

  const rows: PreviewRow[] = parsed.map((p) => {
    // Errores fila
    if (p.sku && skuVistos.has(p.sku)) p.errors.push(`SKU "${p.sku}" duplicado en el archivo.`);
    if (p.sku) skuVistos.add(p.sku);
    if (p.codigo_barras && codbarVistos.has(p.codigo_barras)) p.errors.push(`Código de barras "${p.codigo_barras}" duplicado en el archivo.`);
    if (p.codigo_barras) codbarVistos.add(p.codigo_barras);

    // Match contra DB existente
    let matchId: string | null = null;
    let stockAnterior: number | null = null;
    if (p.codigo_barras && maps.productosByCodigo.has(p.codigo_barras)) {
      const ex = maps.productosByCodigo.get(p.codigo_barras)!;
      matchId = ex.id; stockAnterior = ex.stock_actual;
    } else if (p.sku && maps.productosBySku.has(p.sku)) {
      const ex = maps.productosBySku.get(p.sku)!;
      matchId = ex.id; stockAnterior = ex.stock_actual;
    }
    p.match_id = matchId;

    // Faltantes
    if (p.categoria_nombre && !maps.categoriasByName.has(p.categoria_nombre)) {
      p.warnings.push(`Categoría "${p.categoria_nombre}" no existe.`);
      catsFaltantes.add(p.categoria_nombre);
    }
    if (p.proveedor_nombre && !maps.proveedoresByName.has(p.proveedor_nombre)) {
      p.warnings.push(`Proveedor "${p.proveedor_nombre}" no existe.`);
      provsFaltantes.add(p.proveedor_nombre);
    }
    if (p.ubicacion_nombre && !maps.ubicacionesByName.has(p.ubicacion_nombre) && !maps.ubicacionesByCodigo.has(p.ubicacion_nombre)) {
      p.warnings.push(`Ubicación "${p.ubicacion_nombre}" no existe.`);
      ubisFaltantes.add(p.ubicacion_nombre);
    }

    const hasErr = p.errors.length > 0;
    const action = hasErr ? "ERROR" : matchId ? "UPDATE" : "INSERT";
    if (action === "INSERT") insertar++;
    else if (action === "UPDATE") actualizar++;
    else if (action === "ERROR") errores++;
    if (p.warnings.length > 0) warnings++;

    // Calcular impacto de stock que se generara
    let stockMov: string = "SIN MOVIMIENTO";
    if (!hasErr) {
      if (action === "INSERT" && p.stock_actual > 0) {
        stockMov = `ENTRADA +${p.stock_actual}`;
        totalEntrada += p.stock_actual;
        movimientosGenerar++;
      } else if (action === "UPDATE" && stockAnterior != null) {
        const delta = p.stock_actual - stockAnterior;
        if (delta > 0) {
          stockMov = `ENTRADA +${delta} (prev=${stockAnterior})`;
          totalEntrada += delta; movimientosGenerar++;
        } else if (delta < 0) {
          stockMov = `SALIDA ${delta} (prev=${stockAnterior})`;
          totalSalida += -delta; movimientosGenerar++;
        }
      }
    }

    return {
      row_number: p.row_number,
      action: action as "INSERT" | "UPDATE" | "ERROR" | "SKIP",
      warnings: p.warnings,
      errors: p.errors,
      data: {
        NOMBRE: p.nombre, SKU: p.sku, CODIGO_BARRAS: p.codigo_barras || "(auto)",
        CATEGORIA: p.categoria_nombre, PROVEEDOR: p.proveedor_nombre, UBICACION: p.ubicacion_nombre,
        COSTO: p.costo_promedio, PRECIO: p.precio_venta, STOCK: p.stock_actual,
        STOCK_ANTERIOR: stockAnterior ?? "",
        MOVIMIENTO: stockMov,
      },
    };
  });

  return {
    summary: {
      total: parsed.length,
      insertar, actualizar, omitir, errores, warnings,
      faltantes: {
        categorias: [...catsFaltantes],
        proveedores: [...provsFaltantes],
        ubicaciones: [...ubisFaltantes],
      },
      movimientos_a_generar: movimientosGenerar,
      unidades_entrada: totalEntrada,
      unidades_salida: totalSalida,
    },
    rows,
    headers: ["NOMBRE","SKU","CODIGO_BARRAS","CATEGORIA","PROVEEDOR_PRINCIPAL","UBICACION_PRINCIPAL","DEPARTAMENTO","UNIDAD_MEDIDA","COSTO_PROMEDIO","PRECIO_VENTA","PRECIO_MAYORISTA","STOCK_ACTUAL","STOCK_MINIMO","METODO_VALUACION","ACTIVO"],
  };
}

export interface CommitOutcome {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  warnings: number;
  movimientos_generados: number;
  unidades_entrada: number;
  unidades_salida: number;
  errorMessages: string[];
  warningMessages: string[];
}

export interface CommitContext {
  filename?: string | null;
  createdBy?: string | null;
  usuarioNombre?: string | null;
}

export async function commitProductos(
  schemaRaw: string,
  empresaId: string,
  parsed: ProductoParsed[],
  maps: ResolverMaps,
  crearFaltantes: boolean,
  ctx: CommitContext = {}
): Promise<CommitOutcome> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const poolMaybe = getChatPostgresPool();
  if (!poolMaybe) throw new Error("Pool no disponible.");
  const pool = poolMaybe;
  const tP = quoteSchemaTable(schema, "productos");
  const tC = quoteSchemaTable(schema, "categorias_productos");
  const tPr = quoteSchemaTable(schema, "proveedores");
  const tU = quoteSchemaTable(schema, "inventario_ubicaciones");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tSec = `"${schema.replace(/"/g, '""')}".incrementar_secuencia_producto`;
  const refImport = `IMPORT_EXCEL:${(ctx.filename ?? "").slice(0, 80)}`;

  const out: CommitOutcome = {
    inserted: 0, updated: 0, skipped: 0, errors: 0, warnings: 0,
    movimientos_generados: 0, unidades_entrada: 0, unidades_salida: 0,
    errorMessages: [], warningMessages: [],
  };

  // Tracker de fallas sistemáticas: si TODOS los INSERTs a movimientos fallan
  // por el mismo motivo (típicamente FK violation o columna inexistente), no
  // queremos ahogar al usuario con 4000 warnings idénticos — guardamos los
  // primeros N detallados y emitimos un error de resumen al final.
  let movimientosFallidos = 0;
  const movimientoFailSamples: string[] = [];
  let movimientoFailFirstCode: string | null = null;
  const MOVIMIENTO_FAIL_SAMPLE_LIMIT = 5;

  async function registrarMovimiento(
    producto_id: string, producto_nombre: string, producto_sku: string,
    tipo: "ENTRADA" | "SALIDA", origen: "inventario_inicial" | "ajuste_manual",
    cantidad: number, costo_unitario: number, refExtra?: string
  ): Promise<void> {
    if (cantidad <= 0) return;
    const refFinal = refExtra ? `${refImport} ${refExtra}` : refImport;
    try {
      await pool.query(
        `INSERT INTO ${tM} (
           empresa_id, producto_id, producto_nombre, producto_sku,
           tipo, cantidad, costo_unitario, origen, referencia, fecha,
           created_by, usuario_nombre
         ) VALUES (
           $1::uuid, $2::uuid, $3, $4, $5, $6::numeric, $7::numeric, $8, $9, now(),
           $10::uuid, $11
         )`,
        [empresaId, producto_id, producto_nombre, producto_sku, tipo, cantidad,
         costo_unitario, origen, refFinal, ctx.createdBy ?? null, ctx.usuarioNombre ?? null]
      );
      out.movimientos_generados++;
      if (tipo === "ENTRADA") out.unidades_entrada += cantidad;
      else out.unidades_salida += cantidad;
    } catch (e) {
      movimientosFallidos++;
      const err = e as Error & { code?: string };
      if (movimientoFailFirstCode == null) movimientoFailFirstCode = err.code ?? "UNKNOWN";
      if (movimientoFailSamples.length < MOVIMIENTO_FAIL_SAMPLE_LIMIT) {
        movimientoFailSamples.push(
          `[${err.code ?? "?"}] ${producto_nombre} (sku=${producto_sku}): ${err.message.slice(0, 140)}`
        );
      }
    }
  }

  // Crear faltantes (categorias/proveedores/ubicaciones) si corresponde
  if (crearFaltantes) {
    const cats = new Set<string>();
    const provs = new Set<string>();
    const ubis = new Set<string>();
    for (const p of parsed) {
      if (p.categoria_nombre && !maps.categoriasByName.has(p.categoria_nombre)) cats.add(p.categoria_nombre);
      if (p.proveedor_nombre && !maps.proveedoresByName.has(p.proveedor_nombre)) provs.add(p.proveedor_nombre);
      if (p.ubicacion_nombre && !maps.ubicacionesByName.has(p.ubicacion_nombre) && !maps.ubicacionesByCodigo.has(p.ubicacion_nombre)) ubis.add(p.ubicacion_nombre);
    }
    for (const nombre of cats) {
      try {
        const r = await pool.query<{ id: string }>(`INSERT INTO ${tC} (empresa_id, nombre, activo) VALUES ($1::uuid,$2,true) RETURNING id`, [empresaId, nombre]);
        maps.categoriasByName.set(nombre, r.rows[0].id);
        out.warningMessages.push(`Categoría creada: ${nombre}`);
      } catch (e) { out.errorMessages.push(`No se pudo crear categoría ${nombre}: ${(e as Error).message}`); }
    }
    for (const nombre of provs) {
      try {
        const r = await pool.query<{ id: string }>(`INSERT INTO ${tPr} (empresa_id, nombre, estado) VALUES ($1::uuid,$2,'activo') RETURNING id`, [empresaId, nombre]);
        maps.proveedoresByName.set(nombre, r.rows[0].id);
        out.warningMessages.push(`Proveedor creado: ${nombre}`);
      } catch (e) { out.errorMessages.push(`No se pudo crear proveedor ${nombre}: ${(e as Error).message}`); }
    }
    for (const nombre of ubis) {
      try {
        const r = await pool.query<{ id: string }>(`INSERT INTO ${tU} (empresa_id, nombre, tipo, activo) VALUES ($1::uuid,$2,'otro',true) RETURNING id`, [empresaId, nombre]);
        maps.ubicacionesByName.set(nombre, r.rows[0].id);
        out.warningMessages.push(`Ubicación creada: ${nombre} (tipo: otro)`);
      } catch (e) { out.errorMessages.push(`No se pudo crear ubicación ${nombre}: ${(e as Error).message}`); }
    }
  }

  // Procesar productos en chunks, PARALELIZADOS dentro de cada chunk.
  // Con 5924 SKUs y queries secuenciales (~3 por fila × 50ms = 150ms/fila)
  // el import tardaba ~15 min y excedía el timeout HTTP. Promise.all dentro
  // de cada chunk de 200 corre limitado por la pool (default 10 conexiones)
  // sin saturarla, y baja el wall-time a 2-3 min para el catálogo completo.
  for (const chunk of chunked(parsed, 200)) {
    await Promise.all(chunk.map(async (p) => {
      if (p.errors.length > 0) { out.errors++; out.errorMessages.push(`Fila ${p.row_number}: ${p.errors.join("; ")}`); return; }
      const categoriaId = p.categoria_nombre ? maps.categoriasByName.get(p.categoria_nombre) ?? null : null;
      const proveedorId = p.proveedor_nombre ? maps.proveedoresByName.get(p.proveedor_nombre) ?? null : null;
      const ubicacionId = p.ubicacion_nombre
        ? (maps.ubicacionesByName.get(p.ubicacion_nombre) ?? maps.ubicacionesByCodigo.get(p.ubicacion_nombre) ?? null)
        : null;

      try {
        if (p.match_id) {
          // UPDATE — el stock anterior ya lo tenemos en maps (cargado por
          // buildResolverMaps). Evitamos un SELECT extra por fila.
          const existente = (p.sku && maps.productosBySku.get(p.sku))
            || (p.codigo_barras && maps.productosByCodigo.get(p.codigo_barras))
            || null;
          const stockAnterior = Number(existente?.stock_actual ?? 0);

          // No-op detection: si todos los campos relevantes son idénticos
          // a lo que ya está en DB, no hacemos ni UPDATE ni movimiento.
          // Esto es CRÍTICO para imports masivos donde el Excel no cambió
          // (caso de Felix Bogado: 6k SKUs re-importados sin cambios).
          if (existente) {
            const igual =
              existente.nombre === p.nombre &&
              Number(existente.costo_promedio) === Number(p.costo_promedio) &&
              Number(existente.precio_venta) === Number(p.precio_venta) &&
              Number(existente.precio_mayorista ?? 0) === Number(p.precio_mayorista ?? 0) &&
              Number(existente.stock_actual) === Number(p.stock_actual) &&
              Number(existente.stock_minimo) === Number(p.stock_minimo) &&
              (existente.unidad_medida ?? "") === (p.unidad_medida ?? "") &&
              (existente.ubicacion_deposito ?? "") === (p.ubicacion_deposito ?? "") &&
              (existente.codigo_barras ?? "") === (p.codigo_barras ?? "");
            if (igual) { out.skipped++; return; }
          }

          await pool.query(
            `UPDATE ${tP} SET
               nombre=$1, sku=$2, codigo_barras=NULLIF($3,''),
               unidad_medida=$4, costo_promedio=$5::numeric, precio_venta=$6::numeric,
               stock_actual=$7::numeric, stock_minimo=$8::numeric,
               metodo_valuacion=$9, activo=$10::boolean,
               categoria_principal_id=$11::uuid, proveedor_principal_id=$12::uuid, ubicacion_principal_id=$13::uuid,
               precio_mayorista=NULLIF($14::numeric, 0),
               ubicacion_deposito=NULLIF($15, ''),
               updated_at=now()
             WHERE id=$16::uuid AND empresa_id=$17::uuid`,
            [p.nombre, p.sku, p.codigo_barras, p.unidad_medida, p.costo_promedio, p.precio_venta,
             p.stock_actual, p.stock_minimo, p.metodo_valuacion, p.activo,
             categoriaId, proveedorId, ubicacionId,
             p.precio_mayorista, p.ubicacion_deposito,
             p.match_id, empresaId]
          );
          out.updated++;
          // Movimiento por delta (ajuste_manual + ENTRADA/SALIDA segun signo)
          const delta = p.stock_actual - stockAnterior;
          if (delta !== 0) {
            await registrarMovimiento(
              p.match_id, p.nombre, p.sku,
              delta > 0 ? "ENTRADA" : "SALIDA", "ajuste_manual",
              Math.abs(delta), p.costo_promedio,
              `Δ ${delta > 0 ? "+" : ""}${delta} (prev=${stockAnterior} new=${p.stock_actual})`
            );
          }
        } else {
          // Generar codigo_barras_interno si no vino
          let codigoBarras = p.codigo_barras;
          let codigoInterno = false;
          if (!codigoBarras) {
            try {
              const r = await pool.query<{ v: string }>(`SELECT ${tSec}($1::uuid) AS v`, [empresaId]);
              const seq = Number(r.rows[0]?.v ?? 0);
              if (seq > 0) {
                codigoBarras = `INT-${String(seq).padStart(6, "0")}`;
                codigoInterno = true;
              }
            } catch (e) { out.warningMessages.push(`Fila ${p.row_number}: no se pudo generar código interno (${(e as Error).message})`); }
          }
          const inserted = await pool.query<{ id: string }>(
            `INSERT INTO ${tP} (
               empresa_id, nombre, sku, codigo_barras, codigo_barras_interno,
               unidad_medida, costo_promedio, precio_venta, stock_actual, stock_minimo,
               metodo_valuacion, activo, categoria_principal_id, proveedor_principal_id, ubicacion_principal_id,
               precio_mayorista, ubicacion_deposito
             ) VALUES (
               $1::uuid, $2, NULLIF($3,''), NULLIF($4,''), $5::boolean,
               $6, $7::numeric, $8::numeric, $9::numeric, $10::numeric,
               $11, $12::boolean, $13::uuid, $14::uuid, $15::uuid,
               NULLIF($16::numeric, 0), NULLIF($17, '')
             ) RETURNING id`,
            [empresaId, p.nombre, p.sku, codigoBarras, codigoInterno,
             p.unidad_medida, p.costo_promedio, p.precio_venta, p.stock_actual, p.stock_minimo,
             p.metodo_valuacion, p.activo, categoriaId, proveedorId, ubicacionId,
             p.precio_mayorista, p.ubicacion_deposito]
          );
          out.inserted++;
          // Movimiento de inventario inicial si stock > 0
          if (p.stock_actual > 0 && inserted.rows[0]?.id) {
            await registrarMovimiento(
              inserted.rows[0].id, p.nombre, p.sku,
              "ENTRADA", "inventario_inicial",
              p.stock_actual, p.costo_promedio
            );
          }
        }
        if (p.warnings.length > 0) out.warnings++;
      } catch (e) {
        out.errors++;
        const msg = (e as Error).message;
        const code = (e as { code?: string })?.code;
        if (code === "23505") {
          out.errorMessages.push(`Fila ${p.row_number}: SKU/Código duplicado (${msg.slice(0, 80)})`);
        } else {
          out.errorMessages.push(`Fila ${p.row_number}: ${msg.slice(0, 200)}`);
        }
      }
    }));
  }

  // Si TODOS (o casi todos) los movimientos fallaron, es un problema sistémico
  // (FK mal apuntada, columna inexistente, etc.) que el usuario tiene que ver
  // como ERROR, no como warning. Antes esto se atragantaba en warnings y la
  // importación se reportaba "exitosa" pese a perder miles de movimientos.
  if (movimientosFallidos > 0) {
    const intentados = out.movimientos_generados + movimientosFallidos;
    const pctFallidos = (movimientosFallidos / intentados) * 100;
    const resumen =
      `No se pudieron registrar ${movimientosFallidos} de ${intentados} movimientos de inventario ` +
      `(${pctFallidos.toFixed(0)}%, código=${movimientoFailFirstCode}). ` +
      `Ejemplos:\n  - ${movimientoFailSamples.join("\n  - ")}`;
    if (pctFallidos >= 50) {
      // Falla sistémica: error duro para que se vea en rojo en el wizard.
      out.errorMessages.push(resumen);
      out.errors += movimientosFallidos;
    } else {
      // Fallas aisladas: warning con detalle, no error.
      out.warningMessages.push(resumen);
      out.warnings += movimientosFallidos;
    }
  }

  return out;
}

/** Helper sin uso directo aqui pero util al exponer en templates */
export const PRODUCTOS_TEMPLATE_ROW = {
  NOMBRE: "EJEMPLO PRODUCTO",
  SKU: "EJ-001",
  CODIGO_BARRAS: "",
  CATEGORIA: "ELECTRICIDAD",
  PROVEEDOR_PRINCIPAL: "DON HERRAMIENTAS SA",
  UBICACION_PRINCIPAL: "DEPOSITO CENTRAL",
  UNIDAD_MEDIDA: "UNIDAD",
  COSTO_PROMEDIO: 10000,
  PRECIO_VENTA: 15000,
  STOCK_ACTUAL: 10,
  STOCK_MINIMO: 2,
  METODO_VALUACION: "CPP",
  ACTIVO: "SI",
};
// Util para detectar uso por linter
export const _unused = normalizeUpperNullable;
