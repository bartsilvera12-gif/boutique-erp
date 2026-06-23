-- =====================================================================
-- Autorepuestos Felix Bogado — Fase 1 (DB)
-- Aditiva. Idempotente. SÓLO toca el schema `autorepuestosfelix`.
--
-- 1) Columnas nuevas en `productos` para datos del rubro autopartes.
-- 2) Índices de búsqueda por OEM / alternativo / marca repuesto.
-- 3) Tabla `producto_compatibilidad_vehiculo` (1-N producto → vehículos).
-- 4) Tabla `cliente_vehiculo` (1-N cliente → autos del cliente).
-- 5) UNIQUE (empresa_id, lower(nombre)) en `categorias_productos` +
--    seed del catálogo sugerido para autorepuestos.
--
-- Reversible vía 20260623_001_autoparts_phase1_rollback.sql (DROP de las
-- tablas nuevas y de las columnas agregadas).
-- =====================================================================

BEGIN;

-- 1) Columnas nuevas en productos -------------------------------------
ALTER TABLE autorepuestosfelix.productos
  ADD COLUMN IF NOT EXISTS codigo_oem               text,
  ADD COLUMN IF NOT EXISTS codigo_alternativo       text,
  ADD COLUMN IF NOT EXISTS marca_repuesto           text,
  ADD COLUMN IF NOT EXISTS garantia_meses           integer,
  ADD COLUMN IF NOT EXISTS permitir_venta_sin_stock boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ubicacion_deposito       text,
  ADD COLUMN IF NOT EXISTS ubicacion_pasillo        text,
  ADD COLUMN IF NOT EXISTS ubicacion_estante        text,
  ADD COLUMN IF NOT EXISTS ubicacion_caja           text;

-- 2) Índices de búsqueda case-insensitive por códigos y marca --------
CREATE INDEX IF NOT EXISTS productos_codigo_oem_ix
  ON autorepuestosfelix.productos (empresa_id, lower(codigo_oem))
  WHERE codigo_oem IS NOT NULL;

CREATE INDEX IF NOT EXISTS productos_codigo_alternativo_ix
  ON autorepuestosfelix.productos (empresa_id, lower(codigo_alternativo))
  WHERE codigo_alternativo IS NOT NULL;

CREATE INDEX IF NOT EXISTS productos_marca_repuesto_ix
  ON autorepuestosfelix.productos (empresa_id, lower(marca_repuesto))
  WHERE marca_repuesto IS NOT NULL;

-- 3) Compatibilidad vehicular ----------------------------------------
CREATE TABLE IF NOT EXISTS autorepuestosfelix.producto_compatibilidad_vehiculo (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid        NOT NULL REFERENCES autorepuestosfelix.empresas(id) ON DELETE CASCADE,
  producto_id     uuid        NOT NULL REFERENCES autorepuestosfelix.productos(id) ON DELETE CASCADE,
  marca_vehiculo  text        NOT NULL,
  modelo_vehiculo text        NOT NULL,
  anio_desde      integer,
  anio_hasta      integer,
  motor           text,
  version         text,
  observacion     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pcv_anios_validos CHECK (
    anio_desde IS NULL OR anio_hasta IS NULL OR anio_desde <= anio_hasta
  )
);

CREATE INDEX IF NOT EXISTS pcv_producto_ix
  ON autorepuestosfelix.producto_compatibilidad_vehiculo (producto_id);

CREATE INDEX IF NOT EXISTS pcv_busqueda_ix
  ON autorepuestosfelix.producto_compatibilidad_vehiculo
    (empresa_id, lower(marca_vehiculo), lower(modelo_vehiculo), anio_desde, anio_hasta);

-- 4) Vehículos del cliente -------------------------------------------
CREATE TABLE IF NOT EXISTS autorepuestosfelix.cliente_vehiculo (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid        NOT NULL REFERENCES autorepuestosfelix.empresas(id) ON DELETE CASCADE,
  cliente_id   uuid        NOT NULL REFERENCES autorepuestosfelix.clientes(id)  ON DELETE CASCADE,
  marca        text        NOT NULL,
  modelo       text        NOT NULL,
  anio         integer,
  motor        text,
  chapa        text,
  observacion  text,
  activo       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cv_cliente_ix
  ON autorepuestosfelix.cliente_vehiculo (cliente_id);

CREATE INDEX IF NOT EXISTS cv_chapa_ix
  ON autorepuestosfelix.cliente_vehiculo (empresa_id, lower(chapa))
  WHERE chapa IS NOT NULL;

-- 5) UNIQUE en categorias_productos (empresa, nombre) + seed ---------
CREATE UNIQUE INDEX IF NOT EXISTS categorias_productos_empresa_nombre_uniq
  ON autorepuestosfelix.categorias_productos (empresa_id, lower(nombre));

DO $$
DECLARE
  v_empresa uuid;
  v_cats text[] := ARRAY[
    'Motor','Filtros','Frenos','Suspensión','Eléctrico','Lubricantes',
    'Baterías','Accesorios','Carrocería','Transmisión','Refrigeración','Herramientas'
  ];
  v_nombre text;
BEGIN
  SELECT id INTO v_empresa
    FROM autorepuestosfelix.empresas
   WHERE nombre_empresa = 'Autorepuestos Felix Bogado'
   LIMIT 1;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Empresa "Autorepuestos Felix Bogado" no encontrada — abortando seed de categorías';
  END IF;
  FOREACH v_nombre IN ARRAY v_cats LOOP
    INSERT INTO autorepuestosfelix.categorias_productos (empresa_id, nombre, activo)
    VALUES (v_empresa, v_nombre, true)
    ON CONFLICT (empresa_id, lower(nombre)) DO NOTHING;
  END LOOP;
END $$;

COMMIT;
