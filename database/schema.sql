-- ============================================================================
-- SIsteMAPOS - Esquema de Base de Datos (Fase 3)
-- PostgreSQL 14+
-- Núcleo transversal: usuarios, clientes, insumos/inventario, auditoría.
-- Módulos operativos: Insumos, Talleres, Con Sentido, Migao (POS), Pedidos.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 1. MODULO GENERAL TRANSVERSAL
-- ============================================================================

CREATE TABLE modulos (
  id     SMALLSERIAL PRIMARY KEY,
  slug   VARCHAR(40) UNIQUE NOT NULL,   -- insumos, talleres, con_sentido, migao, pedidos, general
  nombre VARCHAR(80) NOT NULL
);

CREATE TABLE roles (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(60) UNIQUE NOT NULL,
  descripcion TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permisos (
  id        SERIAL PRIMARY KEY,
  modulo_id SMALLINT NOT NULL REFERENCES modulos(id),
  accion    VARCHAR(60) NOT NULL,        -- crear, editar, eliminar, ver, cerrar_caja...
  codigo    VARCHAR(120) UNIQUE NOT NULL -- ej: insumos.movimientos.crear
);

CREATE TABLE roles_permisos (
  rol_id     INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permiso_id INT NOT NULL REFERENCES permisos(id) ON DELETE CASCADE,
  PRIMARY KEY (rol_id, permiso_id)
);

CREATE TABLE usuarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        VARCHAR(120) NOT NULL,
  email         VARCHAR(160) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rol_id        INT NOT NULL REFERENCES roles(id),
  activo        BOOLEAN NOT NULL DEFAULT true,
  ultimo_login  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_usuarios_rol ON usuarios(rol_id);
CREATE TRIGGER trg_usuarios_updated BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Acceso granular a módulos además del rol (permite, ej., un cajero que también ve Pedidos)
CREATE TABLE usuarios_modulos (
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo_id  SMALLINT NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, modulo_id)
);

