-- ============================================================================
-- SIsteMAPOS - Seed inicial (roles, permisos, usuario Super Root)
-- Requiere haber aplicado antes database/schema.sql
-- ============================================================================

-- Permisos: uno por cada requirePermission(...) usado en las rutas del backend.
INSERT INTO permisos (modulo_id, accion, codigo) VALUES
  ((SELECT id FROM modulos WHERE slug = 'insumos'), 'ver',    'insumos.insumos.ver'),
  ((SELECT id FROM modulos WHERE slug = 'insumos'), 'crear',  'insumos.insumos.crear'),
  ((SELECT id FROM modulos WHERE slug = 'insumos'), 'editar', 'insumos.insumos.editar'),
  ((SELECT id FROM modulos WHERE slug = 'insumos'), 'crear',  'insumos.movimientos.crear'),
  ((SELECT id FROM modulos WHERE slug = 'general'), 'ver',                  'general.caja.ver'),
  ((SELECT id FROM modulos WHERE slug = 'general'), 'abrir_turno',          'general.caja.abrir_turno'),
  ((SELECT id FROM modulos WHERE slug = 'general'), 'cerrar_turno',         'general.caja.cerrar_turno'),
  ((SELECT id FROM modulos WHERE slug = 'general'), 'registrar_ingreso',    'general.caja.registrar_ingreso'),
  ((SELECT id FROM modulos WHERE slug = 'general'), 'registrar_egreso',     'general.caja.registrar_egreso'),
  ((SELECT id FROM modulos WHERE slug = 'general'), 'administrar_categorias','general.caja.administrar_categorias'),
  ((SELECT id FROM modulos WHERE slug = 'general'), 'resetear',             'general.caja.resetear'),
  ((SELECT id FROM modulos WHERE slug = 'general'), 'editar_movimiento',    'general.caja.editar_movimiento'),
  ((SELECT id FROM modulos WHERE slug = 'general'), 'borrar_historial',     'general.caja.borrar_historial'),
  ((SELECT id FROM modulos WHERE slug = 'general'), 'reiniciar_todo',       'general.sistema.reiniciar_todo'),
  ((SELECT id FROM modulos WHERE slug = 'general'), 'ver_analytics',        'general.dashboard.analytics.ver'),
  ((SELECT id FROM modulos WHERE slug = 'general'), 'ver_usuarios',         'general.usuarios.ver'),
  ((SELECT id FROM modulos WHERE slug = 'general'), 'crear_usuario',        'general.usuarios.crear'),
  ((SELECT id FROM modulos WHERE slug = 'general'), 'editar_usuario',       'general.usuarios.editar'),
  ((SELECT id FROM modulos WHERE slug = 'general'), 'eliminar_usuario',     'general.usuarios.eliminar'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'ver',          'migao.ordenes.ver'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'crear',        'migao.ordenes.crear'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'agregar_item', 'migao.ordenes.agregar_item'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'editar_item',   'migao.ordenes.editar_item'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'cambiar_mesa',  'migao.ordenes.cambiar_mesa'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'agregar_para_llevar', 'migao.ordenes.agregar_para_llevar'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'pago_administrativo', 'migao.ordenes.pago_administrativo'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'entregar_item', 'migao.ordenes.entregar_item'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'cerrar',       'migao.ordenes.cerrar'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'cancelar',     'migao.ordenes.cancelar'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'resetear',     'migao.ordenes.resetear'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'ver_cocina',        'migao.cocina.ver'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'actualizar_estado', 'migao.cocina.actualizar_estado'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'ver_productos',   'migao.productos.ver'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'crear_producto',  'migao.productos.crear'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'editar_producto', 'migao.productos.editar'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'ver_inventario',         'migao.inventario.ver'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'administrar_inventario', 'migao.inventario.administrar'),
  ((SELECT id FROM modulos WHERE slug = 'migao'), 'eliminar_forzado_inventario', 'migao.inventario.eliminar_forzado'),
  ((SELECT id FROM modulos WHERE slug = 'con_sentido'), 'ver_productos',   'con_sentido.productos.ver'),
  ((SELECT id FROM modulos WHERE slug = 'con_sentido'), 'crear_producto',  'con_sentido.productos.crear'),
  ((SELECT id FROM modulos WHERE slug = 'con_sentido'), 'editar_producto', 'con_sentido.productos.editar'),
  ((SELECT id FROM modulos WHERE slug = 'con_sentido'), 'ver_clientes',    'con_sentido.clientes.ver'),
  ((SELECT id FROM modulos WHERE slug = 'con_sentido'), 'crear_cliente',   'con_sentido.clientes.crear'),
  ((SELECT id FROM modulos WHERE slug = 'con_sentido'), 'ver_ventas',      'con_sentido.ventas.ver'),
  ((SELECT id FROM modulos WHERE slug = 'con_sentido'), 'crear_venta',     'con_sentido.ventas.crear');

