-- ============================================================================
-- Permite anclar proveedores a una categoría de gasto (muchos a muchos):
-- al editar una categoría en Administración, se eligen los proveedores que
-- le pertenecen; en "Registrar egreso", al elegir esa categoría, el
-- selector de Proveedor se filtra a solo esos (más los que todavía no
-- tienen ninguna categoría anclada, que siguen apareciendo siempre).
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- ============================================================================

CREATE TABLE categorias_gasto_proveedores (
  categoria_gasto_id INT NOT NULL,
  proveedor_id CHAR(36) NOT NULL,
  PRIMARY KEY (categoria_gasto_id, proveedor_id),
  CONSTRAINT categorias_gasto_proveedores_categoria_fk
    FOREIGN KEY (categoria_gasto_id) REFERENCES categorias_gasto(id) ON DELETE CASCADE,
  CONSTRAINT categorias_gasto_proveedores_proveedor_fk
    FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
