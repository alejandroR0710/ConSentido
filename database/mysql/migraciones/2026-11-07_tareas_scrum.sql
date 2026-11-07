-- ============================================================================
-- Módulo Tareas / Tablero compartido por área (tipo Scrum) — tarea suelta
-- (un solo estado compartido) y su relación de participantes (quién se unió).
-- Sin permisos nuevos: reutiliza tareas.ver_propias y tareas.gestionar.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- El CREATE TABLE no es re-ejecutable (ya existiría la tabla).
-- ============================================================================

CREATE TABLE tareas_scrum (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  titulo        VARCHAR(150) NOT NULL,
  area          VARCHAR(80) NOT NULL,
  descripcion   TEXT NULL,
  fecha         DATE NOT NULL,
  estado        VARCHAR(10) NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada')),
  creado_por_id CHAR(36) NOT NULL,
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  cerrado_por_id CHAR(36) NULL,
  cerrado_en    DATETIME(6) NULL,
  FOREIGN KEY (creado_por_id) REFERENCES usuarios(id),
  FOREIGN KEY (cerrado_por_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE INDEX idx_tareas_scrum_fecha ON tareas_scrum(fecha);

CREATE TABLE tareas_scrum_participantes (
  tarea_id   CHAR(36) NOT NULL,
  usuario_id CHAR(36) NOT NULL,
  unido_en   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (tarea_id, usuario_id),
  FOREIGN KEY (tarea_id) REFERENCES tareas_scrum(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
