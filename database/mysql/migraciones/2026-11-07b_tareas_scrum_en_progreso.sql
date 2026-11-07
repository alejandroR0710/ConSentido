-- ============================================================================
-- Tablero compartido (scrum): agrega el estado intermedio 'en_progreso' —
-- antes solo abierta/cerrada. `estado` pasa de VARCHAR(10) a VARCHAR(20)
-- (igual que `tareas_instancia.estado` del resto del módulo) porque
-- 'en_progreso' no entra en 10 caracteres.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- No es re-ejecutable (el ALTER DROP CHECK fallaría si ya se corrió).
-- ============================================================================

ALTER TABLE tareas_scrum
  MODIFY estado VARCHAR(20) NOT NULL DEFAULT 'abierta';

ALTER TABLE tareas_scrum DROP CHECK tareas_scrum_chk_1;
ALTER TABLE tareas_scrum ADD CHECK (estado IN ('abierta', 'en_progreso', 'cerrada'));
