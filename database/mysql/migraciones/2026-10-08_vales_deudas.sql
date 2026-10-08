-- ============================================================================
-- Módulo Vales — extensión "Deudas" (dinero que un empleado o cliente le
-- debe al negocio, con o sin préstamo inicial) — ver
-- docs/superpowers/specs/2026-10-08-vales-deudas-design.md
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- ============================================================================

ALTER TABLE vales
  MODIFY COLUMN fuente VARCHAR(20) NULL,
  ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'pago' AFTER numero,
  ADD COLUMN monto_adeudado DECIMAL(12,2) NULL AFTER monto_banco,
  ADD COLUMN cobrado_en DATETIME(6) NULL AFTER fuente_reposicion,
  ADD COLUMN monto_cobrado_efectivo DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER cobrado_en,
  ADD COLUMN monto_cobrado_banco DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER monto_cobrado_efectivo;

-- Las dos restricciones originales sin nombre explícito (MySQL las nombró
-- automáticamente vales_chk_1/vales_chk_2, por orden de aparición en el
-- CREATE TABLE original) ya no son correctas: `fuente` ahora puede ser NULL
-- (deuda sin préstamo), y en ese caso monto_efectivo+monto_banco en 0 es
-- válido. Si alguno de estos DROP falla con "check constraint does not
-- exist", el nombre real es distinto al esperado — consulta
-- information_schema.TABLE_CONSTRAINTS (columna CONSTRAINT_NAME, filtrando
-- TABLE_NAME='vales' y CONSTRAINT_TYPE='CHECK') para encontrar el nombre
-- real antes de reintentar. Es un fallo ruidoso y recuperable, nunca
-- silencioso.
ALTER TABLE vales DROP CONSTRAINT vales_chk_1;
ALTER TABLE vales DROP CONSTRAINT vales_chk_2;

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
