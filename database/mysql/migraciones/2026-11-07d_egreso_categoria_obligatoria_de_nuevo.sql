-- ============================================================================
-- Revierte 2026-11-07c: "Registrar egreso" vuelve a exigir categoría de
-- gasto (se repone el selector en el formulario) — se vuelve a exigir
-- categoria_gasto_id para todo egreso.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- Solo aplica si ya se corrió 2026-11-07c (si no, este CHECK ya existía).
-- ============================================================================

ALTER TABLE movimientos_caja
  ADD CONSTRAINT movimientos_caja_chk_4 CHECK (tipo = 'ingreso' OR categoria_gasto_id IS NOT NULL);
