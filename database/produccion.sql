-- ========================================================================
-- SCRIPTS DE PRODUCCIÓN - Ejecutar en LOCAL y SUPABASE
-- ========================================================================
-- ⚠️ IMPORTANTE: SOLO CAMBIOS DE FUNCIONALIDAD/MEJORAS
-- ❌ NUNCA tocar datos existentes
-- ========================================================================
-- Última actualización: 2026-07-30
-- Descripción: Con Sentido (ventas, catálogo, clientes) + corrección de un
-- error de la migración anterior que dejaba con_sentido_venta_items sin
-- poder guardar ítems (ver SECCIÓN 1B).
-- ========================================================================

-- ========================================================================
-- SECCIÓN 1: CAMBIOS DE SCHEMA (Nuevas tablas, columnas, índices)
-- ========================================================================

-- ========================================================================
-- TABLA: con_sentido_ventas (Historial de ventas Con Sentido)
-- ========================================================================
CREATE TABLE IF NOT EXISTS con_sentido_ventas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID REFERENCES usuarios(id),
  monto NUMERIC(12,2) NOT NULL,
  metodo_pago VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo', 'banco', 'mixto')),
  monto_efectivo NUMERIC(12,2),
  monto_banco NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- venta_id es UUID (referencia real a con_sentido_ventas.id) — NUNCA bigint,
-- ver SECCIÓN 1B si esta tabla ya existía con el tipo equivocado.
CREATE TABLE IF NOT EXISTS con_sentido_venta_items (
  id BIGSERIAL PRIMARY KEY,
  venta_id UUID NOT NULL REFERENCES con_sentido_ventas(id) ON DELETE CASCADE,
  producto VARCHAR(255) NOT NULL,
  descripcion TEXT,
  categoria VARCHAR(100),
  cantidad NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2) NOT NULL,
  subtotal NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_con_sentido_ventas_fecha ON con_sentido_ventas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_con_sentido_ventas_usuario ON con_sentido_ventas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_con_sentido_venta_items_venta ON con_sentido_venta_items(venta_id);

DROP TRIGGER IF EXISTS update_con_sentido_ventas_updated_at ON con_sentido_ventas;
CREATE TRIGGER update_con_sentido_ventas_updated_at
BEFORE UPDATE ON con_sentido_ventas
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();


-- ========================================================================
-- SECCIÓN 1B: CORRECCIÓN — venta_id quedó en BIGINT por una migración
-- anterior (intentaba enlazar con movimientos_caja, pero el código real
-- inserta el UUID de con_sentido_ventas). Con esa migración aplicada, CADA
-- ítem de CADA venta fallaba al insertarse en silencio (el error se
-- descartaba en el backend), así que las ventas quedaban sin productos.
-- Este bloque revierte el tipo a UUID — solo si la tabla está vacía (si
-- tuviera filas con datos reales en bigint, no se puede reconstruir el UUID
-- original, así que se prefiere frenar con un error explícito a corromper
-- datos).
-- ========================================================================
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_name = 'con_sentido_venta_items' AND column_name = 'venta_id') = 'bigint' THEN
    IF (SELECT count(*) FROM con_sentido_venta_items) = 0 THEN
      ALTER TABLE con_sentido_venta_items ALTER COLUMN venta_id TYPE UUID USING venta_id::text::uuid;
    ELSE
      RAISE EXCEPTION 'con_sentido_venta_items tiene filas con venta_id en bigint — revisar a mano antes de convertir a UUID (ver SECCIÓN 1B de produccion.sql)';
    END IF;
  END IF;
END $$;

ALTER TABLE con_sentido_venta_items DROP CONSTRAINT IF EXISTS con_sentido_venta_items_venta_id_fkey;
ALTER TABLE con_sentido_venta_items
  ADD CONSTRAINT con_sentido_venta_items_venta_id_fkey
  FOREIGN KEY (venta_id) REFERENCES con_sentido_ventas(id) ON DELETE CASCADE;

-- Permitir NULL en usuario_id de movimientos_caja (no siempre hay usuario autenticado).
ALTER TABLE movimientos_caja ALTER COLUMN usuario_id DROP NOT NULL;

-- Columna que ya usa el backend (Caja → Proveedores, feature de otra sesión)
-- pero que nunca se había agregado a la tabla: SIN esto, registrar CUALQUIER
-- egreso (con o sin proveedor) fallaba con "no existe la columna proveedor_id".
ALTER TABLE movimientos_caja ADD COLUMN IF NOT EXISTS proveedor_id UUID REFERENCES proveedores(id);


