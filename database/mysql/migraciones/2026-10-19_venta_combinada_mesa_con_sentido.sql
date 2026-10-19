-- ============================================================================
-- Venta combinada: mesa de Migao + productos Con Sentido
-- Ver docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md
-- ============================================================================

ALTER TABLE con_sentido_ventas
  ADD COLUMN parte_id CHAR(36) NULL,
  ADD COLUMN descuento_porcentaje DECIMAL(5,2) NULL DEFAULT 0,
  ADD COLUMN descuento DECIMAL(12,2) NULL DEFAULT 0,
  MODIFY metodo_pago VARCHAR(20) NULL,
  ADD CONSTRAINT fk_con_sentido_ventas_parte FOREIGN KEY (parte_id) REFERENCES migao_cuenta_partes(id);

-- Nombre del CHECK confirmado en la base real antes de escribir esta migración
-- (con_sentido_ventas_chk_2) — ver riesgo de nombres de constraint sin nombre
-- ya documentado en la migración de vales_deudas.
ALTER TABLE con_sentido_ventas DROP CHECK con_sentido_ventas_chk_2;
ALTER TABLE con_sentido_ventas
  ADD CONSTRAINT chk_con_sentido_ventas_estado CHECK (estado IN ('pendiente', 'completada', 'anulada'));

INSERT INTO permisos (modulo_id, accion, codigo) VALUES
  ((SELECT id FROM modulos WHERE slug = 'con_sentido'), 'vincular_mesa', 'con_sentido.ventas.vincular_mesa');

-- El "acceso total" de Root/Super Root es una foto fija tomada al correr el
-- seed, no una regla dinámica — todo permiso nuevo hay que otorgárselo acá
-- a mano, igual que ya se hizo en la migración de Recetario.
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Root', 'Super Root')
  AND p.codigo = 'con_sentido.ventas.vincular_mesa';

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT (SELECT id FROM roles WHERE nombre = 'Cajero'), id FROM permisos WHERE codigo = 'con_sentido.ventas.vincular_mesa';
