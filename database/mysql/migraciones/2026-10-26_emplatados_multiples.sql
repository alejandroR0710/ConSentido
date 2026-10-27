-- ============================================================================
-- Recetario: varias presentaciones de emplatado por receta (antes era una
-- sola imagen + una descripción). Cada presentación tiene su propio nombre,
-- su propia imagen y su propia guía. Un producto del menú (Migao) puede
-- quedar amarrado a una presentación específica, para que Cocina tenga un
-- botón directo a "cómo se sirve este producto exacto".
--
-- Correr en DOS pasos, en orden, cada uno UNA vez (phpMyAdmin → pestaña SQL):
--
--   PASO 1 (seguro, no borra nada): crea la tabla nueva, migra la imagen y
--   descripción de emplatado que ya existan como la primera presentación de
--   cada receta ("Presentación principal"), y agrega la columna nueva en
--   productos.
--
--   PASO 2 (destructivo, hazlo solo DESPUÉS de revisar que el PASO 1 migró
--   bien los datos): borra las columnas viejas de recetario_recetas, que ya
--   quedaron reemplazadas por la tabla nueva.
-- ============================================================================

-- --- PASO 1 ---------------------------------------------------------------

CREATE TABLE recetario_emplatados (
  id         CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  receta_id  CHAR(36) NOT NULL,
  nombre     VARCHAR(150) NOT NULL,
  imagen_url VARCHAR(500) NULL,
  guia       TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  FOREIGN KEY (receta_id) REFERENCES recetario_recetas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE INDEX idx_recetario_emplatados_receta ON recetario_emplatados(receta_id);

INSERT INTO recetario_emplatados (id, receta_id, nombre, imagen_url, guia, created_at, updated_at)
SELECT UUID(), id, 'Presentación principal', imagen_emplatado_url, descripcion_emplatado, NOW(6), NOW(6)
  FROM recetario_recetas
 WHERE imagen_emplatado_url IS NOT NULL
    OR (descripcion_emplatado IS NOT NULL AND descripcion_emplatado <> '');

ALTER TABLE productos ADD COLUMN emplatado_id CHAR(36) NULL AFTER es_para_llevar;
ALTER TABLE productos
  ADD CONSTRAINT fk_productos_emplatado FOREIGN KEY (emplatado_id) REFERENCES recetario_emplatados(id) ON DELETE SET NULL;

-- El rol "Administrador" (quien crea/edita productos del menú de Migao)
-- necesita poder ver el recetario para amarrar un producto a una
-- presentación de emplatado — antes no lo necesitaba para nada.
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre = 'Administrador'
  AND p.codigo = 'recetario.ver'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);

-- --- Verificación antes de pasar al PASO 2 --------------------------------
-- SELECT r.titulo, r.imagen_emplatado_url, r.descripcion_emplatado,
--        e.nombre, e.imagen_url, e.guia
--   FROM recetario_recetas r
--   LEFT JOIN recetario_emplatados e ON e.receta_id = r.id;

-- --- PASO 2 (correr aparte, solo cuando el SELECT de arriba se vea bien) -

-- ALTER TABLE recetario_recetas
--   DROP COLUMN imagen_emplatado_url,
--   DROP COLUMN descripcion_emplatado;