-- ========================================================================
-- SECCIÓN 1C: ANULAR VENTA (Root/Super Root, desde Caja General → Historial)
-- ========================================================================
-- Mismo patrón que la tabla genérica `ventas` (que ya tenía 'anulada' sin
-- usar): se conserva el registro para auditoría, solo deja de contar en
-- analíticas y pierde sus pagos/movimientos de Caja asociados.
ALTER TABLE con_sentido_ventas ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'completada';
DO $$ BEGIN
  ALTER TABLE con_sentido_ventas ADD CONSTRAINT con_sentido_ventas_estado_check CHECK (estado IN ('completada', 'anulada'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Permite registrar la anulación de una venta en el mismo historial de
-- cambios que ya usa "editar movimiento histórico".
ALTER TABLE movimientos_caja_ediciones DROP CONSTRAINT IF EXISTS movimientos_caja_ediciones_accion_check;
ALTER TABLE movimientos_caja_ediciones
  ADD CONSTRAINT movimientos_caja_ediciones_accion_check CHECK (accion IN ('creado', 'editado', 'anulado'));


-- ========================================================================
-- SECCIÓN 2: CATEGORÍAS DE GASTO (Solo crear si NO EXISTEN)
-- ========================================================================
INSERT INTO categorias_gasto (nombre, activo) VALUES
('Servicios', true),
('Mantenimiento', true),
('Suministros', true),
('Otros', true)
ON CONFLICT (nombre) DO NOTHING;


-- ========================================================================
-- SECCIÓN 2C: AMASIJOS Y BASES DE MIGAO — YA VIVEN EN EL INVENTARIO GENERAL
-- ========================================================================
-- El primer intento de este módulo (más abajo, ahora borrado) duplicaba el
-- stock de amasijos/bases en tablas propias — pero los amasijos (Almojábana,
-- Arepa boyacense, Arepa garulla, Buñuelo, Pan de yuca) y las bases (Base
-- casa, Base Valluno, Base Boyacense, Base Migadito) YA existen como
-- productos normales en migao_inventario_productos, con su propio stock y
-- stock mínimo — no hay que duplicar nada, solo conectar:
--  1. migao_base_recetas: qué amasijos (y cuánto) arma cada base.
--  2. migao_producto_ingredientes: qué producto del menú consume qué
--     amasijo/base al venderse — ya existe ese mecanismo para cualquier
--     receta, se usa tal cual (ver inventario.service.ts::aplicarConsumoPorProducto).
-- DROP de las tablas del primer intento — no-op si nunca se llegaron a crear
-- en esta base (nunca se aplicó esta sección contra Supabase antes de este cambio).
DROP TABLE IF EXISTS migao_bases_movimientos;
DROP TABLE IF EXISTS migao_bases_preparadas;
DROP TABLE IF EXISTS migao_base_recetas;
DROP TABLE IF EXISTS migao_amasijos_movimientos;
DROP TABLE IF EXISTS migao_amasijos;
DROP TABLE IF EXISTS migao_base_tipos;
DROP TABLE IF EXISTS migao_amasijo_tipos;

CREATE TABLE IF NOT EXISTS migao_base_recetas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_producto_id    UUID NOT NULL REFERENCES migao_inventario_productos(id) ON DELETE CASCADE,
  amasijo_producto_id UUID NOT NULL REFERENCES migao_inventario_productos(id) ON DELETE CASCADE,
  cantidad_amasijo    NUMERIC(12,3) NOT NULL CHECK (cantidad_amasijo > 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(base_producto_id, amasijo_producto_id)
);
CREATE INDEX IF NOT EXISTS idx_migao_base_recetas_base ON migao_base_recetas(base_producto_id);
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'usuario') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON migao_base_recetas TO usuario;
  END IF;
END $$;

-- Recetas confirmadas (Migao Valluno queda con Pan de yuca + Arepa garulla
-- nada más — el tercer ingrediente que se creía "Pan de bono" no existe en
-- el inventario real, hay que agregarlo desde la pantalla de Amasijos
-- cuando se confirme cuál es).
INSERT INTO migao_base_recetas (base_producto_id, amasijo_producto_id, cantidad_amasijo)
SELECT b.id, a.id, r.cantidad
FROM (VALUES
  ('Base casa', 'Almojabana', 0.5),
  ('Base casa', 'Pan de yuca', 0.5),
  ('Base casa', 'Buñuelo', 0.5),
  ('Base Valluno', 'Pan de yuca', 0.5),
  ('Base Valluno', 'Arepa Garuya', 0.5),
  ('Base Boyasence', 'Almojabana', 0.5),
  ('Base Boyasence', 'Arepa boyasence', 0.5),
  ('Base Boyasence', 'Arepa Garuya', 0.5),
  ('Base Migadito', 'Almojabana', 0.5)
) AS r(base_nombre, amasijo_nombre, cantidad)
JOIN migao_inventario_productos b ON b.nombre = r.base_nombre
JOIN migao_inventario_productos a ON a.nombre = r.amasijo_nombre
WHERE NOT EXISTS (
  SELECT 1 FROM migao_base_recetas
  WHERE base_producto_id = b.id AND amasijo_producto_id = a.id
);

-- Vincula cada producto del MENÚ con el amasijo/base que consume al
-- venderse — 1 unidad del producto = 1 unidad de ese inventario. Aditivo:
-- solo agrega la fila si ese producto todavía no tenía NINGÚN ingrediente
-- con ese inventario_producto_id — nunca toca ni duplica lo que ya exista.
INSERT INTO migao_producto_ingredientes (producto_id, inventario_producto_id, cantidad_por_unidad)
SELECT p.id, ip.id, 1
FROM (VALUES
  ('Almojábana', 'Almojabana'),
  ('Pan de yuca', 'Pan de yuca'),
  ('Arepa boyacense', 'Arepa boyasence'),
  ('Arepa garulla', 'Arepa Garuya'),
  ('Migao de la Casa', 'Base casa'),
  ('Migao Valluno', 'Base Valluno'),
  ('Migao Boyacense', 'Base Boyasence'),
  ('Migadito', 'Base Migadito')
) AS r(producto_nombre, inventario_nombre)
JOIN productos p ON p.nombre = r.producto_nombre
JOIN modulos m ON m.id = p.modulo_id AND m.slug = 'migao'
JOIN migao_inventario_productos ip ON ip.nombre = r.inventario_nombre
WHERE NOT EXISTS (
  SELECT 1 FROM migao_producto_ingredientes
  WHERE producto_id = p.id AND inventario_producto_id = ip.id
);

-- Permisos de amasijos en RBAC — la pantalla de Amasijos sigue existiendo
-- como calculadora de recomendación + editor de recetas sobre el inventario
-- general, así que el permiso sigue haciendo falta.
INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'migao'), x.accion, x.codigo
FROM (VALUES
  ('ver', 'migao.amasijos.ver'),
  ('administrar', 'migao.amasijos.administrar')
) AS x(accion, codigo)
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = x.codigo);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Super Root', 'Root', 'Cocina')
  AND p.codigo IN ('migao.amasijos.ver', 'migao.amasijos.administrar')
  AND NOT EXISTS (
    SELECT 1 FROM roles_permisos rp
    WHERE rp.rol_id = r.id AND rp.permiso_id = p.id
  );


-- ========================================================================
-- SECCIÓN 2D: REPARTO DE PROPINAS POR DÍA + HISTORIAL POR PERSONA
-- ========================================================================
-- Antes, "Repartir" tomaba TODO lo pendiente de un método sin poder elegir
-- fechas, y quedaba como un solo monto sin desglose de a quién se le entregó.
-- Ahora se puede elegir qué días concretos (una semana completa o sueltos)
-- se van a repartir, y esa liquidación se desglosa en una o más "entregas"
-- por persona, con su propia fecha y motivo/mensaje opcional.
ALTER TABLE migao_propinas_liquidaciones ADD COLUMN IF NOT EXISTS fecha_desde DATE;
ALTER TABLE migao_propinas_liquidaciones ADD COLUMN IF NOT EXISTS fecha_hasta DATE;

