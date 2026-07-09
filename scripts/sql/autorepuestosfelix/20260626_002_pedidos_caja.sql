-- =============================================================================
-- Tabla `pedidos_caja` — schema `autorepuestosfelix`.
--
-- Flujo: el vendedor arma un pedido en /buscador → fila aquí en estado
-- 'pendiente' → el cajero lo ve en /ventas → al cobrar pasa a 'facturado'
-- con venta_id.
--
-- Reemplaza el uso forzado de `proyectos` (heredado del repo lomitería).
-- Este ERP no tiene módulo de proyectos, no tiene sentido pasar por ahí.
--
-- Aditiva, idempotente. Sin RLS (mismo patrón que el resto del schema).
-- =============================================================================

DO $$
DECLARE
  sch text := 'autorepuestosfelix';
BEGIN
  IF to_regclass(format('%I.ventas', sch)) IS NULL THEN
    RAISE NOTICE '[pedidos_caja] schema % sin tabla ventas; se omite.', sch;
    RETURN;
  END IF;

  IF to_regclass(format('%I.pedidos_caja', sch)) IS NULL THEN
    EXECUTE format($ddl$
      CREATE TABLE %I.pedidos_caja (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        titulo text NOT NULL,
        cliente_id uuid,
        cliente_nombre text,
        cliente_telefono text,
        observacion text,
        items jsonb NOT NULL DEFAULT '[]'::jsonb,
        total_estimado numeric(14,2) NOT NULL DEFAULT 0,
        estado text NOT NULL DEFAULT 'pendiente'
          CHECK (estado IN ('pendiente','facturado','cancelado')),
        venta_id uuid,
        venta_numero text,
        armado_por_id uuid,
        armado_por_email text,
        cancelado_por_id uuid,
        cancelado_motivo text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        facturado_at timestamptz,
        cancelado_at timestamptz
      )
    $ddl$, sch);
  END IF;

  EXECUTE format('CREATE INDEX IF NOT EXISTS ix_pedidos_caja_empresa_estado ON %I.pedidos_caja (empresa_id, estado, created_at DESC)', sch);
  EXECUTE format('CREATE INDEX IF NOT EXISTS ix_pedidos_caja_empresa_armado ON %I.pedidos_caja (empresa_id, armado_por_id, created_at DESC)', sch);
  EXECUTE format('CREATE INDEX IF NOT EXISTS ix_pedidos_caja_venta ON %I.pedidos_caja (empresa_id, venta_id) WHERE venta_id IS NOT NULL', sch);

  -- Trigger para updated_at
  EXECUTE format($ddl$
    CREATE OR REPLACE FUNCTION %I.fn_pedidos_caja_set_updated_at()
    RETURNS trigger AS $f$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $f$ LANGUAGE plpgsql;
  $ddl$, sch);

  EXECUTE format('DROP TRIGGER IF EXISTS tr_pedidos_caja_updated ON %I.pedidos_caja', sch);
  EXECUTE format('CREATE TRIGGER tr_pedidos_caja_updated BEFORE UPDATE ON %I.pedidos_caja FOR EACH ROW EXECUTE FUNCTION %I.fn_pedidos_caja_set_updated_at()', sch, sch);

  RAISE NOTICE '[pedidos_caja] tabla y triggers aplicados en schema %.', sch;
END $$;
