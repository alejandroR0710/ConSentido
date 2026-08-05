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
-- ⚠️ SEGURIDAD: DATOS NO SE TOCAN
-- ========================================================================
-- ❌ NO ejecutar INSERT/UPDATE/DELETE en tablas con datos reales
-- ❌ NO borrar datos existentes (mesas, productos, usuarios, órdenes)
-- ✅ SOLO: ALTER TABLE, CREATE INDEX, CREATE FUNCTION, CREATE TRIGGER
-- ✅ SOLO: Cambios de funcionalidad que no afecten datos

-- ========================================================================
-- FIN - Scripts de Producción
-- ========================================================================
