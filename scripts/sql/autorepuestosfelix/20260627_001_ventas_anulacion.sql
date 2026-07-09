-- Auditoría de anulación de ventas. Aditiva e idempotente.
DO $$
DECLARE
  sch text := 'autorepuestosfelix';
BEGIN
  IF to_regclass(format('%I.ventas', sch)) IS NULL THEN
    RAISE NOTICE '[ventas_anulacion] schema % sin tabla ventas; se omite.', sch;
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE %I.ventas ADD COLUMN IF NOT EXISTS anulada_at timestamptz', sch);
  EXECUTE format('ALTER TABLE %I.ventas ADD COLUMN IF NOT EXISTS anulada_por_id uuid', sch);
  EXECUTE format('ALTER TABLE %I.ventas ADD COLUMN IF NOT EXISTS motivo_anulacion text', sch);

  RAISE NOTICE '[ventas_anulacion] columnas aplicadas en schema %.', sch;
END $$;
