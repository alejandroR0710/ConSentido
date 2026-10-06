-- ============================================================================
-- Módulo Vales — comprobantes de dinero ya entregado (anticipo a un
-- empleado, pago puntual, etc.), con tres fuentes de fondos posibles
-- (turno abierto, acumulado total, o bolsillo de un dueño a reponer) y
-- reversión completa (anular).
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- ============================================================================

CREATE TABLE vales (
  id                        CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  numero                    VARCHAR(20) NOT NULL UNIQUE,
  pagado_a                  VARCHAR(150) NOT NULL,
  -- Enganche opcional a futuro (módulo de nóminas) — "pagado_a" sigue siendo
  -- el dato real, esto nunca lo reemplaza.
  destinatario_usuario_id   CHAR(36) NULL,
  destinatario_documento    VARCHAR(30) NULL,
  concepto                  TEXT NOT NULL,
  monto_efectivo            DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_banco               DECIMAL(12,2) NOT NULL DEFAULT 0,
  fuente                    VARCHAR(20) NOT NULL
                             CHECK (fuente IN ('turno', 'acumulado', 'dueno')),
  dueno_id                  CHAR(36) NULL,
  repuesto_en               DATETIME(6) NULL,
  fuente_reposicion         VARCHAR(20) NULL,
  anulado_en                DATETIME(6) NULL,
  creado_por_id             CHAR(36) NOT NULL,
  created_at                DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (destinatario_usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (dueno_id) REFERENCES usuarios(id),
  FOREIGN KEY (creado_por_id) REFERENCES usuarios(id),
  CHECK (monto_efectivo + monto_banco > 0),
  CHECK (fuente != 'dueno' OR dueno_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE INDEX idx_vales_fuente ON vales(fuente);
CREATE INDEX idx_vales_dueno ON vales(dueno_id);

-- MySQL no tiene CREATE SEQUENCE — este repo lo reemplaza con la tabla
-- `secuencias` (nombre, valor), que el backend resuelve en cada
-- nextval('x') (ver backend/src/shared/db/pool.ts::resolverNextval). Por
-- eso una secuencia nueva se agrega con un INSERT, nunca con DDL de
-- secuencia — igual que 'comensal_seq'/'facturas_numero_seq' en schema.sql.
INSERT INTO secuencias (nombre, valor) VALUES ('vales_numero_seq', 0)
  ON DUPLICATE KEY UPDATE nombre = nombre;

-- `caja_egresos_acumulado` no tenía estas dos columnas (a diferencia de
-- `movimientos_caja`, que sí las usan los ingresos) — las necesita un vale
-- con fuente "acumulado" para poder anularse después.
ALTER TABLE caja_egresos_acumulado
  ADD COLUMN referencia_entidad VARCHAR(80) NULL AFTER usuario_id,
  ADD COLUMN referencia_id      VARCHAR(64) NULL AFTER referencia_entidad;

-- --- Módulo + categoría de gasto fija ---
INSERT INTO modulos (slug, nombre)
SELECT 'vales', 'Vales'
WHERE NOT EXISTS (SELECT 1 FROM modulos WHERE slug = 'vales');

INSERT INTO categorias_gasto (nombre, modulo_id)
SELECT 'Vales', (SELECT id FROM modulos WHERE slug = 'vales')
WHERE NOT EXISTS (SELECT 1 FROM categorias_gasto WHERE nombre = 'Vales');

-- --- Permisos ---
INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'vales'), x.accion, x.codigo
FROM (SELECT 'ver' AS accion, 'vales.ver' AS codigo
      UNION ALL SELECT 'crear', 'vales.crear'
      UNION ALL SELECT 'marcar_repuesto', 'vales.marcar_repuesto'
      UNION ALL SELECT 'anular', 'vales.anular') AS x
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = x.codigo);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Root', 'Super Root')
  AND p.codigo IN ('vales.ver', 'vales.crear', 'vales.marcar_repuesto', 'vales.anular')
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);
