-- ============================================================================
-- Índice de apoyo para tareas_instancia: listarInstanciasDeUsuario filtra por
-- (usuario_id, fecha), pero el UNIQUE(plantilla_id, usuario_id, fecha) que ya
-- existe arranca por plantilla_id, así que esa consulta no puede usarlo como
-- prefijo y haría table scan sin este índice adicional.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- ============================================================================

ALTER TABLE tareas_instancia ADD INDEX idx_tareas_instancia_usuario_fecha (usuario_id, fecha);
