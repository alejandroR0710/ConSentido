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
-- ⚠️ SEGURIDAD: DATOS NO SE TOCAN
-- ========================================================================
-- ❌ NO ejecutar INSERT/UPDATE/DELETE en tablas con datos reales
-- ❌ NO borrar datos existentes (mesas, productos, usuarios, órdenes)
-- ✅ SOLO: ALTER TABLE, CREATE INDEX, CREATE FUNCTION, CREATE TRIGGER
-- ✅ SOLO: Cambios de funcionalidad que no afecten datos

-- ========================================================================
-- FIN - Scripts de Producción
-- ========================================================================
