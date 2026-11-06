-- ============================================================================
-- Rol "Apartamento": por ahora solo con acceso a las tareas que se le
-- asignen (tareas.ver_propias) — ni Dashboard, ni ningún otro módulo. Si más
-- adelante necesita más permisos, se agregan con otro INSERT a roles_permisos
-- igual que este.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- Es re-ejecutable sin duplicar filas.
-- ============================================================================

INSERT INTO roles (nombre, descripcion)
SELECT 'Apartamento', 'Solo ve y actualiza el estado de las tareas que se le asignen.'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE nombre = 'Apartamento');

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre = 'Apartamento'
  AND p.codigo = 'tareas.ver_propias'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);
