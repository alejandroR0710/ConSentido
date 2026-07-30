-- ========================================================================
-- SCRIPTS DE PRODUCCIÓN - Ejecutar en LOCAL y SUPABASE
-- ========================================================================
-- ⚠️ IMPORTANTE: SOLO CAMBIOS DE FUNCIONALIDAD/MEJORAS
-- ❌ NUNCA tocar datos existentes
-- ========================================================================
-- Última actualización: 2026-07-29
-- Descripción: Nuevas funcionalidades y mejoras (schema, índices, funciones)
-- ========================================================================

-- ========================================================================
-- SECCIÓN 1: CAMBIOS DE SCHEMA (Nuevas tablas, columnas, índices)
-- ========================================================================

-- ========================================================================
-- TABLA: con_sentido_ventas (Historial de ventas Con Sentido)
-- ========================================================================
-- Almacena el historial completo de ventas del módulo Con Sentido
-- Estructura: información de venta + items desglosados
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

-- Índices para optimizar búsquedas
CREATE INDEX IF NOT EXISTS idx_con_sentido_ventas_fecha ON con_sentido_ventas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_con_sentido_ventas_usuario ON con_sentido_ventas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_con_sentido_venta_items_venta ON con_sentido_venta_items(venta_id);

-- Trigger para actualizar updated_at
DROP TRIGGER IF EXISTS update_con_sentido_ventas_updated_at ON con_sentido_ventas;
CREATE TRIGGER update_con_sentido_ventas_updated_at
BEFORE UPDATE ON con_sentido_ventas
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();


-- ========================================================================
-- SECCIÓN 1B: PERMISOS (Acceso a usuario del backend)
-- ========================================================================
-- Permisos necesarios para que el backend acceda a las tablas de Con Sentido
-- ⚠️ SOLO ejecutar si el rol "usuario" existe en tu base de datos
-- DO $$ BEGIN
--   IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'usuario') THEN
--     GRANT SELECT, INSERT, UPDATE, DELETE ON con_sentido_ventas TO usuario;
--     GRANT SELECT, INSERT, UPDATE, DELETE ON con_sentido_venta_items TO usuario;
--     GRANT USAGE, SELECT ON SEQUENCE con_sentido_venta_items_id_seq TO usuario;
--   END IF;
-- END $$;


-- ========================================================================
-- SECCIÓN 2: CATEGORÍAS DE GASTO (Solo crear si NO EXISTEN)
-- ========================================================================
-- ⚠️ Usar ON CONFLICT para NO modificar categorías existentes
INSERT INTO categorias_gasto (nombre, activo) VALUES
('Servicios', true),
('Mantenimiento', true),
('Suministros', true),
('Otros', true)
ON CONFLICT (nombre) DO NOTHING;


-- ========================================================================
-- SECCIÓN 2B: ACTUALIZACIÓN DE SCHEMA (Cambios a tablas existentes)
-- ========================================================================
-- Con Sentido ahora guarda en movimientos_caja en lugar de con_sentido_ventas
-- Por lo tanto, remover la FK que requería con_sentido_ventas
ALTER TABLE con_sentido_venta_items DROP CONSTRAINT IF EXISTS con_sentido_venta_items_venta_id_fkey;

-- Cambiar el tipo de venta_id para que sea BIGINT (referencia directa a movimientos_caja.id)
ALTER TABLE con_sentido_venta_items ALTER COLUMN venta_id TYPE BIGINT USING venta_id::text::BIGINT;

-- Permitir NULL en usuario_id de movimientos_caja (no siempre hay usuario autenticado)
ALTER TABLE movimientos_caja ALTER COLUMN usuario_id DROP NOT NULL;


-- ========================================================================
-- SECCIÓN 3: FUNCIONES Y TRIGGERS (Nuevos o mejoras)
-- ========================================================================
-- [AGREGAR AQUÍ nuevas funciones o triggers que sean necesarios]


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
