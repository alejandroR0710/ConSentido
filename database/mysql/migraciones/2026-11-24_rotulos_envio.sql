-- ============================================================================
-- Rótulos de envío creados sueltos (sin un pedido asociado) — botón "🏷️
-- Rótulos" en el módulo de Pedidos. Mismos campos de envío que ya tiene la
-- tabla `pedidos`, para reusar el mismo componente de impresión
-- (RotuloEnvio.tsx).
--
-- `fuente`/`referencia_externa` quedan listos para conectar esto con los
-- pedidos del e-commerce más adelante (hoy el webhook de ventas del
-- e-commerce no trae dirección de envío, así que por ahora todo rótulo
-- nace 'manual') — ver pedidos.service.ts::crearRotulo.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- ============================================================================

CREATE TABLE rotulos_envio (
  id CHAR(36) NOT NULL DEFAULT (uuid()),
  destinatario_nombre VARCHAR(150) NOT NULL,
  destinatario_documento VARCHAR(30) DEFAULT NULL,
  destinatario_telefono VARCHAR(30) DEFAULT NULL,
  direccion_envio VARCHAR(250) DEFAULT NULL,
  ciudad_envio VARCHAR(100) DEFAULT NULL,
  descripcion VARCHAR(500) NOT NULL,
  metodo_envio VARCHAR(20) DEFAULT NULL,
  transportadora VARCHAR(100) DEFAULT NULL,
  numero_guia VARCHAR(100) DEFAULT NULL,
  fuente VARCHAR(20) NOT NULL DEFAULT 'manual',
  referencia_externa VARCHAR(100) DEFAULT NULL,
  creado_por_id CHAR(36) DEFAULT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_rotulos_envio_creado_por (creado_por_id),
  CONSTRAINT rotulos_envio_ibfk_1 FOREIGN KEY (creado_por_id) REFERENCES usuarios (id),
  CONSTRAINT rotulos_envio_chk_1 CHECK (metodo_envio IN ('transportadora', 'recoge_tienda', 'plataforma') OR metodo_envio IS NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
