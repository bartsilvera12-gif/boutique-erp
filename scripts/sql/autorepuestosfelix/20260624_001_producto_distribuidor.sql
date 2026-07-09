-- =====================================================================
-- Autorepuestos Felix Bogado — Distribuidor por producto (fase 7).
-- Aditiva. Idempotente. SÓLO toca el schema `autorepuestosfelix`.
--
-- Cada repuesto puede tener un distribuidor asociado (texto libre) y un
-- porcentaje de comisión que se le paga / retiene al venderlo.
-- =====================================================================

BEGIN;

ALTER TABLE autorepuestosfelix.productos
  ADD COLUMN IF NOT EXISTS distribuidor_nombre        text,
  ADD COLUMN IF NOT EXISTS distribuidor_comision_pct  numeric(5,2);

ALTER TABLE autorepuestosfelix.productos
  DROP CONSTRAINT IF EXISTS productos_distribuidor_comision_pct_check;
ALTER TABLE autorepuestosfelix.productos
  ADD CONSTRAINT productos_distribuidor_comision_pct_check
  CHECK (
    distribuidor_comision_pct IS NULL
    OR (distribuidor_comision_pct >= 0 AND distribuidor_comision_pct <= 100)
  );

-- Índice case-insensitive para buscar productos por distribuidor.
CREATE INDEX IF NOT EXISTS productos_distribuidor_nombre_ix
  ON autorepuestosfelix.productos (empresa_id, lower(distribuidor_nombre))
  WHERE distribuidor_nombre IS NOT NULL;

COMMIT;
