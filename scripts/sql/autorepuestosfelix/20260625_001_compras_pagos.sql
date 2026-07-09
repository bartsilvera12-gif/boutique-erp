-- =====================================================================
-- Autorepuestos Felix Bogado — Cuentas por pagar (Fase 1).
-- Tabla nueva `compras_pagos`: cada fila es un pago hecho al proveedor
-- por un documento (identificado por numero_control). Un documento del
-- proveedor puede tener N pagos (pago parcial, a cuenta, saldo final).
--
-- Aditiva. Idempotente. Sólo toca el schema `autorepuestosfelix`.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS autorepuestosfelix.compras_pagos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid        NOT NULL REFERENCES autorepuestosfelix.empresas(id) ON DELETE CASCADE,
  -- Agrupador: identifica el documento del proveedor (Nro de factura/recibo
  -- recibida) que se está pagando. Coincide con compras.numero_control.
  numero_control  text        NOT NULL,
  -- FK opcional al proveedor (para reportes/joins rápidos sin pasar por compras).
  proveedor_id    uuid        REFERENCES autorepuestosfelix.proveedores(id) ON DELETE SET NULL,
  proveedor_nombre text,
  monto           numeric(14,2) NOT NULL CHECK (monto > 0),
  moneda          text        NOT NULL DEFAULT 'PYG',
  metodo_pago     text        NOT NULL CHECK (metodo_pago IN ('efectivo','transferencia','tarjeta','cheque','otro')),
  -- Detalle de cobro (conciliación bancaria): qué entidad / referencia.
  entidad_id      uuid,
  entidad_nombre  text,
  referencia      text,
  observaciones   text,
  fecha           timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  usuario_nombre  text
);

CREATE INDEX IF NOT EXISTS compras_pagos_empresa_fecha_ix
  ON autorepuestosfelix.compras_pagos (empresa_id, fecha DESC);

CREATE INDEX IF NOT EXISTS compras_pagos_numero_control_ix
  ON autorepuestosfelix.compras_pagos (empresa_id, numero_control);

CREATE INDEX IF NOT EXISTS compras_pagos_proveedor_ix
  ON autorepuestosfelix.compras_pagos (empresa_id, proveedor_id)
  WHERE proveedor_id IS NOT NULL;

COMMIT;