CREATE TABLE IF NOT EXISTS migao_propinas_entregas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  liquidacion_id  UUID NOT NULL REFERENCES migao_propinas_liquidaciones(id) ON DELETE CASCADE,
  nombre_persona  VARCHAR(120) NOT NULL,
  monto           NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  fecha_entrega   DATE NOT NULL DEFAULT CURRENT_DATE,
  motivo          VARCHAR(300),
  usuario_id      UUID REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_migao_propinas_entregas_liquidacion ON migao_propinas_entregas(liquidacion_id);
CREATE INDEX IF NOT EXISTS idx_migao_propinas_entregas_fecha ON migao_propinas_entregas(fecha_entrega DESC);

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'usuario') THEN
    GRANT SELECT, INSERT ON migao_propinas_entregas TO usuario;
  END IF;
END $$;


-- ========================================================================
-- SECCIÓN 2E: REPARTO DE PROPINAS UNIFICADO (efectivo + banco a la vez)
-- ========================================================================
-- Antes, cada reparto era de UN método completo (efectivo O banco). Ahora un
-- solo reparto puede cubrir los dos montos pendientes a la vez, y cada
-- entrega/persona elige su propio método de pago (en qué se le entrega a
-- ESA persona, sin importar en qué método vino la propina original).
ALTER TABLE migao_propinas_liquidaciones ADD COLUMN IF NOT EXISTS monto_efectivo NUMERIC(12,2);
ALTER TABLE migao_propinas_liquidaciones ADD COLUMN IF NOT EXISTS monto_banco NUMERIC(12,2);
-- Migra los repartos viejos (un solo método) a las columnas nuevas.
UPDATE migao_propinas_liquidaciones SET monto_efectivo = monto WHERE metodo_pago = 'efectivo' AND monto_efectivo IS NULL;
UPDATE migao_propinas_liquidaciones SET monto_banco = monto WHERE metodo_pago = 'banco' AND monto_banco IS NULL;
UPDATE migao_propinas_liquidaciones SET monto_efectivo = COALESCE(monto_efectivo, 0), monto_banco = COALESCE(monto_banco, 0);
ALTER TABLE migao_propinas_liquidaciones ALTER COLUMN monto_efectivo SET NOT NULL;
ALTER TABLE migao_propinas_liquidaciones ALTER COLUMN monto_efectivo SET DEFAULT 0;
ALTER TABLE migao_propinas_liquidaciones ALTER COLUMN monto_banco SET NOT NULL;
ALTER TABLE migao_propinas_liquidaciones ALTER COLUMN monto_banco SET DEFAULT 0;
-- metodo_pago queda en la tabla como columna vieja/informativa (liquidaciones
-- de antes de este cambio), pero ya no es obligatoria — un reparto nuevo no
-- la usa (queda NULL), la fuente de verdad pasa a ser monto_efectivo/monto_banco.
ALTER TABLE migao_propinas_liquidaciones ALTER COLUMN metodo_pago DROP NOT NULL;

ALTER TABLE migao_propinas_entregas ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(20) CHECK (metodo_pago IN ('efectivo','banco'));
-- Migra las entregas viejas: heredan el método de su liquidación.
UPDATE migao_propinas_entregas e
   SET metodo_pago = l.metodo_pago
  FROM migao_propinas_liquidaciones l
 WHERE e.liquidacion_id = l.id AND e.metodo_pago IS NULL AND l.metodo_pago IS NOT NULL;
-- Cualquier caso residual sin método heredable (no debería quedar ninguno,
-- pero por si acaso) cae en efectivo antes de exigir NOT NULL.
UPDATE migao_propinas_entregas SET metodo_pago = 'efectivo' WHERE metodo_pago IS NULL;
ALTER TABLE migao_propinas_entregas ALTER COLUMN metodo_pago SET NOT NULL;


-- ========================================================================
-- SECCIÓN 3: PERMISOS DE CON SENTIDO (productos/clientes/ventas)
-- ========================================================================
-- Antes de esto, Con Sentido no tenía permisos propios: cualquier usuario
-- autenticado podía llamar la API directamente. Se otorgan a Super Root y
-- Root — los únicos con acceso al módulo hoy (ver usuarios_modulos en seed.sql).
INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'con_sentido'), x.accion, x.codigo
FROM (VALUES
  ('ver_productos', 'con_sentido.productos.ver'),
  ('crear_producto', 'con_sentido.productos.crear'),
  ('editar_producto', 'con_sentido.productos.editar'),
  ('ver_clientes', 'con_sentido.clientes.ver'),
  ('crear_cliente', 'con_sentido.clientes.crear'),
  ('ver_ventas', 'con_sentido.ventas.ver'),
  ('crear_venta', 'con_sentido.ventas.crear')
) AS x(accion, codigo)
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = x.codigo);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Super Root', 'Root')
  AND p.codigo IN (
    'con_sentido.productos.ver', 'con_sentido.productos.crear', 'con_sentido.productos.editar',
    'con_sentido.clientes.ver', 'con_sentido.clientes.crear',
    'con_sentido.ventas.ver', 'con_sentido.ventas.crear'
  )
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);


-- ========================================================================
-- SECCIÓN 4: PLANO VISUAL DE MESAS POR ÁREA (Migao)
-- ========================================================================
-- ⚠️ NO ejecutar esta sección contra Supabase todavía — se está probando en
-- la rama feature/plano-mesas contra la base local. Queda preparada aquí
-- para cuando el usuario decida aplicarla a producción.
--
-- Posición/tamaño en % (0-100) del plano de su área, nullable: toda mesa
-- creada hoy vía el flujo "escribir el número a mano" (getOrCreateMesaPorNumero)
-- sigue funcionando igual, simplemente no aparece en ningún plano hasta que
-- Root la dibuje en el nuevo editor. `activo` permite "eliminar" una mesa sin
-- romper la FK de ordenes.mesa_id cuando ya tiene historial.
ALTER TABLE mesas ADD COLUMN IF NOT EXISTS pos_x  NUMERIC(5,2);
ALTER TABLE mesas ADD COLUMN IF NOT EXISTS pos_y  NUMERIC(5,2);
ALTER TABLE mesas ADD COLUMN IF NOT EXISTS ancho  NUMERIC(5,2);
ALTER TABLE mesas ADD COLUMN IF NOT EXISTS alto   NUMERIC(5,2);
ALTER TABLE mesas ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;

