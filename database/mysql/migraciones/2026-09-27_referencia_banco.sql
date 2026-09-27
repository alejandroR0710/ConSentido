-- ============================================================================
-- Referencia de la transferencia en pagos por banco
--
-- Guarda los últimos 4 caracteres (letras y/o números) del ID de la
-- transferencia en cada ingreso por banco, para poder cruzarlo con el
-- extracto. Solo se llena en líneas con metodo_pago = 'banco'; los
-- movimientos anteriores quedan en NULL.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL)
-- ANTES de desplegar el código que la usa: sin la columna, todo cobro falla.
-- ============================================================================

ALTER TABLE movimientos_caja
  ADD COLUMN referencia_banco VARCHAR(4) NULL AFTER es_pago_mixto;
