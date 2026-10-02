-- ============================================================================
-- Stock negativo con observación + anular una venta devuelve el stock
--
-- - Vender un producto sin stock suficiente lo deja en negativo (antes se
--   quedaba en 0), y quien vende debe explicar el descuadre en
--   `observacion_inventario` (apareció en bodega, se hizo para esa venta, mala
--   contada...). El e-commerce nunca baja de 0.
-- - Anular una venta devuelve al inventario la cantidad vendida de cada línea
--   ligada a un producto. Para eso "Registrar ingreso" de Caja ahora guarda
--   qué producto del catálogo se eligió (`producto_id`; antes solo el nombre).
--   Los ingresos anteriores no tienen producto: al anularlos no se devuelve
--   stock, como hasta ahora.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL)
-- ANTES de desplegar el código que la usa.
-- ============================================================================

ALTER TABLE con_sentido_venta_items
  ADD COLUMN observacion_inventario TEXT NULL AFTER precio_unitario;

ALTER TABLE caja_ingreso_items
  ADD COLUMN producto_id            CHAR(36) NULL AFTER venta_id,
  ADD COLUMN observacion_inventario TEXT NULL AFTER precio_unitario,
  ADD CONSTRAINT fk_caja_ingreso_items_producto
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL;