-- migao.mesas.ver: ver el plano (Mesero/Cajero, además de Root/Super Root que
-- ya reciben todos los permisos vía la consulta general de seed.sql).
-- migao.mesas.administrar: crear/mover/redimensionar/eliminar mesas — solo
-- Root/Super Root.
INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'migao'), x.accion, x.codigo
FROM (VALUES
  ('ver_mesas', 'migao.mesas.ver'),
  ('administrar_mesas', 'migao.mesas.administrar')
) AS x(accion, codigo)
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = x.codigo);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE (
    (r.nombre IN ('Super Root', 'Root') AND p.codigo IN ('migao.mesas.ver', 'migao.mesas.administrar'))
    OR (r.nombre IN ('Cajero', 'Mesero') AND p.codigo = 'migao.mesas.ver')
  )
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);


-- ========================================================================
-- SECCIÓN 5: PROPINA OPCIONAL AL COBRAR (Migao) + HISTORIAL APARTE
-- ========================================================================
-- Dinero del mesero/personal — NUNCA se mezcla con movimientos_caja/
-- turnos_caja (no cuenta para el cuadre de turno del cajero).
CREATE TABLE IF NOT EXISTS migao_propinas_liquidaciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metodo_pago VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo','banco')),
  monto       NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  nota        VARCHAR(200),
  usuario_id  UUID REFERENCES usuarios(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migao_propinas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id       UUID NOT NULL REFERENCES ordenes(id),
  venta_id       UUID NOT NULL REFERENCES ventas(id),
  mesero_id      UUID REFERENCES usuarios(id),
  usuario_id     UUID REFERENCES usuarios(id),
  monto          NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  porcentaje     NUMERIC(5,2),
  metodo_pago    VARCHAR(20) NOT NULL DEFAULT 'efectivo' CHECK (metodo_pago IN ('efectivo','banco')),
  liquidacion_id UUID REFERENCES migao_propinas_liquidaciones(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_migao_propinas_mesero ON migao_propinas(mesero_id);
CREATE INDEX IF NOT EXISTS idx_migao_propinas_fecha ON migao_propinas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_migao_propinas_liquidacion ON migao_propinas(liquidacion_id);

-- migao.propinas.ver: solo Root/Super Root ven el historial aparte de propinas.
INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'migao'), x.accion, x.codigo
FROM (VALUES
  ('ver_propinas', 'migao.propinas.ver')
) AS x(accion, codigo)
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = x.codigo);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Super Root', 'Root')
  AND p.codigo = 'migao.propinas.ver'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);


-- ========================================================================
-- SECCIÓN 6: EGRESO CONTRA EL ACUMULADO TOTAL HISTÓRICO (Caja General)
-- ========================================================================
-- ⚠️ NO ejecutar contra Supabase todavía — se está probando en local.
-- Vive completamente aparte de movimientos_caja/turnos_caja (que exigen un
-- turno_id) porque este egreso NO pertenece a ningún turno ni afecta su
-- cuadre — descuenta directo del acumulado histórico total del negocio.
CREATE TABLE IF NOT EXISTS caja_egresos_acumulado (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_gasto_id INT NOT NULL REFERENCES categorias_gasto(id),
  proveedor_id       UUID REFERENCES proveedores(id),
  monto              NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  metodo_pago        VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo','banco')),
  motivo             VARCHAR(200) NOT NULL,
  usuario_id         UUID NOT NULL REFERENCES usuarios(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- general.caja.registrar_egreso_acumulado: a diferencia del egreso normal,
-- NO se le da al Cajero — afecta el acumulado histórico del negocio, no su
-- turno del día. Ver el acumulado reusa el permiso ya existente general.caja.ver.
INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'general'), x.accion, x.codigo
FROM (VALUES
  ('registrar_egreso_acumulado', 'general.caja.registrar_egreso_acumulado')
) AS x(accion, codigo)
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = x.codigo);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Super Root', 'Root')
  AND p.codigo = 'general.caja.registrar_egreso_acumulado'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);


-- ========================================================================
-- SECCIÓN 7: FACTURA IMPRIMIBLE (Migao) + MÓDULO DE COTIZACIONES
-- ========================================================================
-- ⚠️ NO ejecutar contra Supabase todavía — se está probando en local.
-- La tabla `facturas` ya existe desde el schema original (nunca se había
-- usado); solo falta la secuencia de numeración. `migao_cotizaciones` vive
-- completamente aparte (no toca ordenes/ventas/inventario/caja) porque una
-- cotización es un presupuesto ANTES de que exista una venta real.
CREATE SEQUENCE IF NOT EXISTS facturas_numero_seq;
CREATE UNIQUE INDEX IF NOT EXISTS idx_facturas_venta_unica ON facturas(venta_id) WHERE venta_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS migao_cotizaciones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero           BIGINT GENERATED ALWAYS AS IDENTITY,
  cliente_nombre   VARCHAR(150),
  cliente_telefono VARCHAR(30),
  nota             VARCHAR(300),
  subtotal         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total            NUMERIC(12,2) NOT NULL DEFAULT 0,
  usuario_id       UUID REFERENCES usuarios(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migao_cotizacion_items (
  id              BIGSERIAL PRIMARY KEY,
  cotizacion_id   UUID NOT NULL REFERENCES migao_cotizaciones(id) ON DELETE CASCADE,
  nombre          VARCHAR(150) NOT NULL,
  cantidad        NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2) NOT NULL,
  subtotal        NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
);
CREATE INDEX IF NOT EXISTS idx_migao_cotizacion_items_cotizacion ON migao_cotizacion_items(cotizacion_id);

INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'migao'), x.accion, x.codigo
FROM (VALUES
  ('ver_cotizaciones',    'migao.cotizaciones.ver'),
  ('crear_cotizacion',    'migao.cotizaciones.crear'),
  ('eliminar_cotizacion', 'migao.cotizaciones.eliminar')
) AS x(accion, codigo)
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = x.codigo);

-- Cajero también las tiene (atiende clientes/cobra); Root/Super Root las
-- necesitan explícitas acá porque la regla de "todos los permisos" de
-- seed.sql solo corre en una base nueva, no en Supabase (ya seedeada).
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Cajero', 'Super Root', 'Root')
  AND p.codigo IN ('migao.cotizaciones.ver', 'migao.cotizaciones.crear', 'migao.cotizaciones.eliminar')
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);


-- ========================================================================
-- SECCIÓN 8: FACTURA TAMBIÉN PARA VENTAS DE CON SENTIDO
-- ========================================================================
-- ⚠️ NO ejecutar contra Supabase todavía — se está probando en local.
-- La factura no era solo de Migao: Con Sentido tiene su propio flujo de venta
-- (con_sentido_ventas/con_sentido_venta_items, tabla aparte de la `ventas`
-- compartida) y también necesita poder imprimir factura. Se agrega una
-- columna nueva en `facturas` en vez de forzar con_sentido_ventas.id dentro
-- de `venta_id` (esa columna tiene una FK real a `ventas`, no a
-- con_sentido_ventas — son tablas distintas). Comparte la misma
-- facturas_numero_seq de la SECCIÓN 7: un solo número de factura corriendo
-- para todo el negocio, sin importar de qué módulo venga la venta.
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS con_sentido_venta_id UUID REFERENCES con_sentido_ventas(id);