-- Roles
INSERT INTO roles (nombre, descripcion) VALUES
  ('Super Root', 'Acceso total: administración de usuarios, configuración general y supervisión global.'),
  ('Root', 'Mismo alcance que Super Root (todas las vistas y módulos), salvo los botones de reinicio/borrado de historial (Caja, Órdenes, Reinicio total).'),
  ('Cajero', 'Centraliza pagos de cualquier módulo en Caja General; único rol que puede cerrar una mesa/orden en Migao.'),
  ('Cocina', 'Únicamente ve la cola de pedidos realizados y puede marcarlos como preparando o listo.'),
  ('Mesero', 'Crea órdenes y agrega/edita/cancela sus ítems; cada cambio queda en el historial de la orden. No puede cerrar ni cobrar.'),
  ('Administrador', 'Administra el catálogo: crea productos del menú de Migao y crea insumos del almacén. No toma órdenes, no cobra ni ve cocina.');

-- Super Root: todos los permisos existentes
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT (SELECT id FROM roles WHERE nombre = 'Super Root'), p.id
FROM permisos p;

-- Root: todos los permisos EXCEPTO los botones de reinicio/borrado de
-- historial — esos siguen siendo exclusivos de Super Root.
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT (SELECT id FROM roles WHERE nombre = 'Root'), p.id
FROM permisos p
WHERE p.codigo NOT IN (
  'general.caja.resetear',
  'general.caja.borrar_historial',
  'general.sistema.reiniciar_todo',
  'migao.ordenes.resetear',
  'migao.inventario.eliminar_forzado'
);

-- Cajero: Caja General completa + ver y cerrar órdenes de Migao (NO crear/agregar_item: eso es del mesero)
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT (SELECT id FROM roles WHERE nombre = 'Cajero'), p.id
FROM permisos p
WHERE p.codigo IN (
  'general.caja.ver',
  'general.caja.abrir_turno',
  'general.caja.cerrar_turno',
  'general.caja.registrar_ingreso',
  'general.caja.registrar_egreso',
  'general.caja.administrar_categorias',
  'migao.ordenes.ver',
  'migao.ordenes.cerrar',
  'migao.ordenes.cancelar',
  'migao.ordenes.agregar_para_llevar'
);

-- Cocina: SOLO puede ver la cola de pedidos y cambiar el estado a preparando/listo.
-- Sin acceso a migao.ordenes.* (no ve cobros, no crea órdenes, no cierra mesas).
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT (SELECT id FROM roles WHERE nombre = 'Cocina'), p.id
FROM permisos p
WHERE p.codigo IN (
  'migao.cocina.ver',
  'migao.cocina.actualizar_estado',
  'migao.inventario.ver',
  'migao.inventario.administrar'
);

-- Mesero: crea, ve, agrega y edita/cancela ítems de órdenes. NO puede cerrar/cobrar
-- (migao.ordenes.cerrar es exclusivo de Cajero) ni tocar Caja General. Necesita
-- migao.productos.ver para poder buscar productos al armar un pedido.
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT (SELECT id FROM roles WHERE nombre = 'Mesero'), p.id
FROM permisos p
WHERE p.codigo IN (
  'migao.ordenes.ver',
  'migao.ordenes.crear',
  'migao.ordenes.agregar_item',
  'migao.ordenes.editar_item',
  'migao.ordenes.entregar_item',
  'migao.ordenes.cambiar_mesa',
  'migao.productos.ver'
);

-- Administrador: crea productos del menú de Migao y crea/edita insumos del
-- almacén. Sin acceso a órdenes, cobros ni cocina.
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT (SELECT id FROM roles WHERE nombre = 'Administrador'), p.id
FROM permisos p
WHERE p.codigo IN (
  'insumos.insumos.ver',
  'insumos.insumos.crear',
  'insumos.insumos.editar',
  'migao.productos.ver',
  'migao.productos.crear',
  'migao.productos.editar'
);

