-- ============================================================================
-- "Bolsillo": un egreso que queda registrado en el turno activo (se ve en
-- Movimientos del turno, en morado) pero que NO debe restar del efectivo/
-- banco que el cajero cuenta al cerrar ese turno — solo resta del Acumulado
-- Total histórico de la tienda. Se marca con la nueva columna es_bolsillo;
-- el backend excluye esas filas de sumMovimientosPorTurno (cuadre del turno)
-- y de los reportes/Dashboard, pero NO de getAcumuladoMovimientosCaja (que ya
-- suma movimientos_caja completo sin filtrar, así que el Acumulado Total
-- baja automáticamente sin tocar esa consulta).
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- Los INSERT de permisos son re-ejecutables sin duplicar filas.
-- ============================================================================

ALTER TABLE movimientos_caja
  ADD COLUMN es_bolsillo TINYINT(1) NOT NULL DEFAULT 0;

INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'general'), 'registrar_bolsillo', 'general.caja.registrar_bolsillo'
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = 'general.caja.registrar_bolsillo');

-- Mismo criterio que "Egreso acumulado": solo Root y Super Root, nunca Cajero.
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Root', 'Super Root')
  AND p.codigo = 'general.caja.registrar_bolsillo'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);
