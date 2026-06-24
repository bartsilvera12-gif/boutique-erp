-- =============================================================================
-- Módulo CAJA por turno — schema `autorepuestosfelix`.
-- Portado desde enlodemari (2026-06-14). Mismo modelo: caja = turno, no día.
--
-- Crea:
--   · autorepuestosfelix.cajas             (turno: apertura/cierre/arqueo)
--   · autorepuestosfelix.caja_movimientos  (ingresos/egresos/retiros/ajustes)
--   · autorepuestosfelix.ventas.caja_id    (asocia venta a turno)
--
-- Reglas:
--   · Aditiva e idempotente.
--   · Schema-local: el catálogo de usuarios vive en zentra_erp; los nombres se
--     resuelven con un cross-schema query desde la capa server.
--   · Una sola caja ABIERTA por empresa (índice único parcial).
--   · NO reasigna ventas históricas: caja_id queda NULL en las previas.
-- =============================================================================

DO $$
DECLARE
  sch text := 'autorepuestosfelix';
BEGIN
  IF to_regclass(format('%I.ventas', sch)) IS NULL THEN
    RAISE NOTICE '[caja] schema % sin tabla ventas; se omite.', sch;
    RETURN;
  END IF;

  -- ── 1) Tabla cajas ────────────────────────────────────────────────────────
  IF to_regclass(format('%I.cajas', sch)) IS NULL THEN
    EXECUTE format($ddl$
      CREATE TABLE %I.cajas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        numero_caja bigint NOT NULL,
        estado text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada')),
        abierta_por uuid,
        cerrada_por uuid,
        fecha_apertura timestamptz NOT NULL DEFAULT now(),
        fecha_cierre timestamptz,
        monto_apertura numeric(14,2) NOT NULL DEFAULT 0,
        monto_cierre_contado numeric(14,2),
        monto_esperado_efectivo numeric(14,2),
        diferencia numeric(14,2),
        observacion_apertura text,
        observacion_cierre text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_cajas_empresa_numero UNIQUE (empresa_id, numero_caja)
      )
    $ddl$, sch);
  END IF;

  EXECUTE format('CREATE INDEX IF NOT EXISTS ix_cajas_empresa_estado ON %I.cajas (empresa_id, estado)', sch);
  EXECUTE format('CREATE INDEX IF NOT EXISTS ix_cajas_empresa_apertura ON %I.cajas (empresa_id, fecha_apertura DESC)', sch);
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS uq_cajas_una_abierta ON %I.cajas (empresa_id) WHERE estado = ''abierta''', sch);

  -- Sin RLS: se accede vía service-role desde el server (mismo patrón que
  -- el resto de tablas de este schema en este proyecto).

  -- ── 2) Tabla caja_movimientos ─────────────────────────────────────────────
  IF to_regclass(format('%I.caja_movimientos', sch)) IS NULL THEN
    EXECUTE format($ddl$
      CREATE TABLE %I.caja_movimientos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        caja_id uuid NOT NULL REFERENCES %I.cajas(id) ON DELETE CASCADE,
        tipo text NOT NULL CHECK (tipo IN ('ingreso','egreso','retiro','ajuste')),
        concepto text NOT NULL,
        monto numeric(14,2) NOT NULL,
        medio_pago text NOT NULL DEFAULT 'efectivo',
        usuario_id uuid,
        observacion text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_caja_mov_concepto_non_empty CHECK (length(trim(concepto)) > 0)
      )
    $ddl$, sch, sch);
  END IF;

  EXECUTE format('CREATE INDEX IF NOT EXISTS ix_caja_mov_caja ON %I.caja_movimientos (empresa_id, caja_id, created_at)', sch);

  -- ── 3) ventas.caja_id ─────────────────────────────────────────────────────
  EXECUTE format('ALTER TABLE %I.ventas ADD COLUMN IF NOT EXISTS caja_id uuid', sch);
  EXECUTE format('CREATE INDEX IF NOT EXISTS ix_ventas_caja ON %I.ventas (empresa_id, caja_id)', sch);

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = sch AND c.relname = 'ventas' AND con.conname = 'ventas_caja_id_fkey'
  ) THEN
    BEGIN
      EXECUTE format('ALTER TABLE %I.ventas ADD CONSTRAINT ventas_caja_id_fkey
        FOREIGN KEY (caja_id) REFERENCES %I.cajas(id) ON DELETE SET NULL', sch, sch);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[caja] no se pudo crear FK ventas.caja_id: %', SQLERRM;
    END;
  END IF;

  RAISE NOTICE '[caja] modulo de caja por turno aplicado en schema %.', sch;
END $$;