-- Usuario Super Root
-- Contraseña en texto plano (solo para este seed de desarrollo): SuperRoot2026!
-- pgcrypto (ya habilitado por schema.sql) genera un hash bcrypt compatible con bcryptjs.
INSERT INTO usuarios (nombre, email, password_hash, rol_id) VALUES (
  'Super Root',
  'admin@sistemapos.local',
  crypt('SuperRoot2026!', gen_salt('bf')),
  (SELECT id FROM roles WHERE nombre = 'Super Root')
);

-- Usuarios Root (acceso total salvo botones de reinicio/borrado)
INSERT INTO usuarios (nombre, email, password_hash, rol_id) VALUES
  ('Alejandra', 'alejandra@sistemapos.local', crypt('Root2026!', gen_salt('bf')), (SELECT id FROM roles WHERE nombre = 'Root')),
  ('Julian', 'julian@sistemapos.local', crypt('Root2026!', gen_salt('bf')), (SELECT id FROM roles WHERE nombre = 'Root'));

-- Usuario de prueba para el rol Cocina
INSERT INTO usuarios (nombre, email, password_hash, rol_id) VALUES (
  'Cocina',
  'cocina@sistemapos.local',
  crypt('Cocina2026!', gen_salt('bf')),
  (SELECT id FROM roles WHERE nombre = 'Cocina')
);

-- Usuario de prueba para el rol Cajero
INSERT INTO usuarios (nombre, email, password_hash, rol_id) VALUES (
  'Cajero',
  'cajero@sistemapos.local',
  crypt('Cajero2026!', gen_salt('bf')),
  (SELECT id FROM roles WHERE nombre = 'Cajero')
);

-- Usuarios de prueba para el rol Mesero (5 en total: varios meseros comparten la
-- misma lista de órdenes abiertas, por eso cada orden ahora muestra qué mesero
-- la creó). Todos con la misma contraseña por simplicidad en desarrollo local.
INSERT INTO usuarios (nombre, email, password_hash, rol_id) VALUES
  ('Mesero', 'mesero@sistemapos.local', crypt('Mesero2026!', gen_salt('bf')), (SELECT id FROM roles WHERE nombre = 'Mesero')),
  ('Ana', 'mesero2@sistemapos.local', crypt('Mesero2026!', gen_salt('bf')), (SELECT id FROM roles WHERE nombre = 'Mesero')),
  ('Carlos', 'mesero3@sistemapos.local', crypt('Mesero2026!', gen_salt('bf')), (SELECT id FROM roles WHERE nombre = 'Mesero')),
  ('Luisa', 'mesero4@sistemapos.local', crypt('Mesero2026!', gen_salt('bf')), (SELECT id FROM roles WHERE nombre = 'Mesero')),
  ('Pedro', 'mesero5@sistemapos.local', crypt('Mesero2026!', gen_salt('bf')), (SELECT id FROM roles WHERE nombre = 'Mesero'));

-- Usuario de prueba para el rol Administrador
INSERT INTO usuarios (nombre, email, password_hash, rol_id) VALUES (
  'Administrador',
  'administrador@sistemapos.local',
  crypt('Administrador2026!', gen_salt('bf')),
  (SELECT id FROM roles WHERE nombre = 'Administrador')
);

-- Acceso explícito a TODOS los módulos, incluidos los que aún no tienen permisos propios
-- (Talleres, Con Sentido, Pedidos): el Super Root debe ver todo el sistema, no solo lo
-- que ya tiene endpoints construidos. Cuando esos módulos tengan permisos reales, deben
-- agregarse también a roles_permisos de este rol (ver nota en FASE5_DESARROLLO.md).
INSERT INTO usuarios_modulos (usuario_id, modulo_id)
SELECT (SELECT id FROM usuarios WHERE email = 'admin@sistemapos.local'), m.id
FROM modulos m;

-- Mismo acceso total a módulos para los usuarios Root.
INSERT INTO usuarios_modulos (usuario_id, modulo_id)
SELECT u.id, m.id
FROM usuarios u
CROSS JOIN modulos m
WHERE u.email IN ('alejandra@sistemapos.local', 'julian@sistemapos.local');
