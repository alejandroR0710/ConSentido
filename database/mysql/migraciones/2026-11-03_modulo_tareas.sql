-- ============================================================================
-- Módulo Tareas / Rutina diaria — plantillas (la regla: qué tarea, para quién,
-- cuándo aplica) e instancias (la ocurrencia concreta por usuario y fecha,
-- con su estado). Permisos: tareas.ver_propias (6 roles) y tareas.gestionar
-- (Root y Super Root).
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- Los INSERT son re-ejecutables; el CREATE TABLE no (ya existiría la tabla).
-- ============================================================================

CREATE TABLE tareas_plantilla (
  id                CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  titulo            VARCHAR(150) NOT NULL,
  descripcion       TEXT NULL,
  -- Exactamente uno de los dos: la plantilla es de UN rol (todos los usuarios
  -- con ese rol la reciben, cada uno con su propia instancia) o de UN usuario
  -- puntual (asignación directa).
  rol_id            INT NULL,
  usuario_id        CHAR(36) NULL,
  tipo_recurrencia  VARCHAR(10) NOT NULL CHECK (tipo_recurrencia IN ('semanal','unica')),
  -- 'semanal': CSV de días 1=lunes..7=domingo, ej. '1,2,3,4,5'. 'unica': NULL.
  dias_semana       VARCHAR(20) NULL,
  -- 'unica': la fecha puntual. 'semanal': NULL.
  fecha_unica       DATE NULL,
  orden             INT NOT NULL DEFAULT 0,
  activo            BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por_id     CHAR(36) NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (rol_id) REFERENCES roles(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (creado_por_id) REFERENCES usuarios(id),
  CHECK ((rol_id IS NOT NULL) <> (usuario_id IS NOT NULL)),
  CHECK (
    (tipo_recurrencia = 'semanal' AND dias_semana IS NOT NULL AND fecha_unica IS NULL)
    OR (tipo_recurrencia = 'unica' AND fecha_unica IS NOT NULL AND dias_semana IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE tareas_instancia (
  id                CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  plantilla_id      CHAR(36) NOT NULL,
  usuario_id        CHAR(36) NOT NULL,
  fecha             DATE NOT NULL,
  estado            VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                     CHECK (estado IN ('pendiente','en_progreso','completada','omitida')),
  actualizado_por_id CHAR(36) NULL,
  actualizado_en    DATETIME(6) NULL,
  FOREIGN KEY (plantilla_id) REFERENCES tareas_plantilla(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (actualizado_por_id) REFERENCES usuarios(id),
  UNIQUE (plantilla_id, usuario_id, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

-- --- Módulo ---
INSERT INTO modulos (slug, nombre)
SELECT 'tareas', 'Tareas'
WHERE NOT EXISTS (SELECT 1 FROM modulos WHERE slug = 'tareas');

-- --- Permisos ---
INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'tareas'), x.accion, x.codigo
FROM (SELECT 'ver_propias' AS accion, 'tareas.ver_propias' AS codigo
      UNION ALL SELECT 'gestionar', 'tareas.gestionar') AS x
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = x.codigo);

-- tareas.ver_propias: los 6 roles existentes (todos tienen rutina diaria).
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Super Root', 'Root', 'Cajero', 'Cocina', 'Mesero', 'Administrador')
  AND p.codigo = 'tareas.ver_propias'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);

-- tareas.gestionar: solo Root y Super Root.
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Root', 'Super Root')
  AND p.codigo = 'tareas.gestionar'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);
