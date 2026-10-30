-- ============================================================================
-- Un producto puede estar en varias categorías del e-commerce: el aviso
-- PRODUCT_SNAPSHOT ahora manda `categories: string[]` (el nombre de cada
-- categoría asignada MÁS sus ancestros, ya expandido allá — el POS no arma
-- ningún árbol). Agrega la tabla producto_categorias (N:M entre productos y
-- categorias_producto) y la llena con la categoría única que cada producto
-- ya tenía en `productos.categoria_id`, como punto de partida.
--
-- `productos.categoria_id` NO se quita: sigue existiendo para el alta manual
-- de producto (una sola categoría, selector de categoria.repository.ts) y
-- como "primera categoría" informativa de los productos sincronizados.
--
-- Es seguro correrla directo: es puramente aditiva. No borra ni modifica
-- columnas existentes, así que no tiene un "paso 2 destructivo" aparte.
--
-- Correr UNA vez (phpMyAdmin → pestaña SQL, o mysql CLI).
-- ============================================================================

CREATE TABLE producto_categorias (
  producto_id  CHAR(36) NOT NULL,
  categoria_id INT NOT NULL,
  PRIMARY KEY (producto_id, categoria_id),
  FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE,
  FOREIGN KEY (categoria_id) REFERENCES categorias_producto(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

INSERT INTO producto_categorias (producto_id, categoria_id)
SELECT id, categoria_id FROM productos WHERE categoria_id IS NOT NULL;
