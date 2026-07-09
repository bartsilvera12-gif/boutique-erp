-- Auditoría de anulación de compras. Aditiva e idempotente.
-- Espejo de ventas_anulacion (commit ea23986).
DO $$
DECLARE
  sch text := 'autorepuestosfelix';
BEGIN
  IF to_regclass(format('%I.compras', sch)) IS NULL THEN
    RAISE NOTICE '[compras_anulacion] schema % sin tabla compras; se omite.', sch;
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE %I.compras ADD COLUMN IF NOT EXISTS anulada_at timestamptz', sch);
  EXECUTE format('ALTER TABLE %I.compras ADD COLUMN IF NOT EXISTS anulada_por_id uuid', sch);
  EXECUTE format('ALTER TABLE %I.compras ADD COLUMN IF NOT EXISTS motivo_anulacion text', sch);

  RAISE NOTICE '[compras_anulacion] columnas aplicadas en schema %.', sch;
END $$;
