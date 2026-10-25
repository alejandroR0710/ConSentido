-- ============================================================================
-- Pago administrativo también en el cobro en curso (cuentas con abonos y/o
-- productos de la tienda vinculados a la mesa).
--
-- Lo que falta de un carrito de tienda vinculado a una mesa se calcula con lo
-- que entró a Caja (movimientos_caja). Un cierre administrativo NO entra a
-- Caja, así que esta marca le dice al sistema que ese carrito quedó saldado
-- de forma administrativa (sin método de pago real).
-- ============================================================================

ALTER TABLE con_sentido_ventas
  ADD COLUMN pago_administrativo TINYINT(1) NOT NULL DEFAULT 0;
