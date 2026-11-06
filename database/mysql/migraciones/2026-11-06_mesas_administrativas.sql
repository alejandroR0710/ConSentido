-- ============================================================================
-- Mesas administrativas: una mesa del plano (Editor de mesas) se puede marcar
-- como `administrativa` — solo Root/Super Root pueden abrir una orden nueva
-- en ella o mover una orden existente hacia ella; Mesero/Cajero no.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- El ALTER TABLE no es re-ejecutable (ya existiría la columna); los INSERT sí.
-- ============================================================================

ALTER TABLE mesas ADD COLUMN administrativa BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'migao'), 'usar_mesa_administrativa', 'migao.mesas.usar_administrativa'
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = 'migao.mesas.usar_administrativa');

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Root', 'Super Root')
  AND p.codigo = 'migao.mesas.usar_administrativa'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);