ALTER TABLE facturas DROP CONSTRAINT IF EXISTS facturas_check;
ALTER TABLE facturas ADD CONSTRAINT facturas_check
  CHECK (venta_id IS NOT NULL OR orden_id IS NOT NULL OR pedido_id IS NOT NULL OR con_sentido_venta_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_facturas_con_sentido_venta_unica
  ON facturas(con_sentido_venta_id) WHERE con_sentido_venta_id IS NOT NULL;


-- ========================================================================
-- SECCIÓN 9: CALCULADORA DE COSTOS DE VELAS (Con Sentido, Root/Super Root)
-- ========================================================================
-- ⚠️ NO ejecutar contra Supabase todavía — se está probando en local.
-- Tablas maestras editables + recetas — ver database/schema.sql sección
-- "5B. CALCULADORA DE COSTOS DE VELAS" para el detalle de cada columna.

CREATE TABLE IF NOT EXISTS velas_ceras (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          VARCHAR(80) NOT NULL,
  presentacion_kg NUMERIC(10,3) NOT NULL CHECK (presentacion_kg > 0),
  precio_compra   NUMERIC(12,2) NOT NULL CHECK (precio_compra > 0),
  valor_gramo     NUMERIC(12,4) GENERATED ALWAYS AS (precio_compra / presentacion_kg / 1000) STORED,
  proveedor       VARCHAR(120),
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS velas_fragancias (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         VARCHAR(80) NOT NULL,
  presentacion_g NUMERIC(10,2) NOT NULL DEFAULT 1000 CHECK (presentacion_g > 0),
  precio_compra  NUMERIC(12,2) NOT NULL CHECK (precio_compra > 0),
  valor_gramo    NUMERIC(12,4) GENERATED ALWAYS AS (precio_compra / presentacion_g) STORED,
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS velas_pabilos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  talla          VARCHAR(10) NOT NULL,
  longitud_m     NUMERIC(10,2) NOT NULL CHECK (longitud_m > 0),
  precio_carrete NUMERIC(12,2) NOT NULL CHECK (precio_carrete > 0),
  valor_cm       NUMERIC(12,4) GENERATED ALWAYS AS (precio_carrete / longitud_m / 100) STORED,
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS velas_insumos (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo               VARCHAR(30),
  nombre               VARCHAR(120) NOT NULL,
  categoria            VARCHAR(30) NOT NULL CHECK (categoria IN
                       ('recipiente','tapa','empaque','decoracion','identidad','papeleria','proteccion','otro')),
  unidad_costo         VARCHAR(10) NOT NULL CHECK (unidad_costo IN ('unidad','cm','g','hoja','metro')),
  valor_unitario       NUMERIC(12,2) NOT NULL CHECK (valor_unitario > 0),
  cantidad_por_paquete NUMERIC(10,2),
  precio_paquete       NUMERIC(12,2),
  proveedor            VARCHAR(120),
  activo               BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS velas_parametros (
  id                   BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  multiplicador_precio NUMERIC(6,2) NOT NULL DEFAULT 4,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO velas_parametros (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS velas_productos (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                  VARCHAR(150) NOT NULL,
  tipo_vela               VARCHAR(20) NOT NULL DEFAULT 'decorativa' CHECK (tipo_vela IN ('decorativa','vaso','wax_melt')),
  peso_mezcla_g           NUMERIC(10,2) NOT NULL CHECK (peso_mezcla_g > 0),
  pabilo_id               UUID REFERENCES velas_pabilos(id),
  cm_pabilo               NUMERIC(10,2),
  costo_mano_obra         NUMERIC(12,2) NOT NULL DEFAULT 0,
  multiplicador_precio    NUMERIC(6,2),
  redondeo                INT NOT NULL DEFAULT 100 CHECK (redondeo IN (0,100,500,1000)),
  precio_final_autorizado NUMERIC(12,2),
  notas                   VARCHAR(300),
  activo                  BOOLEAN NOT NULL DEFAULT true,
  usuario_id              UUID REFERENCES usuarios(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS velas_producto_ceras (
  producto_id UUID NOT NULL REFERENCES velas_productos(id) ON DELETE CASCADE,
  cera_id     UUID NOT NULL REFERENCES velas_ceras(id),
  gramos      NUMERIC(10,2) NOT NULL CHECK (gramos > 0),
  PRIMARY KEY (producto_id, cera_id)
);

CREATE TABLE IF NOT EXISTS velas_producto_fragancias (
  producto_id  UUID NOT NULL REFERENCES velas_productos(id) ON DELETE CASCADE,
  fragancia_id UUID NOT NULL REFERENCES velas_fragancias(id),
  porcentaje   NUMERIC(5,2) NOT NULL CHECK (porcentaje > 0),
  PRIMARY KEY (producto_id, fragancia_id)
);

CREATE TABLE IF NOT EXISTS velas_producto_insumos (
  producto_id UUID NOT NULL REFERENCES velas_productos(id) ON DELETE CASCADE,
  insumo_id   UUID NOT NULL REFERENCES velas_insumos(id),
  cantidad    NUMERIC(10,2) NOT NULL CHECK (cantidad > 0),
  PRIMARY KEY (producto_id, insumo_id)
);

-- Permisos: exclusivos de Root/Super Root (nunca se le dan a Cajero/Mesero/
-- Cocina/Administrador) — mismo criterio que migao.mesas.administrar.
INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'con_sentido'), x.accion, x.codigo
FROM (VALUES
  ('ver_velas',         'velas.ver'),
  ('administrar_velas', 'velas.administrar')
) AS x(accion, codigo)
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = x.codigo);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Super Root', 'Root')
  AND p.codigo IN ('velas.ver', 'velas.administrar')
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);

-- Datos confirmados del PDF de costos (valores de compra reales) — todo lo
-- que el PDF marcaba "PENDIENTE" (Verbena sin Fresh, Mango Tropical,
-- recipientes, tapas, bolsas, cintas, stickers, tarjetas, moños, mano de
-- obra, % merma/indirectos/margen) NO se precarga: se agrega desde el panel
-- cuando haya precio real, no hay que inventar valores.

INSERT INTO velas_ceras (nombre, presentacion_kg, precio_compra)
SELECT * FROM (VALUES
  ('Palma', 25, 420000),
  ('Arena', 25, 430000),
  ('Molde - compra por bulto', 15, 250000),
  ('Soya BPF', 25, 429000),
  ('Soya APF', 25, 429000),
  ('Parafina china', 50, 480000),
  ('Gel', 20, 400000),
  ('Coco', 20, 600000),
  ('Cera de vaso', 1, 20000),
  ('Cera de molde - compra minorista', 1, 18000)
) AS v(nombre, presentacion_kg, precio_compra)
WHERE NOT EXISTS (SELECT 1 FROM velas_ceras WHERE velas_ceras.nombre = v.nombre);

INSERT INTO velas_pabilos (talla, longitud_m, precio_carrete)
SELECT * FROM (VALUES
  ('S', 550, 385000),
  ('M', 515, 458350),
  ('L', 350, 350000)
) AS v(talla, longitud_m, precio_carrete)
WHERE NOT EXISTS (SELECT 1 FROM velas_pabilos WHERE velas_pabilos.talla = v.talla);

INSERT INTO velas_fragancias (nombre, precio_compra)
SELECT * FROM (VALUES
  ('Citrus Citrus', 130785),
  ('Lavandín', 137662),
  ('Eucalipto', 95675),
  ('Sándalo', 185225),
  ('Verbena Fresh', 174062),
  ('Vainilla Francesa', 144373),
  ('Peony White / Whitemusk', 191878),
  ('Café Cappuccino', 217024),
  ('Cereza Roja', 132791)
) AS v(nombre, precio_compra)
WHERE NOT EXISTS (SELECT 1 FROM velas_fragancias WHERE velas_fragancias.nombre = v.nombre);

-- Cajas de acetato redondas: precio ya es por unidad, sin paquete.
INSERT INTO velas_insumos (codigo, nombre, categoria, unidad_costo, valor_unitario, activo)
SELECT * FROM (VALUES
  ('ACR-01', 'Caja de acetato redonda 22 x 25 cm', 'empaque', 'unidad', 20000, true),
  ('ACR-02', 'Caja de acetato redonda 22 x 32 cm', 'empaque', 'unidad', 22000, true),
  ('ACR-03', 'Caja de acetato redonda 26 x 32 cm', 'empaque', 'unidad', 25000, true)
) AS v(codigo, nombre, categoria, unidad_costo, valor_unitario, activo)
WHERE NOT EXISTS (SELECT 1 FROM velas_insumos WHERE velas_insumos.codigo = v.codigo);

-- Cubos de acetato con cinta: costo unitario = precio del paquete ÷ cantidad
-- (ya viene calculado del PDF). Las dos marcadas "Revisar / tachada" quedan
-- inactivas hasta que se confirmen.
INSERT INTO velas_insumos (codigo, nombre, categoria, unidad_costo, valor_unitario, cantidad_por_paquete, precio_paquete, activo)
SELECT * FROM (VALUES
  ('ACC-7x7x11', 'Cubo de acetato con cinta 7 x 7 x 11 cm', 'empaque', 'unidad', 2000, 10, 20000, true),
  ('ACC-12x12x14', 'Cubo de acetato con cinta 12 x 12 x 14 cm', 'empaque', 'unidad', 3500, 12, 42000, true),
  ('ACC-12x12x17', 'Cubo de acetato con cinta 12 x 12 x 17 cm', 'empaque', 'unidad', 4000, 12, 48000, false),
  ('ACC-12x12x19', 'Cubo de acetato con cinta 12 x 12 x 19 cm', 'empaque', 'unidad', 4000, 12, 48000, true),
  ('ACC-15x15x17', 'Cubo de acetato con cinta 15 x 15 x 17 cm', 'empaque', 'unidad', 4000, 12, 48000, true),
  ('ACC-17x17x30', 'Cubo de acetato con cinta 17 x 17 x 30 cm', 'empaque', 'unidad', 7000, 12, 84000, true),
  ('ACC-20x20x25', 'Cubo de acetato con cinta 20 x 20 x 25 cm', 'empaque', 'unidad', 7000, 12, 84000, false),
  ('ACC-22x22x28', 'Cubo de acetato con cinta 22 x 22 x 28 cm', 'empaque', 'unidad', 7500, 12, 90000, true),
  ('ACC-28x28x36', 'Cubo de acetato con cinta 28 x 28 x 36 cm', 'empaque', 'unidad', 10000, 12, 120000, true),
  ('ACC-30x30x30', 'Cubo de acetato con cinta 30 x 30 x 30 cm', 'empaque', 'unidad', 12000, 12, 144000, true),
  ('ACC-30x30x40', 'Cubo de acetato con cinta 30 x 30 x 40 cm', 'empaque', 'unidad', 15000, 12, 180000, true)
) AS v(codigo, nombre, categoria, unidad_costo, valor_unitario, cantidad_por_paquete, precio_paquete, activo)
WHERE NOT EXISTS (SELECT 1 FROM velas_insumos WHERE velas_insumos.codigo = v.codigo);


-- ========================================================================
-- SECCIÓN 10: PAGOS PARCIALES + DIVIDIR CUENTA POR IGUAL/PRODUCTO (Migao)
-- ========================================================================
-- Antes, cerrar una cuenta era un solo paso atómico (100% de una vez, o
-- dividida pero pagada toda ya). Ahora una cuenta se puede repartir en
-- "partes" (1 sola si no se divide) y cada parte se puede pagar en varios
-- abonos a lo largo del tiempo — la orden queda en estado 'pagando' (ya
-- existía en el CHECK de ordenes.estado, nunca se había usado) hasta que
-- todas las partes quedan completamente pagadas.
CREATE TABLE IF NOT EXISTS migao_cuenta_partes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id     UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  indice       INT NOT NULL,
  modo         VARCHAR(20) NOT NULL CHECK (modo IN ('producto','igual')),
  monto_debido NUMERIC(12,2) NOT NULL CHECK (monto_debido > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venta_id, indice)
);

CREATE TABLE IF NOT EXISTS migao_cuenta_parte_unidades (
  parte_id      UUID NOT NULL REFERENCES migao_cuenta_partes(id) ON DELETE CASCADE,
  orden_item_id BIGINT NOT NULL REFERENCES orden_items(id),
  cantidad      NUMERIC(10,3) NOT NULL CHECK (cantidad > 0),
  PRIMARY KEY (parte_id, orden_item_id)
);

ALTER TABLE pagos ADD COLUMN IF NOT EXISTS parte_id UUID REFERENCES migao_cuenta_partes(id);
ALTER TABLE migao_propinas ADD COLUMN IF NOT EXISTS parte_id UUID REFERENCES migao_cuenta_partes(id);

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'usuario') THEN
    GRANT SELECT, INSERT ON migao_cuenta_partes TO usuario;
    GRANT SELECT, INSERT ON migao_cuenta_parte_unidades TO usuario;
  END IF;
END $$;


-- ========================================================================
-- SECCIÓN 11: INGRESO CON PRODUCTOS SUELTOS EN CAJA GENERAL (genera factura)
-- ========================================================================
-- "Registrar ingreso" ahora puede armarse con líneas libres (nombre+cantidad+
-- precio, modo "Agregar productos") en vez de un solo monto — igual que ya
-- hacía Cotizaciones. A diferencia de un ingreso manual de antes (un simple
-- comprobante en movimientos_caja), TODO ingreso registrado desde acá genera
-- su propia venta + factura con folio consecutivo (F-000123, mismo criterio
-- que Migao/Con Sentido), imprimible desde el historial.
CREATE TABLE IF NOT EXISTS caja_ingreso_items (
  id              BIGSERIAL PRIMARY KEY,
  venta_id        UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  nombre          VARCHAR(150) NOT NULL,
  cantidad        NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2) NOT NULL,
  subtotal        NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
);
CREATE INDEX IF NOT EXISTS idx_caja_ingreso_items_venta ON caja_ingreso_items(venta_id);

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'usuario') THEN
    GRANT SELECT, INSERT ON caja_ingreso_items TO usuario;
  END IF;
END $$;


-- ========================================================================
-- SECCIÓN 12: PAGAR PRODUCTOS SUELTOS DE UNA CUENTA ABIERTA (Migao)
-- ========================================================================
-- Cobra solo algunos productos de una mesa que sigue abierta (el mesero
-- puede seguir agregando productos nuevos mientras tanto) — cada cobro
-- parcial de productos genera su propia venta + factura independiente. NULL
-- = todavía no se ha cobrado; con valor, marca cuál venta ya lo pagó (ver
-- migao.service.ts::pagarItems).
ALTER TABLE orden_items ADD COLUMN IF NOT EXISTS venta_id UUID REFERENCES ventas(id);


-- ========================================================================
-- SECCIÓN 13: INSUMO MANUAL EN LA CALCULADORA DE VELAS
-- ========================================================================
-- Una línea de "Recipiente/empaque/accesorios" ahora puede ser insumo_id
-- (del catálogo) O nombre_manual+valor_unitario_manual (escrito a mano para
-- esa receta puntual, sin agregarlo al catálogo) — nunca los dos. Se agrega
-- una PK propia (id) porque insumo_id deja de poder ser NOT NULL, así que ya
-- no sirve como parte de la llave primaria compuesta de antes.
ALTER TABLE velas_producto_insumos ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
UPDATE velas_producto_insumos SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE velas_producto_insumos ALTER COLUMN id SET NOT NULL;
ALTER TABLE velas_producto_insumos DROP CONSTRAINT IF EXISTS velas_producto_insumos_pkey;
ALTER TABLE velas_producto_insumos ADD PRIMARY KEY (id);
ALTER TABLE velas_producto_insumos ALTER COLUMN insumo_id DROP NOT NULL;
ALTER TABLE velas_producto_insumos ADD COLUMN IF NOT EXISTS nombre_manual VARCHAR(120);
ALTER TABLE velas_producto_insumos ADD COLUMN IF NOT EXISTS valor_unitario_manual NUMERIC(12,2);
ALTER TABLE velas_producto_insumos DROP CONSTRAINT IF EXISTS velas_producto_insumos_manual_check;
ALTER TABLE velas_producto_insumos ADD CONSTRAINT velas_producto_insumos_manual_check CHECK (
  (insumo_id IS NOT NULL AND nombre_manual IS NULL AND valor_unitario_manual IS NULL) OR
  (insumo_id IS NULL AND nombre_manual IS NOT NULL AND valor_unitario_manual IS NOT NULL)
);
DROP INDEX IF EXISTS velas_producto_insumos_catalogo_uq;
CREATE UNIQUE INDEX velas_producto_insumos_catalogo_uq ON velas_producto_insumos (producto_id, insumo_id) WHERE insumo_id IS NOT NULL;

-- Tipo de vela nuevo "decorativa_8" (misma familia que "Decorativa", pero con
-- 8% de merma en vez de 6%) — se agrega al CHECK de tipo_vela.
ALTER TABLE velas_productos DROP CONSTRAINT IF EXISTS velas_productos_tipo_vela_check;
ALTER TABLE velas_productos ADD CONSTRAINT velas_productos_tipo_vela_check CHECK (tipo_vela IN ('decorativa','decorativa_8','vaso','wax_melt'));


-- ========================================================================
-- SECCIÓN 14: PONE AL DÍA velas_productos/velas_parametros AL MODELO ACTUAL
-- ========================================================================
-- El diseño original de Velas calculaba mano de obra como minutos × tarifa,
-- con % de merma/indirectos/margen objetivo global (velas_parametros) — se
-- rediseñó a un costo de mano de obra fijo por receta + un multiplicador de
-- precio simple, pero esa segunda versión nunca se puso al día en Supabase
-- (solo en la base local). Ambas tablas quedan como en schema.sql.
ALTER TABLE velas_parametros ADD COLUMN IF NOT EXISTS multiplicador_precio NUMERIC(6,2) NOT NULL DEFAULT 4;
ALTER TABLE velas_parametros DROP COLUMN IF EXISTS porcentaje_merma;
ALTER TABLE velas_parametros DROP COLUMN IF EXISTS valor_minuto_mano_obra;
ALTER TABLE velas_parametros DROP COLUMN IF EXISTS porcentaje_indirectos;
ALTER TABLE velas_parametros DROP COLUMN IF EXISTS margen_objetivo;

ALTER TABLE velas_productos ADD COLUMN IF NOT EXISTS tipo_vela VARCHAR(20) NOT NULL DEFAULT 'decorativa';
ALTER TABLE velas_productos ADD COLUMN IF NOT EXISTS costo_mano_obra NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE velas_productos ADD COLUMN IF NOT EXISTS multiplicador_precio NUMERIC(6,2);
ALTER TABLE velas_productos DROP COLUMN IF EXISTS minutos_mano_obra;
ALTER TABLE velas_productos DROP COLUMN IF EXISTS margen_objetivo;
ALTER TABLE velas_productos DROP CONSTRAINT IF EXISTS velas_productos_tipo_vela_check;
ALTER TABLE velas_productos ADD CONSTRAINT velas_productos_tipo_vela_check CHECK (tipo_vela IN ('decorativa','decorativa_8','vaso','wax_melt'));


-- ========================================================================
-- SECCIÓN 15: updated_at EN proveedores (faltaba, editar/eliminar fallaban)
-- ========================================================================
-- actualizarProveedor/desactivarProveedor siempre escribieron
-- "updated_at = now()" pero la tabla nunca tuvo esa columna — creaba
-- proveedores bien (el INSERT no la usa) pero editar o eliminar tiraba
-- error de servidor.
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();


-- ========================================================================
-- SECCIÓN 16: CATEGORÍAS EN INVENTARIO DE MIGAO
-- ========================================================================
-- Mismo patrón que categorias_producto (Menú) pero aparte, porque agrupan
-- cosas distintas (insumos crudos vs. productos vendibles del menú).
CREATE TABLE IF NOT EXISTS migao_inventario_categorias (
  id     SERIAL PRIMARY KEY,
  nombre VARCHAR(80) UNIQUE NOT NULL
);
ALTER TABLE migao_inventario_productos ADD COLUMN IF NOT EXISTS categoria_id INT REFERENCES migao_inventario_categorias(id);


-- ========================================================================
-- SECCIÓN 17: EDITAR/AJUSTAR INVENTARIO PASA A SER SOLO ROOT/SUPER ROOT
-- ========================================================================
-- Cocina conserva migao.inventario.administrar (crear producto nuevo +
-- registrar ENTRADA de stock, su trabajo diario) pero editar un producto ya
-- creado, eliminarlo o hacer un AJUSTE manual de conteo pasa a requerir este
-- permiso nuevo, que Cocina no tiene — no hace falta tocar su permiso
-- existente para nada, ver inventario.service.ts/inventario.routes.ts.
INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'migao'), x.accion, x.codigo
FROM (VALUES
  ('editar_producto_inventario', 'migao.inventario.editar_producto')
) AS x(accion, codigo)
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = x.codigo);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Super Root', 'Root')
  AND p.codigo = 'migao.inventario.editar_producto'
  AND NOT EXISTS (
    SELECT 1 FROM roles_permisos rp
    WHERE rp.rol_id = r.id AND rp.permiso_id = p.id
  );


-- ========================================================================
-- SECCIÓN 18: NOMBRE LIBRE DE LA CUENTA EN ordenes
-- ========================================================================
-- Etiqueta libre para identificar la cuenta a simple vista (ej. "Cumpleaños
-- de Juan"), editable únicamente desde "cambiar mesa" — a propósito NO es
-- cliente_id (eso es un cliente real reutilizable entre módulos). Mismo
-- criterio que migao_cotizaciones.cliente_nombre (texto libre, sin FK).
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS nombre VARCHAR(120);


-- ========================================================================
-- ⚠️ SEGURIDAD: DATOS NO SE TOCAN
-- ========================================================================
-- ❌ NO ejecutar INSERT/UPDATE/DELETE en tablas con datos reales
-- ❌ NO borrar datos existentes (mesas, productos, usuarios, órdenes)
-- ✅ SOLO: ALTER TABLE, CREATE INDEX, CREATE FUNCTION, CREATE TRIGGER
-- ✅ SOLO: Cambios de funcionalidad que no afecten datos

-- ========================================================================
-- FIN - Scripts de Producción
-- ========================================================================
