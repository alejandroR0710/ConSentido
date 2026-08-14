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
-- SECCIÓN 2C: AMASIJOS Y BASES DE MIGAO (Inventario de preparación)
-- ========================================================================
-- Tipos de amasijos completos (se compran y se pueden vender completos)
CREATE TABLE IF NOT EXISTS migao_amasijo_tipos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inventario de amasijos completos
CREATE TABLE IF NOT EXISTS migao_amasijos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amasijo_tipo_id INT NOT NULL REFERENCES migao_amasijo_tipos(id),
  cantidad_completa NUMERIC(12,3) NOT NULL DEFAULT 0,
  cantidad_media NUMERIC(12,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Movimientos de amasijos (entrada/consumo/venta)
CREATE TABLE IF NOT EXISTS migao_amasijos_movimientos (
  id BIGSERIAL PRIMARY KEY,
  amasijo_id UUID NOT NULL REFERENCES migao_amasijos(id),
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('entrada', 'consumo', 'venta_completo', 'venta_medio', 'ajuste')),
  cantidad_completa NUMERIC(12,3) NOT NULL DEFAULT 0,
  cantidad_media NUMERIC(12,3) NOT NULL DEFAULT 0,
  motivo TEXT,
  usuario_id UUID REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tipos de bases preparadas (Migao de la Casa, Ayuno, Boyacense, Migadito)
CREATE TABLE IF NOT EXISTS migao_base_tipos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Receta de cada base (qué amasijos se usan y cuánto)
CREATE TABLE IF NOT EXISTS migao_base_recetas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_tipo_id INT NOT NULL REFERENCES migao_base_tipos(id) ON DELETE CASCADE,
  amasijo_tipo_id INT NOT NULL REFERENCES migao_amasijo_tipos(id) ON DELETE CASCADE,
  cantidad_amasijo NUMERIC(12,3) NOT NULL CHECK (cantidad_amasijo > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(base_tipo_id, amasijo_tipo_id)
);

-- Inventario de bases preparadas
CREATE TABLE IF NOT EXISTS migao_bases_preparadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_tipo_id INT NOT NULL REFERENCES migao_base_tipos(id),
  cantidad_preparada NUMERIC(12,3) NOT NULL DEFAULT 0,
  cantidad_vendida NUMERIC(12,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Movimientos de bases preparadas (preparación/venta)
CREATE TABLE IF NOT EXISTS migao_bases_movimientos (
  id BIGSERIAL PRIMARY KEY,
  base_id UUID NOT NULL REFERENCES migao_bases_preparadas(id),
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('preparacion', 'venta', 'ajuste')),
  cantidad NUMERIC(12,3) NOT NULL,
  motivo TEXT,
  usuario_id UUID REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_migao_amasijos_tipo ON migao_amasijos(amasijo_tipo_id);
CREATE INDEX IF NOT EXISTS idx_migao_amasijos_movimientos_amasijo ON migao_amasijos_movimientos(amasijo_id);
CREATE INDEX IF NOT EXISTS idx_migao_amasijos_movimientos_fecha ON migao_amasijos_movimientos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_migao_base_recetas_tipo ON migao_base_recetas(base_tipo_id);
CREATE INDEX IF NOT EXISTS idx_migao_bases_preparadas_tipo ON migao_bases_preparadas(base_tipo_id);
CREATE INDEX IF NOT EXISTS idx_migao_bases_movimientos_base ON migao_bases_movimientos(base_id);
CREATE INDEX IF NOT EXISTS idx_migao_bases_movimientos_fecha ON migao_bases_movimientos(created_at DESC);

-- Triggers para updated_at
DROP TRIGGER IF EXISTS update_migao_amasijos_updated_at ON migao_amasijos;
CREATE TRIGGER update_migao_amasijos_updated_at
BEFORE UPDATE ON migao_amasijos
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS update_migao_bases_preparadas_updated_at ON migao_bases_preparadas;
CREATE TRIGGER update_migao_bases_preparadas_updated_at
BEFORE UPDATE ON migao_bases_preparadas
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Insertar tipos de amasijos
INSERT INTO migao_amasijo_tipos (nombre) VALUES
('Almojábana'),
('Pan de yuca'),
('Buñuelo'),
('Pan de bono'),
('Arepa boyacense'),
('Arepa garulla')
ON CONFLICT (nombre) DO NOTHING;

-- Insertar tipos de bases
INSERT INTO migao_base_tipos (nombre) VALUES
('Migao de la Casa'),
('Migao Ayuno'),
('Migao Boyacense'),
('Migadito')
ON CONFLICT (nombre) DO NOTHING;

-- Insertar recetas
INSERT INTO migao_base_recetas (base_tipo_id, amasijo_tipo_id, cantidad_amasijo)
SELECT b.id, a.id, cantidad
FROM (
  VALUES
    ('Migao de la Casa', 'Almojábana', 0.5),
    ('Migao de la Casa', 'Pan de yuca', 0.5),
    ('Migao de la Casa', 'Buñuelo', 0.5),
    ('Migao Ayuno', 'Pan de yuca', 0.5),
    ('Migao Ayuno', 'Pan de bono', 0.5),
    ('Migao Ayuno', 'Arepa garulla', 0.5),
    ('Migao Boyacense', 'Almojábana', 0.5),
    ('Migao Boyacense', 'Arepa boyacense', 0.5),
    ('Migao Boyacense', 'Arepa garulla', 0.5),
    ('Migadito', 'Almojábana', 0.5)
) AS recetas(base_nombre, amasijo_nombre, cantidad)
JOIN migao_base_tipos b ON b.nombre = recetas.base_nombre
JOIN migao_amasijo_tipos a ON a.nombre = recetas.amasijo_nombre
WHERE NOT EXISTS (
  SELECT 1 FROM migao_base_recetas
  WHERE base_tipo_id = b.id AND amasijo_tipo_id = a.id
);

-- Inicializar inventario de bases
INSERT INTO migao_bases_preparadas (base_tipo_id, cantidad_preparada, cantidad_vendida)
SELECT id, 0, 0 FROM migao_base_tipos
WHERE NOT EXISTS (
  SELECT 1 FROM migao_bases_preparadas
  WHERE base_tipo_id = migao_base_tipos.id
);

-- Permisos de amasijos/bases
GRANT SELECT, INSERT, UPDATE ON migao_amasijo_tipos TO usuario;
GRANT SELECT, INSERT, UPDATE ON migao_amasijos TO usuario;
GRANT SELECT, INSERT ON migao_amasijos_movimientos TO usuario;
GRANT SELECT, INSERT, UPDATE ON migao_base_tipos TO usuario;
GRANT SELECT, INSERT, UPDATE, DELETE ON migao_base_recetas TO usuario;
GRANT SELECT, INSERT, UPDATE ON migao_bases_preparadas TO usuario;
GRANT SELECT, INSERT ON migao_bases_movimientos TO usuario;
GRANT USAGE, SELECT ON SEQUENCE migao_amasijos_movimientos_id_seq TO usuario;
GRANT USAGE, SELECT ON SEQUENCE migao_bases_movimientos_id_seq TO usuario;

-- Permisos de amasijos en RBAC
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
-- ⚠️ SEGURIDAD: DATOS NO SE TOCAN
-- ========================================================================
-- ❌ NO ejecutar INSERT/UPDATE/DELETE en tablas con datos reales
-- ❌ NO borrar datos existentes (mesas, productos, usuarios, órdenes)
-- ✅ SOLO: ALTER TABLE, CREATE INDEX, CREATE FUNCTION, CREATE TRIGGER
-- ✅ SOLO: Cambios de funcionalidad que no afecten datos

-- ========================================================================
-- FIN - Scripts de Producción
-- ========================================================================
