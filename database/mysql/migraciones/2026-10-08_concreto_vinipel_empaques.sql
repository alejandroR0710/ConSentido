-- ============================================================================
-- Calculadora de Concreto — costo de vinipel (default $500, editable igual
-- que los demás costos) + soporte para empaques manuales por pieza (estos
-- últimos no se guardan, van directo en cada cálculo — ver concreto.service.ts).
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- ============================================================================

ALTER TABLE concreto_parametros
  ADD COLUMN costo_vinipel DECIMAL(12,2) NOT NULL DEFAULT 500 AFTER costo_lija;
