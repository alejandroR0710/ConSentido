-- ============================================================================
-- Usuarios — borrado suave (deleted_at).
--
-- "Eliminar usuario" seguía intentando un DELETE físico; si el usuario tiene
-- actividad registrada (órdenes, ventas, caja, pedidos, etc.) ese DELETE
-- fallaba por las foreign keys y el usuario quedaba sin poder eliminarse.
-- Ahora, cuando eso pasa, en vez de fallar se marca deleted_at + activo=false:
-- el usuario queda vinculado igual que siempre (todo su historial sigue
-- apuntando a su id, sin tocar ninguna otra tabla), pero no puede iniciar
-- sesión y se muestra como "eliminado" en el listado.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- ============================================================================

ALTER TABLE usuarios ADD COLUMN deleted_at DATETIME(6) NULL AFTER activo;