CREATE TABLE auditoria (
  id         BIGSERIAL PRIMARY KEY,
  usuario_id UUID REFERENCES usuarios(id),
  modulo_id  SMALLINT REFERENCES modulos(id),
  accion     VARCHAR(60) NOT NULL,   -- crear, actualizar, eliminar, login...
  entidad    VARCHAR(80) NOT NULL,   -- tabla/entidad afectada
  entidad_id VARCHAR(64),            -- soporta uuid o bigint como texto
  detalle    JSONB,
  ip         VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auditoria_entidad ON auditoria(entidad, entidad_id);
CREATE INDEX idx_auditoria_fecha ON auditoria(created_at);
-- Nota de escalabilidad: cuando el volumen crezca, convertir a tabla particionada
-- por rango mensual de created_at (PARTITION BY RANGE) sin cambiar el modelo lógico.

CREATE TABLE alertas (
  id         BIGSERIAL PRIMARY KEY,
  tipo       VARCHAR(40) NOT NULL, -- stock_minimo, pedido_vencido, tarea, evento
  modulo_id  SMALLINT REFERENCES modulos(id),
  entidad    VARCHAR(80),
  entidad_id VARCHAR(64),
  mensaje    TEXT NOT NULL,
  severidad  VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (severidad IN ('info','advertencia','critica')),
  leida      BOOLEAN NOT NULL DEFAULT false,
  usuario_id UUID REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alertas_usuario_leida ON alertas(usuario_id, leida);

-- Caja general: el cajero centraliza los pagos de cualquier módulo y los retiros
-- por gasto interno, organizados en turnos (apertura/cierre) para poder cuadrar
-- el efectivo físico contra lo registrado. El ingreso es diario: cada turno nuevo
-- hereda los saldos del último turno cerrado (sin importar qué cajero lo abrió),
-- por eso solo puede existir UN turno abierto a la vez para todo el negocio.
--
-- Se llevan DOS cuentas independientes por método de pago (efectivo y banco:
-- tarjeta/transferencia colapsan en "banco" al entrar a caja), cada una con su
-- propia suma/resta, más el total general que es la suma de ambas. El conteo
-- físico de cierre (monto_final_declarado / diferencia) solo aplica a efectivo,
-- porque banco es un registro electrónico sin billetes que contar.

CREATE TABLE categorias_gasto (
  id     SERIAL PRIMARY KEY,
  nombre VARCHAR(80) UNIQUE NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE turnos_caja (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cajero_id                       UUID NOT NULL REFERENCES usuarios(id),
  monto_inicial_efectivo          NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_inicial_banco             NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_final_declarado_efectivo  NUMERIC(12,2), -- conteo físico del cajero al cerrar
  monto_final_calculado_efectivo  NUMERIC(12,2), -- inicial_efectivo + ingresos_efectivo - egresos_efectivo
  diferencia_efectivo             NUMERIC(12,2), -- declarado - calculado (faltante/sobrante físico)
  monto_final_calculado_banco     NUMERIC(12,2), -- inicial_banco + ingresos_banco - egresos_banco (sin conteo físico)
  estado                          VARCHAR(20) NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
  abierto_en                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_en                      TIMESTAMPTZ,
  CHECK (estado = 'abierto' OR cerrado_en IS NOT NULL)
);
CREATE INDEX idx_turnos_caja_cajero ON turnos_caja(cajero_id, estado);
-- Solo puede existir un turno abierto a la vez (caja única del negocio, no por cajero)
CREATE UNIQUE INDEX uq_turno_abierto_global ON turnos_caja(estado) WHERE estado = 'abierto';

CREATE TABLE movimientos_caja (
  id                 BIGSERIAL PRIMARY KEY,
  turno_id           UUID NOT NULL REFERENCES turnos_caja(id),
  tipo               VARCHAR(20) NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
  modulo_origen_id   SMALLINT REFERENCES modulos(id), -- de qué área viene el pago (solo ingresos)
  categoria_gasto_id INT REFERENCES categorias_gasto(id), -- solo egresos
  referencia_entidad VARCHAR(80), -- ej: 'ventas', 'pagos', 'pedido_abonos', 'actividad_cierres'
  referencia_id      VARCHAR(64),
  monto              NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  -- Si se aplicó descuento, estas dos quedan pobladas (si no, NULL): `monto`
  -- ya es el valor real cobrado/sumado, estas son solo para mostrar el
  -- detalle en los historiales de Caja (sin descuento + % aplicado).
  monto_sin_descuento NUMERIC(12,2),
  descuento_porcentaje NUMERIC(5,2),
  metodo_pago        VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo', 'banco')),
  motivo             VARCHAR(200),
  usuario_id         UUID NOT NULL REFERENCES usuarios(id), -- quien registra/retira
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tipo = 'ingreso' OR categoria_gasto_id IS NOT NULL)
);
CREATE INDEX idx_movimientos_caja_turno ON movimientos_caja(turno_id, created_at);
CREATE INDEX idx_movimientos_caja_referencia ON movimientos_caja(referencia_entidad, referencia_id);

-- ============================================================================
-- 2. CLIENTES (entidad compartida entre Con Sentido, Migao, Talleres, Pedidos)
-- ============================================================================

CREATE TABLE clientes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre              VARCHAR(150) NOT NULL,
  telefono            VARCHAR(30),
  email               VARCHAR(160),
  direccion           TEXT,
  documento_identidad VARCHAR(40),
  notas               TEXT,
  activo              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clientes_telefono ON clientes(telefono);
CREATE INDEX idx_clientes_email ON clientes(email);
CREATE TRIGGER trg_clientes_updated BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 3. INSUMOS (inventario unificado que alimenta a los demás módulos)
-- ============================================================================

CREATE TABLE categorias_insumo (
  id     SERIAL PRIMARY KEY,
  nombre VARCHAR(80) UNIQUE NOT NULL
);

CREATE TABLE proveedores (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     VARCHAR(150) NOT NULL,
  contacto   VARCHAR(120),
  telefono   VARCHAR(30),
  email      VARCHAR(160),
  activo     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE almacenes (
  id        SERIAL PRIMARY KEY,
  nombre    VARCHAR(100) NOT NULL,
  modulo_id SMALLINT REFERENCES modulos(id), -- almacén asociado a un área (opcional)
  ubicacion VARCHAR(150),
  activo    BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE insumos (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                 VARCHAR(150) NOT NULL,
  categoria_id           INT REFERENCES categorias_insumo(id),
  unidad_medida          VARCHAR(20) NOT NULL, -- kg, lt, unidad...
  stock_minimo           NUMERIC(12,3) NOT NULL DEFAULT 0,
  costo_unitario         NUMERIC(12,2) NOT NULL DEFAULT 0,
  proveedor_principal_id UUID REFERENCES proveedores(id),
  imagen_url             TEXT,
  descripcion            TEXT,
  activo                 BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_insumos_categoria ON insumos(categoria_id);
CREATE TRIGGER trg_insumos_updated BEFORE UPDATE ON insumos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE inventario_insumos (
  id              BIGSERIAL PRIMARY KEY,
  insumo_id       UUID NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
  almacen_id      INT NOT NULL REFERENCES almacenes(id),
  cantidad_actual NUMERIC(14,3) NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (insumo_id, almacen_id)
);

-- Tabla puente: TODOS los módulos escriben aquí cuando consumen o reciben insumos.
CREATE TABLE movimientos_insumo (
  id                BIGSERIAL PRIMARY KEY,
  insumo_id         UUID NOT NULL REFERENCES insumos(id),
  almacen_id        INT NOT NULL REFERENCES almacenes(id),
  tipo              VARCHAR(20) NOT NULL CHECK (tipo IN ('entrada','salida','transferencia','ajuste')),
  cantidad          NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
  costo_unitario    NUMERIC(12,2),
  motivo            VARCHAR(150),
  modulo_origen_id  SMALLINT REFERENCES modulos(id),  -- área que generó el movimiento
  referencia_entidad VARCHAR(80),  -- ej: 'actividad_materiales', 'orden_items', 'pedido_items'
  referencia_id     VARCHAR(64),   -- id de la entidad origen
  almacen_destino_id INT REFERENCES almacenes(id), -- solo transferencias
  proveedor_id      UUID REFERENCES proveedores(id), -- solo entradas por compra
  usuario_id        UUID REFERENCES usuarios(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mov_insumo_insumo ON movimientos_insumo(insumo_id, created_at);
CREATE INDEX idx_mov_insumo_referencia ON movimientos_insumo(referencia_entidad, referencia_id);

-- ============================================================================
-- 4. TALLERES / EXPERIENCIAS
-- ============================================================================

CREATE TABLE actividades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          VARCHAR(150) NOT NULL,
  descripcion     TEXT,
  fecha           TIMESTAMPTZ NOT NULL,
  capacidad       INT NOT NULL,
  precio          NUMERIC(12,2) NOT NULL DEFAULT 0,
  costo_estimado  NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado          VARCHAR(20) NOT NULL DEFAULT 'programada'
                  CHECK (estado IN ('programada','en_curso','cerrada','cancelada')),
  responsable_id  UUID REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_actividades_fecha ON actividades(fecha);
CREATE TRIGGER trg_actividades_updated BEFORE UPDATE ON actividades
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE reservas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actividad_id      UUID NOT NULL REFERENCES actividades(id) ON DELETE CASCADE,
  cliente_id        UUID REFERENCES clientes(id),
  cantidad_personas INT NOT NULL DEFAULT 1,
  estado            VARCHAR(20) NOT NULL DEFAULT 'confirmada'
                    CHECK (estado IN ('pendiente','confirmada','cancelada','asistio','no_asistio')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reservas_actividad ON reservas(actividad_id);

CREATE TABLE asistentes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reserva_id UUID NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
  nombre     VARCHAR(150) NOT NULL,
  telefono   VARCHAR(30),
  email      VARCHAR(160)
);

CREATE TABLE actividad_materiales (
  id                BIGSERIAL PRIMARY KEY,
  actividad_id      UUID NOT NULL REFERENCES actividades(id) ON DELETE CASCADE,
  insumo_id         UUID NOT NULL REFERENCES insumos(id),
  cantidad_planeada NUMERIC(12,3) NOT NULL DEFAULT 0,
  cantidad_real     NUMERIC(12,3)
);

CREATE TABLE actividad_cierres (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actividad_id    UUID NOT NULL UNIQUE REFERENCES actividades(id) ON DELETE CASCADE,
  ingresos        NUMERIC(12,2) NOT NULL DEFAULT 0,
  costo_materiales NUMERIC(12,2) NOT NULL DEFAULT 0,
  costo_otros     NUMERIC(12,2) NOT NULL DEFAULT 0,
  rentabilidad    NUMERIC(12,2) GENERATED ALWAYS AS (ingresos - costo_materiales - costo_otros) STORED,
  cerrado_por     UUID REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5. CON SENTIDO (catálogo, inventario de producto terminado, ventas)
-- ============================================================================

CREATE TABLE categorias_producto (
  id     SERIAL PRIMARY KEY,
  nombre VARCHAR(80) UNIQUE NOT NULL
);

-- productos es compartido entre Con Sentido y Migao (columna modulo_id distingue el origen)
CREATE TABLE productos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        VARCHAR(150) NOT NULL,
  categoria_id  INT REFERENCES categorias_producto(id),
  modulo_id     SMALLINT NOT NULL REFERENCES modulos(id),
  precio        NUMERIC(12,2) NOT NULL DEFAULT 0,
  costo         NUMERIC(12,2) NOT NULL DEFAULT 0,
  unidad_medida VARCHAR(20) NOT NULL DEFAULT 'unidad',
  imagen_url    TEXT,
  descripcion   TEXT,
  activo        BOOLEAN NOT NULL DEFAULT true,
  -- Cargo de "para llevar" (ej. envases): se agrega a una orden como un ítem
  -- más, pero se resalta en cobro para no confundirlo con el consumo normal.
  es_para_llevar BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_productos_modulo ON productos(modulo_id);
CREATE TRIGGER trg_productos_updated BEFORE UPDATE ON productos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE inventario_productos (
  id              BIGSERIAL PRIMARY KEY,
  producto_id     UUID NOT NULL UNIQUE REFERENCES productos(id) ON DELETE CASCADE,
  cantidad_actual NUMERIC(14,3) NOT NULL DEFAULT 0,
  stock_minimo    NUMERIC(12,3) NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE promociones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id  UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  tipo         VARCHAR(20) NOT NULL CHECK (tipo IN ('porcentaje','monto_fijo')),
  valor        NUMERIC(12,2) NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin    DATE NOT NULL,
  activo       BOOLEAN NOT NULL DEFAULT true,
  CHECK (fecha_fin >= fecha_inicio)
);

-- ventas es compartida entre Con Sentido (venta directa) y Migao (cierre de orden)
CREATE TABLE ventas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo_id   SMALLINT NOT NULL REFERENCES modulos(id),
  cliente_id  UUID REFERENCES clientes(id),
  usuario_id  UUID REFERENCES usuarios(id),
  orden_id    UUID, -- FK diferida: se agrega tras crear la tabla ordenes (sección Migao)
  subtotal    NUMERIC(12,2) NOT NULL DEFAULT 0,
  descuento   NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- % de descuento aplicado (informativo, para mostrar en el historial junto
  -- al monto ya calculado en `descuento`); `total` siempre es el valor real cobrado.
  descuento_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 0,
  impuestos   NUMERIC(12,2) NOT NULL DEFAULT 0,
  total       NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado      VARCHAR(20) NOT NULL DEFAULT 'completada' CHECK (estado IN ('completada','anulada')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ventas_modulo_fecha ON ventas(modulo_id, created_at);
CREATE INDEX idx_ventas_cliente ON ventas(cliente_id);

CREATE TABLE venta_items (
  id              BIGSERIAL PRIMARY KEY,
  venta_id        UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  cantidad        NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2) NOT NULL,
  subtotal        NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
);
CREATE INDEX idx_venta_items_venta ON venta_items(venta_id);

-- ============================================================================
-- 6. MIGAO (POS / Cafetería)
-- ============================================================================

CREATE TABLE zonas (
  id     SERIAL PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL
);

CREATE TABLE mesas (
  id        SERIAL PRIMARY KEY,
  zona_id   INT REFERENCES zonas(id),
  numero    VARCHAR(10) NOT NULL,
  piso      SMALLINT NOT NULL DEFAULT 1,
  capacidad INT NOT NULL DEFAULT 4,
  estado    VARCHAR(20) NOT NULL DEFAULT 'libre'
            CHECK (estado IN ('libre','ocupada','reservada','en_limpieza')),
  UNIQUE (zona_id, numero, piso)
);
-- Permite "get or create" por número (y piso) sin depender de una zona: el mesero
-- solo escribe el número de mesa y el piso, y si no existe, se crea sola (flujo
-- rápido, sin configuración previa de mesas/zonas). El mismo número de mesa puede
-- repetirse en pisos distintos (son mesas físicas distintas).
CREATE UNIQUE INDEX uq_mesas_numero_piso_sin_zona ON mesas(numero, piso) WHERE zona_id IS NULL;

-- Etiqueta "Comensal N" autoincremental, asignada por el propio DEFAULT de la
-- columna (nextval de la secuencia): cada orden nueva recibe el siguiente número
-- sin que el backend tenga que calcularlo ni haya condición de carrera.
CREATE SEQUENCE comensal_seq;

CREATE TABLE ordenes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mesa_id         INT REFERENCES mesas(id),
  mesero_id       UUID REFERENCES usuarios(id),
  cliente_id      UUID REFERENCES clientes(id),
  comensal_numero INT NOT NULL DEFAULT nextval('comensal_seq'),
  numero_personas SMALLINT,
  estado          VARCHAR(20) NOT NULL DEFAULT 'abierta'
                  CHECK (estado IN ('abierta','en_preparacion','servida','pagando','cerrada','cancelada')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ
);
CREATE INDEX idx_ordenes_mesa ON ordenes(mesa_id);
CREATE INDEX idx_ordenes_estado ON ordenes(estado);

ALTER TABLE ventas
  ADD CONSTRAINT fk_ventas_orden FOREIGN KEY (orden_id) REFERENCES ordenes(id);

CREATE TABLE orden_items (
  id              BIGSERIAL PRIMARY KEY,
  orden_id        UUID NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  cantidad        NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2) NOT NULL,
  estado          VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','preparando','listo','servido','cancelado')),
  -- Check individual del cocinero mientras la orden completa está en "preparando".
  -- "Marcar listo" (a nivel de toda la orden) exige que todos estén en true.
  listo_cocina    BOOLEAN NOT NULL DEFAULT false,
  -- Nota libre del mesero al agregar el producto (ej. "sin azúcar"). Solo se le
  -- muestra a Cocina cuando empieza a preparar la orden, no antes.
  observaciones   VARCHAR(300),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orden_items_orden ON orden_items(orden_id);

-- Historial de una orden: cada alta/edición/cancelación de ítem que hace el mesero
-- queda registrada aquí, consultable por orden. Cocina nunca lee de esta tabla —
-- siempre consulta orden_items en vivo, así que ve la orden ya actualizada.
CREATE TABLE orden_historial (
  id            BIGSERIAL PRIMARY KEY,
  orden_id      UUID NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  orden_item_id BIGINT REFERENCES orden_items(id),
  accion        VARCHAR(40) NOT NULL
                CHECK (accion IN (
                  'item_agregado', 'item_editado', 'item_cancelado', 'item_entregado',
                  -- item_preparando/item_listo: transiciones de Cocina, para poder calcular
                  -- tiempos de preparación/entrega en las analíticas del Dashboard.
                  'item_preparando', 'item_listo'
                )),
  detalle       JSONB,
  usuario_id    UUID REFERENCES usuarios(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orden_historial_orden ON orden_historial(orden_id, created_at);

CREATE TABLE pagos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id    UUID REFERENCES ordenes(id),
  venta_id    UUID REFERENCES ventas(id),
  -- 'administrativo': cuenta cerrada sin generar ingreso real en Caja General
  -- (ver migao.service.ts::cerrarOrden) — se lleva en un historial aparte.
  metodo_pago VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo','banco','administrativo')),
  monto       NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  referencia  VARCHAR(100),
  usuario_id  UUID REFERENCES usuarios(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (orden_id IS NOT NULL OR venta_id IS NOT NULL)
);

CREATE TABLE facturas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id   UUID REFERENCES ventas(id),
  orden_id   UUID REFERENCES ordenes(id),
  pedido_id  UUID, -- FK diferida: se agrega tras crear la tabla pedidos
  numero     VARCHAR(30) UNIQUE NOT NULL,
  tipo       VARCHAR(20) NOT NULL DEFAULT 'ticket' CHECK (tipo IN ('ticket','factura')),
  subtotal   NUMERIC(12,2) NOT NULL,
  impuestos  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total      NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (venta_id IS NOT NULL OR orden_id IS NOT NULL OR pedido_id IS NOT NULL)
);

-- ============================================================================
-- 7. PEDIDOS / ENCARGOS
-- ============================================================================

CREATE TABLE pedidos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id      UUID NOT NULL REFERENCES clientes(id),
  descripcion     TEXT NOT NULL,
  fecha_entrega   DATE NOT NULL,
  costo_estimado  NUMERIC(12,2) NOT NULL DEFAULT 0,
  precio_acordado NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado          VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','en_produccion','listo','entregado','cancelado')),
  responsable_id  UUID REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pedidos_cliente ON pedidos(cliente_id);
CREATE INDEX idx_pedidos_estado_fecha ON pedidos(estado, fecha_entrega);
CREATE TRIGGER trg_pedidos_updated BEFORE UPDATE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE facturas
  ADD CONSTRAINT fk_facturas_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos(id);

CREATE TABLE pedido_items (
  id          BIGSERIAL PRIMARY KEY,
  pedido_id   UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  insumo_id   UUID REFERENCES insumos(id),
  producto_id UUID REFERENCES productos(id),
  cantidad    NUMERIC(12,3) NOT NULL DEFAULT 1,
  CHECK (insumo_id IS NOT NULL OR producto_id IS NOT NULL)
);

CREATE TABLE pedido_abonos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id   UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  monto       NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  metodo_pago VARCHAR(30) NOT NULL CHECK (metodo_pago IN ('efectivo','tarjeta','transferencia','otro')),
  usuario_id  UUID REFERENCES usuarios(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pedido_abonos_pedido ON pedido_abonos(pedido_id);

CREATE TABLE pedido_historial (
  id              BIGSERIAL PRIMARY KEY,
  pedido_id       UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  estado_anterior VARCHAR(20),
  estado_nuevo    VARCHAR(20) NOT NULL,
  usuario_id      UUID REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pedido_historial_pedido ON pedido_historial(pedido_id);

-- ============================================================================
-- 8. SEED MINIMO DE MODULOS (requerido por FKs de productos/almacenes/etc.)
-- ============================================================================

INSERT INTO modulos (slug, nombre) VALUES
  ('general', 'Módulo general'),
  ('insumos', 'Insumos'),
  ('talleres', 'Talleres / Experiencias'),
  ('con_sentido', 'Con Sentido'),
  ('migao', 'Migao (POS)'),
  ('pedidos', 'Pedidos / Encargos');
