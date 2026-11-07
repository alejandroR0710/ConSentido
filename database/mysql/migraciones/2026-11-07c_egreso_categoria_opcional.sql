-- ============================================================================
-- "Registrar egreso" deja de exigir una categoría de gasto (se quita el
-- selector del formulario) — se relaja el CHECK que obligaba a que todo
-- egreso tuviera categoria_gasto_id. Los reportes que agrupan por categoría
-- (ver caja/moduloOrigen.ts::agruparPorEtiqueta) ya toleran una categoría
-- nula y la muestran como "Otro".
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- No es re-ejecutable (el DROP CHECK fallaría si ya se corrió).
-- ============================================================================

ALTER TABLE movimientos_caja DROP CHECK movimientos_caja_chk_4;
