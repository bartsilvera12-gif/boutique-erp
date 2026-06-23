-- =====================================================================
-- clone_schema(source_schema, dest_schema, include_recs)
--   Clona la estructura de un schema en otro nuevo.
--   include_recs = false → tablas vacías (lo que queremos acá).
--
-- Copia: tablas (con columnas, defaults, NOT NULL, CHECK, PK, UNIQUE),
--        secuencias (con valor reseteado), índices, FKs, vistas,
--        funciones, triggers y políticas RLS.
--
-- Adaptado del clásico clone_schema de la comunidad PostgreSQL
-- (Emanuel '09 / Denish Patel / variantes posteriores).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.clone_schema(
  source_schema text,
  dest_schema   text,
  include_recs  boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
AS $BODY$
DECLARE
  src_oid     oid;
  obj         text;
  buf         text;
  qry         text;
  dest_qry    text;
  v_def       text;
  seq         text;
  seq_data    record;
  trig_rec    record;
  view_rec    record;
  func_rec    record;
  pol_rec     record;
  col         text;
  cols        text;
  vals        text;
BEGIN
  SELECT oid INTO src_oid FROM pg_namespace WHERE nspname = quote_ident(source_schema)::name
                                       OR nspname = source_schema;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schema origen "%" no existe', source_schema;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = dest_schema) THEN
    RAISE EXCEPTION 'Schema destino "%" ya existe — borralo manualmente o pasá otro nombre', dest_schema;
  END IF;

  EXECUTE format('CREATE SCHEMA %I', dest_schema);

  -- 1) Secuencias (estructura; sin reusar last_value salvo include_recs)
  FOR obj IN
    SELECT sequence_name::text
      FROM information_schema.sequences
     WHERE sequence_schema = source_schema
  LOOP
    EXECUTE format('CREATE SEQUENCE %I.%I', dest_schema, obj);

    SELECT 'INCREMENT BY ' || increment
        || ' MINVALUE ' || minimum_value
        || ' MAXVALUE ' || maximum_value
        || ' START WITH ' || start_value
        || CASE WHEN cycle_option = 'YES' THEN ' CYCLE' ELSE ' NO CYCLE' END
      INTO v_def
      FROM information_schema.sequences
     WHERE sequence_schema = source_schema AND sequence_name = obj;

    EXECUTE format('ALTER SEQUENCE %I.%I %s', dest_schema, obj, v_def);
  END LOOP;

  -- 2) Tablas (estructura) — INCLUDING ALL trae defaults, constraints, indexes, storage
  FOR obj IN
    SELECT table_name::text
      FROM information_schema.tables
     WHERE table_schema = source_schema
       AND table_type   = 'BASE TABLE'
  LOOP
    buf := format('CREATE TABLE %I.%I (LIKE %I.%I INCLUDING ALL)',
                  dest_schema, obj, source_schema, obj);
    EXECUTE buf;

    -- repuntar defaults nextval(...) hacia las secuencias del schema destino
    FOR col, v_def IN
      SELECT column_name, column_default
        FROM information_schema.columns
       WHERE table_schema = source_schema
         AND table_name   = obj
         AND column_default LIKE 'nextval(%' || source_schema || '.%'
    LOOP
      EXECUTE format(
        'ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT %s',
        dest_schema, obj, col,
        replace(v_def, source_schema || '.', dest_schema || '.')
      );
    END LOOP;

    IF include_recs THEN
      EXECUTE format('INSERT INTO %I.%I SELECT * FROM %I.%I',
                     dest_schema, obj, source_schema, obj);
    END IF;
  END LOOP;

  -- 3) FKs (después de tener todas las tablas).
  -- Recreamos cada FK en el schema destino usando pg_get_constraintdef, y
  -- reescribimos cualquier referencia "<origen>." → "<destino>." para que
  -- las FKs internas apunten al schema nuevo. FKs hacia otros schemas
  -- (p. ej. auth) quedan tal cual.
  FOR trig_rec IN
    SELECT t.relname AS tbl,
           c.conname AS conname,
           pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class      t ON t.oid = c.conrelid
      JOIN pg_namespace  n ON n.oid = t.relnamespace
     WHERE n.nspname = source_schema
       AND c.contype = 'f'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I %s',
      dest_schema,
      trig_rec.tbl,
      trig_rec.conname,
      replace(trig_rec.def, source_schema || '.', dest_schema || '.')
    );
  END LOOP;

  -- 4) Funciones (antes que vistas/triggers porque suelen depender de ellas).
  -- Apagamos check_function_bodies para que las funciones que se llaman
  -- entre sí puedan crearse en cualquier orden.
  EXECUTE 'SET LOCAL check_function_bodies = off';
  FOR func_rec IN
    SELECT p.oid,
           p.proname,
           pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = source_schema
       AND p.prokind IN ('f','p')
  LOOP
    EXECUTE replace(
      func_rec.def,
      source_schema || '.',
      dest_schema || '.'
    );
  END LOOP;
  EXECUTE 'SET LOCAL check_function_bodies = on';

  -- 5) Vistas
  FOR view_rec IN
    SELECT table_name, view_definition
      FROM information_schema.views
     WHERE table_schema = source_schema
  LOOP
    EXECUTE format(
      'CREATE OR REPLACE VIEW %I.%I AS %s',
      dest_schema, view_rec.table_name,
      replace(view_rec.view_definition, source_schema || '.', dest_schema || '.')
    );
  END LOOP;

  -- 6) Triggers (los que no son del sistema)
  FOR trig_rec IN
    SELECT tgname,
           pg_get_triggerdef(t.oid) AS def,
           c.relname AS tbl
      FROM pg_trigger t
      JOIN pg_class    c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = source_schema
       AND NOT t.tgisinternal
  LOOP
    EXECUTE replace(trig_rec.def, source_schema || '.', dest_schema || '.');
  END LOOP;

  -- 7) RLS (ENABLE + policies)
  FOR obj IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = source_schema
       AND c.relkind = 'r'
       AND c.relrowsecurity = true
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', dest_schema, obj);
  END LOOP;

  FOR pol_rec IN
    SELECT pol.polname,
           c.relname AS tbl,
           pol.polcmd,
           pol.polpermissive,
           pol.polroles,
           pg_get_expr(pol.polqual,  pol.polrelid) AS using_expr,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
      FROM pg_policy pol
      JOIN pg_class   c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = source_schema
  LOOP
    qry := format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s',
      pol_rec.polname,
      dest_schema, pol_rec.tbl,
      CASE WHEN pol_rec.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
      CASE pol_rec.polcmd
        WHEN 'r' THEN 'SELECT'
        WHEN 'a' THEN 'INSERT'
        WHEN 'w' THEN 'UPDATE'
        WHEN 'd' THEN 'DELETE'
        ELSE 'ALL'
      END
    );
    -- roles
    IF pol_rec.polroles <> '{0}'::oid[] THEN
      SELECT string_agg(quote_ident(rolname), ', ')
        INTO buf
        FROM pg_roles
       WHERE oid = ANY (pol_rec.polroles);
      qry := qry || ' TO ' || buf;
    END IF;
    IF pol_rec.using_expr IS NOT NULL THEN
      qry := qry || ' USING (' || replace(pol_rec.using_expr, source_schema || '.', dest_schema || '.') || ')';
    END IF;
    IF pol_rec.check_expr IS NOT NULL THEN
      qry := qry || ' WITH CHECK (' || replace(pol_rec.check_expr, source_schema || '.', dest_schema || '.') || ')';
    END IF;

    EXECUTE qry;
  END LOOP;

  RAISE NOTICE 'Schema "%": clonado desde "%" (data=%).', dest_schema, source_schema, include_recs;
END;
$BODY$;
