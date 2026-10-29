-- ============================================================================
-- Área económica por producto: cada categoría de producto puede amarrarse a
-- un módulo (área) y cada ítem vendido/cobrado guarda de qué área salió.
-- Agrega la tabla pedido_areas (reparto de un pedido entre áreas por
-- porcentaje) y el permiso con_sentido.categorias.administrar, otorgado a
-- Root y Super Root.
--
-- Es seguro correrla directo: es puramente aditiva. No borra ni modifica
-- columnas existentes, así que no tiene un "paso 2 destructivo" aparte.
--
-- Correr UNA vez (phpMyAdmin → pestaña SQL, o mysql CLI).
-- ============================================================================

ALTER TABLE categorias_producto
  ADD COLUMN modulo_id SMALLINT NULL,
  ADD CONSTRAINT fk_categorias_producto_modulo FOREIGN KEY (modulo_id) REFERENCES modulos(id);

ALTER TABLE caja_ingreso_items
  ADD COLUMN modulo_origen_id SMALLINT NULL,
  ADD CONSTRAINT fk_caja_ingreso_items_modulo FOREIGN KEY (modulo_origen_id) REFERENCES modulos(id);

ALTER TABLE con_sentido_venta_items
  ADD COLUMN modulo_origen_id SMALLINT NULL,
  ADD CONSTRAINT fk_con_sentido_venta_items_modulo FOREIGN KEY (modulo_origen_id) REFERENCES modulos(id);

ALTER TABLE pedido_items
  ADD COLUMN modulo_origen_id SMALLINT NULL,
  ADD CONSTRAINT fk_pedido_items_modulo FOREIGN KEY (modulo_origen_id) REFERENCES modulos(id);

CREATE TABLE pedido_areas (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  pedido_id  CHAR(36) NOT NULL,
  modulo_id  SMALLINT NOT NULL,
  porcentaje DECIMAL(5,2) NOT NULL CHECK (porcentaje > 0 AND porcentaje <= 100),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (modulo_id) REFERENCES modulos(id),
  UNIQUE INDEX uq_pedido_areas (pedido_id, modulo_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

INSERT INTO permisos (modulo_id, accion, codigo) VALUES
  ((SELECT id FROM modulos WHERE slug = 'con_sentido'), 'administrar_categorias', 'con_sentido.categorias.administrar');

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.codigo = 'con_sentido.categorias.administrar'
WHERE r.nombre IN ('Super Root', 'Root');
