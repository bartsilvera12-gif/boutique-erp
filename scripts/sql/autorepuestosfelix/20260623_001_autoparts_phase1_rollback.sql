-- =====================================================================
-- Rollback de 20260623_001_autoparts_phase1.sql
-- Sólo correr si necesitás revertir todo. No es idempotente respecto
-- de datos: si ya hay filas en las tablas nuevas o valores en las
-- columnas nuevas, se pierden.
-- =====================================================================

BEGIN;

DROP TABLE IF EXISTS autorepuestosfelix.cliente_vehiculo CASCADE;
DROP TABLE IF EXISTS autorepuestosfelix.producto_compatibilidad_vehiculo CASCADE;

ALTER TABLE autorepuestosfelix.productos
  DROP COLUMN IF EXISTS codigo_oem,
  DROP COLUMN IF EXISTS codigo_alternativo,
  DROP COLUMN IF EXISTS marca_repuesto,
  DROP COLUMN IF EXISTS garantia_meses,
  DROP COLUMN IF EXISTS permitir_venta_sin_stock,
  DROP COLUMN IF EXISTS ubicacion_deposito,
  DROP COLUMN IF EXISTS ubicacion_pasillo,
  DROP COLUMN IF EXISTS ubicacion_estante,
  DROP COLUMN IF EXISTS ubicacion_caja;

DROP INDEX IF EXISTS autorepuestosfelix.productos_codigo_oem_ix;
DROP INDEX IF EXISTS autorepuestosfelix.productos_codigo_alternativo_ix;
DROP INDEX IF EXISTS autorepuestosfelix.productos_marca_repuesto_ix;

-- El UNIQUE en categorias_productos se deja: protege duplicados aun
-- después del rollback (útil siempre). Si querés quitarlo:
-- DROP INDEX IF EXISTS autorepuestosfelix.categorias_productos_empresa_nombre_uniq;

-- El seed de categorías NO se borra automáticamente: si necesitás
-- limpiarlo, hacelo manual y verificá que ningún producto las use.

COMMIT;
