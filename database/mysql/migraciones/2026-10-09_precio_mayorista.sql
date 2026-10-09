-- ============================================================================
-- Precio mayorista (llega del e-commerce en el snapshot del producto)
--
-- precio_mayorista: neto ("de físico"); mayorista_desde: unidades mínimas
-- (sumando las variantes del mismo producto del e-commerce); nota_mayorista:
-- texto corto. Todas NULL = sin mayorista.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL)
-- ANTES de desplegar el código que la usa.
-- ============================================================================

ALTER TABLE productos
  ADD COLUMN precio_mayorista DECIMAL(12,2) NULL AFTER precio,
  ADD COLUMN mayorista_desde  INT NULL AFTER precio_mayorista,
  ADD COLUMN nota_mayorista   VARCHAR(120) NULL AFTER mayorista_desde;
