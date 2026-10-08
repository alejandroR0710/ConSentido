-- ============================================================================
-- Módulo Vales — extensión "Deudas" (dinero que un empleado o cliente le
-- debe al negocio, con o sin préstamo inicial) — ver
-- docs/superpowers/specs/2026-10-08-vales-deudas-design.md
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- ============================================================================

-- Las dos restricciones originales sin nombre explícito ya no son correctas:
-- `fuente` va a pasar a NULL-able (deuda sin préstamo), y en ese caso
-- monto_efectivo+monto_banco en 0 es válido. Se buscan por catálogo en vez
-- de adivinar su nombre autogenerado — mismo patrón ya usado en
-- 2026-10-04_modulo_pedidos.sql — para no arriesgarse a borrar por error
-- OTRA restricción (ej. la de dueno_id) si el nombre adivinado resultara
-- existir pero apuntar a algo distinto. Van primero, antes de tocar
-- columnas: si cualquiera de las dos no se encuentra, el script para acá
-- sin haber modificado nada todavía.
SET @chk_fuente := (SELECT tc.CONSTRAINT_NAME
             FROM information_schema.TABLE_CONSTRAINTS tc
             JOIN information_schema.CHECK_CONSTRAINTS cc
               ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
             WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = 'vales'
               AND tc.CONSTRAINT_TYPE = 'CHECK' AND cc.CHECK_CLAUSE LIKE '%turno%'
             LIMIT 1);
SET @sql_fuente := CONCAT('ALTER TABLE vales DROP CHECK ', @chk_fuente);
PREPARE stmt_fuente FROM @sql_fuente; EXECUTE stmt_fuente; DEALLOCATE PREPARE stmt_fuente;

SET @chk_monto := (SELECT tc.CONSTRAINT_NAME
             FROM information_schema.TABLE_CONSTRAINTS tc
             JOIN information_schema.CHECK_CONSTRAINTS cc
               ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
             WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = 'vales'
               AND tc.CONSTRAINT_TYPE = 'CHECK' AND cc.CHECK_CLAUSE LIKE '%monto_efectivo%'
             LIMIT 1);
SET @sql_monto := CONCAT('ALTER TABLE vales DROP CHECK ', @chk_monto);
PREPARE stmt_monto FROM @sql_monto; EXECUTE stmt_monto; DEALLOCATE PREPARE stmt_monto;

ALTER TABLE vales
  MODIFY COLUMN fuente VARCHAR(20) NULL,
  ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'pago' AFTER numero,
  ADD COLUMN monto_adeudado DECIMAL(12,2) NULL AFTER monto_banco,
  ADD COLUMN cobrado_en DATETIME(6) NULL AFTER fuente_reposicion,
  ADD COLUMN monto_cobrado_efectivo DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER cobrado_en,
  ADD COLUMN monto_cobrado_banco DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER monto_cobrado_efectivo;

ALTER TABLE vales
  ADD CONSTRAINT chk_vales_tipo CHECK (tipo IN ('pago','deuda')),
  ADD CONSTRAINT chk_vales_fuente CHECK (fuente IS NULL OR fuente IN ('turno','acumulado','dueno')),
  ADD CONSTRAINT chk_vales_fuente_null_solo_deuda CHECK (fuente IS NOT NULL OR tipo = 'deuda'),
  ADD CONSTRAINT chk_vales_monto_pago CHECK (fuente IS NULL OR monto_efectivo + monto_banco > 0),
  ADD CONSTRAINT chk_vales_monto_adeudado CHECK (fuente IS NOT NULL OR (monto_adeudado IS NOT NULL AND monto_adeudado > 0)),
  ADD CONSTRAINT chk_vales_cobro_solo_deuda CHECK (cobrado_en IS NULL OR tipo = 'deuda'),
  ADD CONSTRAINT chk_vales_monto_cobrado CHECK (cobrado_en IS NULL OR monto_cobrado_efectivo + monto_cobrado_banco > 0);

CREATE INDEX idx_vales_tipo ON vales(tipo);

-- --- Permiso nuevo ---
INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'vales'), 'marcar_cobrado', 'vales.marcar_cobrado'
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = 'vales.marcar_cobrado');

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Root', 'Super Root')
  AND p.codigo = 'vales.marcar_cobrado'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);
