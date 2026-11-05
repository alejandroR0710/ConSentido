-- Ventas del e-commerce en el historial y la Caja del POS (spec
-- 2026-11-05-ventas-ecommerce-al-pos-design.md en el repo del e-commerce).
-- Las ventas pagadas en la tienda llegan como aviso SALE_RECORDED y esperan
-- aquí hasta que haya un turno abierto; NO mueven inventario (ya lo movió el
-- e-commerce y llegó con STOCK_DELTA).
CREATE TABLE ecommerce_ventas_pendientes (
  id                  CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  origen              VARCHAR(10) NOT NULL CHECK (origen IN ('ORDER', 'BOOKING')),
  origen_id           VARCHAR(64) NOT NULL,
  numero              VARCHAR(40) NOT NULL,
  -- NULL cuando llegó primero la anulación (fila 'descartada' sin venta).
  payload             JSON NULL,
  estado              VARCHAR(12) NOT NULL DEFAULT 'pendiente'
                      CHECK (estado IN ('pendiente', 'aplicada', 'descartada', 'anulada')),
  turno_id            CHAR(36) NULL,
  venta_id            CHAR(36) NULL,
  -- 1 = llegó la anulación de una venta cuyo turno ya cerró y no había turno
  -- abierto: el egreso se registra al abrir el próximo.
  reversion_pendiente TINYINT(1) NOT NULL DEFAULT 0,
  detalle             VARCHAR(300) NULL,
  recibido_en         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  aplicado_en         DATETIME(6) NULL,
  UNIQUE KEY uq_ecommerce_venta_origen (origen, origen_id),
  INDEX idx_ecommerce_ventas_estado (estado, recibido_en),
  FOREIGN KEY (turno_id) REFERENCES turnos_caja(id),
  FOREIGN KEY (venta_id) REFERENCES con_sentido_ventas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

-- NULL = venta hecha en el POS; 'ecommerce' = venta de la tienda en línea.
ALTER TABLE con_sentido_ventas
  ADD COLUMN origen VARCHAR(20) NULL,
  ADD COLUMN ecommerce_numero VARCHAR(40) NULL;

INSERT INTO categorias_gasto (nombre)
  SELECT 'Devoluciones e-commerce' FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM categorias_gasto WHERE nombre = 'Devoluciones e-commerce');
