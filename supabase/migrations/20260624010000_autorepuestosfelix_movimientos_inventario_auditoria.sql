-- =============================================================================
-- Fix correctivo para autorepuestosfelix.movimientos_inventario:
--
-- La migración 20260518180000_movimientos_inventario_fk_local_y_auditoria.sql
-- solo aplicaba a schemas que matcheaban ('public', 'zentra_erp',
-- '^er_[0-9a-f]{32}$', 'erp\_%'). El schema 'autorepuestosfelix' quedó afuera.
-- Consecuencias observadas:
--   1) FK producto_id apuntaba a public.productos (las filas no existen ahí)
--      → todo INSERT desde el importador Excel fallaba con 23503 (FK violation),
--      atrapado silenciosamente por registrarMovimiento(). Resultado: 0
--      movimientos registrados pese a importar miles de productos con stock > 0.
--   2) Faltaban las columnas de auditoría created_by / usuario_nombre, que el
--      importador y otros callers ya intentan setear.
--
-- Esta migración aplica el mismo fix de forma directa, idempotente y aditiva.
-- =============================================================================

-- 1) Columnas de auditoría (aditivas)
ALTER TABLE autorepuestosfelix.movimientos_inventario
  ADD COLUMN IF NOT EXISTS created_by      uuid,
  ADD COLUMN IF NOT EXISTS usuario_nombre  text;

-- 2) FK de producto_id apuntando a la tabla LOCAL del mismo schema.
DO $$
BEGIN
  ALTER TABLE autorepuestosfelix.movimientos_inventario
    DROP CONSTRAINT IF EXISTS movimientos_inventario_producto_id_fkey;
  ALTER TABLE autorepuestosfelix.movimientos_inventario
    ADD CONSTRAINT movimientos_inventario_producto_id_fkey
    FOREIGN KEY (producto_id)
    REFERENCES autorepuestosfelix.productos(id)
    ON DELETE RESTRICT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'autorepuestosfelix.movimientos_inventario FK producto_id: %', SQLERRM;
END;
$$;

-- 3) Índice por created_by para consultas de auditoría.
CREATE INDEX IF NOT EXISTS idx_movimientos_inventario_created_by
  ON autorepuestosfelix.movimientos_inventario (created_by);
