-- =============================================================================
-- Backfill: generar movimientos "inventario_inicial" para productos que ya
-- tienen stock_actual > 0 pero NO tienen ningún movimiento en
-- autorepuestosfelix.movimientos_inventario.
--
-- Contexto: la importación masiva del catálogo Excel intentó registrar los
-- movimientos de stock inicial, pero todos los INSERTs fallaron con FK violation
-- (producto_id apuntaba a public.productos). El error se atrapaba como warning,
-- así que se perdieron ~4147 movimientos silenciosamente.
--
-- Pre-requisito: aplicar primero
--   20260624010000_autorepuestosfelix_movimientos_inventario_auditoria.sql
-- (corrige FKs y agrega columnas created_by / usuario_nombre).
--
-- Idempotente: solo inserta para productos sin ningún movimiento previo, así
-- que correrlo dos veces no duplica filas.
-- =============================================================================

INSERT INTO autorepuestosfelix.movimientos_inventario (
  empresa_id, producto_id, producto_nombre, producto_sku,
  tipo, cantidad, costo_unitario, origen, referencia, fecha,
  created_by, usuario_nombre
)
SELECT
  p.empresa_id,
  p.id,
  p.nombre,
  COALESCE(p.sku, ''),
  'ENTRADA',
  p.stock_actual,
  COALESCE(p.costo_promedio, 0),
  'inventario_inicial',
  'BACKFILL_IMPORT_EXCEL:catalogo.xls',
  COALESCE(p.created_at, now()),
  NULL,
  'backfill_sistema'
FROM autorepuestosfelix.productos p
WHERE p.stock_actual > 0
  AND NOT EXISTS (
    SELECT 1
    FROM autorepuestosfelix.movimientos_inventario m
    WHERE m.producto_id = p.id
  );
