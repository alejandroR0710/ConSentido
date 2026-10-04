-- ============================================================================
-- Módulo Pedidos — ampliación de pedidos, rediseño de pedido_items,
-- historial, parámetros de alarma y permisos.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL)
-- ANTES de desplegar el código que lo usa.
-- ============================================================================

-- --- pedidos: cliente opcional + datos de envío + timestamps de cada paso ---
ALTER TABLE pedidos MODIFY cliente_id CHAR(36) NULL;

ALTER TABLE pedidos
  ADD COLUMN destinatario_nombre    VARCHAR(150) NULL AFTER fecha_entrega,
  ADD COLUMN destinatario_documento VARCHAR(30)  NULL AFTER destinatario_nombre,
  ADD COLUMN destinatario_telefono  VARCHAR(30)  NULL AFTER destinatario_documento,
  ADD COLUMN direccion_envio        VARCHAR(250) NULL AFTER destinatario_telefono,
  ADD COLUMN ciudad_envio           VARCHAR(100) NULL AFTER direccion_envio,
  ADD COLUMN transportadora         VARCHAR(100) NULL AFTER ciudad_envio,
  ADD COLUMN numero_guia            VARCHAR(100) NULL AFTER transportadora,
  ADD COLUMN notas_entrega          TEXT NULL AFTER numero_guia,
  ADD COLUMN creado_por_id          CHAR(36) NULL AFTER responsable_id,
  ADD COLUMN alistado_en            DATETIME(6) NULL AFTER creado_por_id,
  ADD COLUMN enviado_en             DATETIME(6) NULL AFTER alistado_en,
  ADD COLUMN entregado_en           DATETIME(6) NULL AFTER enviado_en,
  ADD COLUMN proxima_alarma_en      DATETIME(6) NULL AFTER entregado_en,
  ADD CONSTRAINT fk_pedidos_creado_por FOREIGN KEY (creado_por_id) REFERENCES usuarios(id);

-- El enum de estado nunca tuvo datos reales (el módulo no existía) — se
-- redefine limpio. El nombre del CHECK inline lo pone MySQL solo: se busca
-- por catálogo en vez de adivinarlo.
SET @chk := (SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos'
               AND CONSTRAINT_TYPE = 'CHECK' LIMIT 1);
SET @sql := CONCAT('ALTER TABLE pedidos DROP CHECK ', @chk);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE pedidos MODIFY estado VARCHAR(20) NOT NULL DEFAULT 'pendiente'
  CHECK (estado IN ('pendiente','alistado','enviado','entregado','cancelado'));

CREATE INDEX idx_pedidos_proxima_alarma ON pedidos(proxima_alarma_en);

-- facturas.pedido_id no tenía índice único (a diferencia de venta_id y
-- con_sentido_venta_id) — hace falta para el get-or-create idempotente de
-- la factura del pedido (Task 13): sin esto, un doble clic en "Factura"
-- podría crear dos facturas para el mismo pedido.
CREATE UNIQUE INDEX idx_facturas_pedido_unica ON facturas(pedido_id);

-- --- pedido_items: rediseño (admite texto libre + precio por línea) ---
DROP TABLE pedido_items; -- nunca tuvo filas reales (el módulo no existía)

CREATE TABLE pedido_items (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  pedido_id       CHAR(36) NOT NULL,
  producto_id     CHAR(36) NULL,
  sku             VARCHAR(50) NULL,
  nombre          VARCHAR(150) NOT NULL,
  cantidad        DECIMAL(12,3) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES productos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE INDEX idx_pedido_items_pedido ON pedido_items(pedido_id);

-- --- pedido_historial: ya existía (forma estado_anterior/estado_nuevo, sin
-- filas reales — el módulo nunca se conectó a nada) — se rediseña con el
-- mismo patrón accion+detalle JSON que orden_historial de Migao, para poder
-- registrar también "creado"/"edicion"/"abono", no solo cambios de estado.
DROP TABLE pedido_historial;

CREATE TABLE pedido_historial (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  pedido_id   CHAR(36) NOT NULL,
  accion      VARCHAR(30) NOT NULL,
  detalle     JSON NULL,
  usuario_id  CHAR(36) NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE INDEX idx_pedido_historial_pedido ON pedido_historial(pedido_id);

-- --- pedido_abonos: el metodo_pago existente no coincide con Caja General
-- (efectivo/banco) — se acota para poder generar un ingreso real.
SET @chk2 := (SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedido_abonos'
                AND CONSTRAINT_TYPE = 'CHECK' LIMIT 1);
SET @sql2 := CONCAT('ALTER TABLE pedido_abonos DROP CHECK ', @chk2);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

ALTER TABLE pedido_abonos MODIFY metodo_pago VARCHAR(20) NOT NULL
  CHECK (metodo_pago IN ('efectivo','banco'));

-- --- pedidos_parametros: fila única, mismo patrón que velas_parametros ---
CREATE TABLE pedidos_parametros (
  id                        BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  intervalo_alarma_minutos  INT NOT NULL DEFAULT 30,
  updated_at                DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
INSERT INTO pedidos_parametros (id) VALUES (true);

-- --- Permisos ---
INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'pedidos'), x.accion, x.codigo
FROM (SELECT 'ver' AS accion, 'pedidos.ver' AS codigo
      UNION ALL SELECT 'crear', 'pedidos.crear'
      UNION ALL SELECT 'cambiar_estado', 'pedidos.cambiar_estado'
      UNION ALL SELECT 'administrar_parametros', 'pedidos.administrar_parametros') AS x
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = x.codigo);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Cajero', 'Administrador', 'Root', 'Super Root')
  AND p.codigo IN ('pedidos.ver', 'pedidos.crear', 'pedidos.cambiar_estado')
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Root', 'Super Root')
  AND p.codigo = 'pedidos.administrar_parametros'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);

-- Cajero/Administrador necesitan ver clientes para elegir uno al crear un
-- pedido (hoy ese permiso es exclusivo de Super Root/Root).
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Cajero', 'Administrador')
  AND p.codigo = 'con_sentido.clientes.ver'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);
