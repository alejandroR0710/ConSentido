-- ============================================================================
-- Módulo Recetario — recetas para el equipo de cocina, con instrucciones
-- largas, categoría, un medio principal (imagen o video, nunca los dos a la
-- vez) y una sección opcional de ejemplo de emplatado.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- ============================================================================

CREATE TABLE recetario_categorias (
  id     INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) UNIQUE NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE recetario_recetas (
  id                    CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  titulo                VARCHAR(150) NOT NULL,
  instrucciones         TEXT NOT NULL,
  categoria_id          INT NULL,
  video_url             VARCHAR(500) NULL,
  imagen_principal_url  VARCHAR(500) NULL,
  imagen_emplatado_url  VARCHAR(500) NULL,
  descripcion_emplatado VARCHAR(500) NULL,
  creado_por_id         CHAR(36) NOT NULL,
  created_at            DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at            DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  FOREIGN KEY (categoria_id) REFERENCES recetario_categorias(id),
  FOREIGN KEY (creado_por_id) REFERENCES usuarios(id),
  CHECK (video_url IS NULL OR imagen_principal_url IS NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE INDEX idx_recetario_recetas_categoria ON recetario_recetas(categoria_id);

-- --- Módulo + permisos ---
INSERT INTO modulos (slug, nombre)
SELECT 'recetario', 'Recetario'
WHERE NOT EXISTS (SELECT 1 FROM modulos WHERE slug = 'recetario');

INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'recetario'), x.accion, x.codigo
FROM (SELECT 'ver' AS accion, 'recetario.ver' AS codigo
      UNION ALL SELECT 'administrar', 'recetario.administrar') AS x
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = x.codigo);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Root', 'Super Root')
  AND p.codigo IN ('recetario.ver', 'recetario.administrar')
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre = 'Cocina'
  AND p.codigo = 'recetario.ver'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);
