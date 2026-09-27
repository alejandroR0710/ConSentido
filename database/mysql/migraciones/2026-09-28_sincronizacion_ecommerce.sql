-- ============================================================================
-- Sincronización de inventario con el e-commerce (consentidovelas.com)
--
-- Solo módulo Con Sentido. Migao (menú, mesas, cocina) no se toca.
--
-- - productos: SKU y vínculo con el producto/variante del e-commerce. El
--   catálogo de Con Sentido pasa a llenarse solo desde el e-commerce.
-- - con_sentido_venta_items: qué producto se vendió (las ventas nuevas quedan
--   ligadas; el historial anterior sigue igual, como texto).
-- - ecommerce_sync_salida / ecommerce_sync_recibidos: avisos de stock por
--   enviar al e-commerce y avisos ya recibidos de él (para no aplicar uno dos
--   veces).
-- - Quita los productos de Con Sentido creados a mano antes de la
--   sincronización (decisión del negocio, 2026-09-28): se borran los que nada
--   referencia y se desactivan los demás, para no romper historial.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL)
-- ANTES de desplegar el código que la usa.
-- ============================================================================

ALTER TABLE productos
  ADD COLUMN sku                  VARCHAR(191) NULL AFTER nombre,
  ADD COLUMN ecommerce_item_key   VARCHAR(191) NULL AFTER sku,
  ADD COLUMN ecommerce_product_id VARCHAR(191) NULL AFTER ecommerce_item_key,
  ADD COLUMN ecommerce_variant_id VARCHAR(191) NULL AFTER ecommerce_product_id,
  ADD COLUMN ecommerce_publicado  BOOLEAN NULL AFTER ecommerce_variant_id,
  ADD UNIQUE INDEX uq_productos_ecommerce_item (ecommerce_item_key),
  ADD INDEX idx_productos_ecommerce_producto (ecommerce_product_id),
  ADD INDEX idx_productos_sku (sku);

ALTER TABLE con_sentido_venta_items
  ADD COLUMN producto_id CHAR(36) NULL AFTER venta_id,
  ADD COLUMN sku         VARCHAR(191) NULL AFTER producto_id,
  ADD CONSTRAINT fk_con_sentido_venta_items_producto
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL;

CREATE TABLE ecommerce_sync_salida (
  seq             BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_id        CHAR(36) NOT NULL,
  tipo            VARCHAR(30) NOT NULL,
  payload         JSON NOT NULL,
  estado          VARCHAR(12) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'fallido')),
  intentos        INT NOT NULL DEFAULT 0,
  proximo_intento DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  ultimo_error    TEXT,
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  enviado_at      DATETIME(6) NULL,
  UNIQUE KEY uq_ecommerce_sync_salida_evento (event_id),
  INDEX idx_ecommerce_sync_salida_estado (estado, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE ecommerce_sync_recibidos (
  event_id   VARCHAR(191) PRIMARY KEY,
  tipo       VARCHAR(30) NOT NULL,
  resultado  VARCHAR(20) NOT NULL,
  detalle    TEXT,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

-- Productos de Con Sentido creados a mano (sin vínculo con el e-commerce).
DELETE p FROM productos p
  JOIN modulos m ON m.id = p.modulo_id
 WHERE m.slug = 'con_sentido'
   AND p.ecommerce_item_key IS NULL
   AND NOT EXISTS (SELECT 1 FROM venta_items vi WHERE vi.producto_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM orden_items oi WHERE oi.producto_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM pedido_items pdi WHERE pdi.producto_id = p.id);

UPDATE productos p
  JOIN modulos m ON m.id = p.modulo_id
   SET p.activo = false
 WHERE m.slug = 'con_sentido'
   AND p.ecommerce_item_key IS NULL;
