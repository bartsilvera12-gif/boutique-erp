-- Limpieza transaccional: ventas, compras, pedidos, cajas, proveedores.
-- Mantiene productos y stock_actual intactos.
BEGIN;

DO $$
DECLARE
  sch text := 'autorepuestosfelix';
  v_ventas int; v_vitems int; v_vpd int; v_cxc int;
  v_compras int; v_cpagos int;
  v_pedidos int; v_cajas int; v_cajamov int;
  v_movinv int; v_prov int; v_provprod int;
BEGIN
  -- 1) Hijos de ventas
  EXECUTE format('DELETE FROM %I.ventas_pagos_detalle', sch); GET DIAGNOSTICS v_vpd = ROW_COUNT;
  EXECUTE format('DELETE FROM %I.ventas_items', sch); GET DIAGNOSTICS v_vitems = ROW_COUNT;
  EXECUTE format('DELETE FROM %I.cuentas_por_cobrar', sch); GET DIAGNOSTICS v_cxc = ROW_COUNT;

  -- 2) Hijos de compras
  EXECUTE format('DELETE FROM %I.compras_pagos', sch); GET DIAGNOSTICS v_cpagos = ROW_COUNT;

  -- 3) Pedidos de caja (módulo buscador)
  EXECUTE format('DELETE FROM %I.pedidos_caja', sch); GET DIAGNOSTICS v_pedidos = ROW_COUNT;

  -- 4) Movimientos de inventario asociados a venta/compra (auditoría)
  EXECUTE format($q$DELETE FROM %I.movimientos_inventario WHERE origen IN ('venta','compra')$q$, sch);
  GET DIAGNOSTICS v_movinv = ROW_COUNT;

  -- 5) Ventas
  EXECUTE format('DELETE FROM %I.ventas', sch); GET DIAGNOSTICS v_ventas = ROW_COUNT;

  -- 6) Compras
  EXECUTE format('DELETE FROM %I.compras', sch); GET DIAGNOSTICS v_compras = ROW_COUNT;

  -- 7) Caja (movimientos cae solo por CASCADE)
  EXECUTE format('DELETE FROM %I.caja_movimientos', sch); GET DIAGNOSTICS v_cajamov = ROW_COUNT;
  EXECUTE format('DELETE FROM %I.cajas', sch); GET DIAGNOSTICS v_cajas = ROW_COUNT;

  -- 8) Liberar FK proveedor antes de borrar proveedores
  EXECUTE format($q$UPDATE %I.productos SET proveedor_principal_id = NULL WHERE proveedor_principal_id IS NOT NULL$q$, sch);

  -- 9) Junction y proveedores
  EXECUTE format('DELETE FROM %I.proveedor_productos', sch); GET DIAGNOSTICS v_provprod = ROW_COUNT;
  EXECUTE format('DELETE FROM %I.proveedores', sch); GET DIAGNOSTICS v_prov = ROW_COUNT;

  RAISE NOTICE '── Limpieza completada ──';
  RAISE NOTICE 'ventas: % | ventas_items: % | ventas_pagos_detalle: % | cuentas_por_cobrar: %',
    v_ventas, v_vitems, v_vpd, v_cxc;
  RAISE NOTICE 'compras: % | compras_pagos: %', v_compras, v_cpagos;
  RAISE NOTICE 'pedidos_caja: % | cajas: % | caja_movimientos: %', v_pedidos, v_cajas, v_cajamov;
  RAISE NOTICE 'movimientos_inventario (venta/compra): %', v_movinv;
  RAISE NOTICE 'proveedores: % | proveedor_productos: %', v_prov, v_provprod;
END $$;

COMMIT;
