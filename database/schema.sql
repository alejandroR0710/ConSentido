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

-- El inicio de sesión acepta correo O número de documento como identificador
-- (nunca ambos a la vez, ver el CHECK) — cuál de los dos se usa lo decide
-- quien crea la cuenta desde el módulo de Usuarios.
CREATE TABLE usuarios (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre            VARCHAR(120) NOT NULL,
  email             VARCHAR(160) UNIQUE,
  numero_documento  VARCHAR(30) UNIQUE,
  password_hash     TEXT NOT NULL,
  rol_id            INT NOT NULL REFERENCES roles(id),
  activo            BOOLEAN NOT NULL DEFAULT true,
  ultimo_login      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_usuarios_identificador CHECK ((email IS NOT NULL) <> (numero_documento IS NOT NULL))
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

-- Auditoría de correcciones hechas a un día YA cerrado del historial de Caja
-- (agregar un movimiento olvidado, o corregir monto/método/motivo de uno
-- existente) — a diferencia de las ediciones normales del turno abierto, esto
-- reabre contabilidad ya contada físicamente, así que cada acción queda
-- registrada con el antes/después. Mismo espíritu que orden_historial.
CREATE TABLE movimientos_caja_ediciones (
  id            BIGSERIAL PRIMARY KEY,
  movimiento_id BIGINT REFERENCES movimientos_caja(id) ON DELETE SET NULL,
  fecha         VARCHAR(10) NOT NULL, -- día calendario (Bogotá) afectado, 'YYYY-MM-DD'
  accion        VARCHAR(20) NOT NULL CHECK (accion IN ('creado', 'editado', 'anulado')),
  datos_antes   JSONB, -- null si accion = 'creado'
  datos_despues JSONB NOT NULL,
  nota          VARCHAR(300) NOT NULL,
  usuario_id    UUID NOT NULL REFERENCES usuarios(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_movimientos_caja_ediciones_fecha ON movimientos_caja_ediciones(fecha, created_at);

-- Notificaciones push (Web Push/VAPID) para la PWA: pedido nuevo en Cocina,
-- orden lista en Mesero, aunque la pestaña esté cerrada o el celular
-- bloqueado. `endpoint` es único por dispositivo/navegador; un usuario puede
-- tener varias filas (varios dispositivos suscritos a la vez).
CREATE TABLE push_subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      VARCHAR(255) NOT NULL,
  auth        VARCHAR(255) NOT NULL,
  user_agent  VARCHAR(300),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_subscriptions_usuario ON push_subscriptions(usuario_id);

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Proveedor opcional de un egreso de Caja (ej. "pago a proveedor X") — se
-- agrega acá (en vez de en el CREATE TABLE de arriba) porque proveedores
-- todavía no existe cuando se declara movimientos_caja más arriba en este
-- archivo.
ALTER TABLE movimientos_caja ADD COLUMN proveedor_id UUID REFERENCES proveedores(id);

-- Egreso contra el ACUMULADO TOTAL histórico del negocio (todo lo que ha
-- entrado y salido desde siempre), no contra el turno activo ni un día
-- puntual — por eso vive completamente aparte de movimientos_caja/
-- turnos_caja (que exigen un turno_id) en vez de forzar un turno artificial.
-- El "acumulado total" se calcula en vivo restando también estas filas.
CREATE TABLE caja_egresos_acumulado (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_gasto_id INT NOT NULL REFERENCES categorias_gasto(id),
  proveedor_id       UUID REFERENCES proveedores(id),
  monto              NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  metodo_pago        VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo','banco')),
  motivo             VARCHAR(200) NOT NULL,
  usuario_id         UUID NOT NULL REFERENCES usuarios(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
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

-- 1:1 con un producto vendible de Con Sentido (categorias_producto/productos
-- de arriba son compartidas con Migao, pero el stock de producto terminado
-- solo lo usa Con Sentido — Migao descuenta ingredientes, no unidades de
-- producto vendido, ver migao_inventario_productos más abajo).
CREATE TABLE inventario_productos (
  id              BIGSERIAL PRIMARY KEY,
  producto_id     UUID NOT NULL UNIQUE REFERENCES productos(id) ON DELETE CASCADE,
  cantidad_actual NUMERIC(14,3) NOT NULL DEFAULT 0,
  stock_minimo    NUMERIC(12,3) NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Historial de ventas de Con Sentido, con desglose de ítems — el ingreso real
-- en Caja General (movimientos_caja) se registra aparte, vía
-- cajaService.registrarIngreso con referenciaEntidad='con_sentido_ventas' y
-- referenciaId=con_sentido_ventas.id (ver con_sentido.service.ts).
CREATE TABLE con_sentido_ventas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     UUID REFERENCES usuarios(id),
  monto          NUMERIC(12,2) NOT NULL,
  metodo_pago    VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo', 'banco', 'mixto')),
  monto_efectivo NUMERIC(12,2),
  monto_banco    NUMERIC(12,2),
  -- 'anulada' = Root/Super Root eliminó la venta desde Caja General: se
  -- conserva el registro (auditoría), pero deja de contar en analíticas y ya
  -- no tiene pagos/movimientos de Caja asociados (ver caja.service.ts::anularVenta).
  estado         VARCHAR(20) NOT NULL DEFAULT 'completada' CHECK (estado IN ('completada', 'anulada')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_con_sentido_ventas_fecha ON con_sentido_ventas(created_at DESC);
CREATE TRIGGER trg_con_sentido_ventas_updated BEFORE UPDATE ON con_sentido_ventas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE con_sentido_venta_items (
  id              BIGSERIAL PRIMARY KEY,
  venta_id        UUID NOT NULL REFERENCES con_sentido_ventas(id) ON DELETE CASCADE,
  producto        VARCHAR(255) NOT NULL,
  descripcion     TEXT,
  categoria       VARCHAR(100),
  cantidad        NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2) NOT NULL,
  subtotal        NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_con_sentido_venta_items_venta ON con_sentido_venta_items(venta_id);

-- ============================================================================
-- 5B. CALCULADORA DE COSTOS DE VELAS (Con Sentido) — exclusivo Root/Super Root
-- ============================================================================
-- Tablas maestras editables (precio de compra -> valor por unidad de uso, ya
-- calculado por Postgres con GENERATED ALWAYS: nunca queda desactualizado
-- porque no se replica la fórmula en TypeScript, se recalcula solo cuando
-- cambia el precio de compra). Prefijo `velas_` para no chocar con nada
-- existente — vive completamente aparte de `insumos`/`productos`.

CREATE TABLE velas_ceras (
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

CREATE TABLE velas_fragancias (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         VARCHAR(80) NOT NULL,
  presentacion_g NUMERIC(10,2) NOT NULL DEFAULT 1000 CHECK (presentacion_g > 0),
  precio_compra  NUMERIC(12,2) NOT NULL CHECK (precio_compra > 0),
  valor_gramo    NUMERIC(12,4) GENERATED ALWAYS AS (precio_compra / presentacion_g) STORED,
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE velas_pabilos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  talla          VARCHAR(10) NOT NULL,
  longitud_m     NUMERIC(10,2) NOT NULL CHECK (longitud_m > 0),
  precio_carrete NUMERIC(12,2) NOT NULL CHECK (precio_carrete > 0),
  valor_cm       NUMERIC(12,4) GENERATED ALWAYS AS (precio_carrete / longitud_m / 100) STORED,
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recipientes, tapas, empaques, decoración, identidad, papelería, protección,
-- otros — todo lo que no es cera/fragancia/pabilo, ya expresado en su costo
-- POR unidad de uso (unidad/cm/g/hoja/metro). cantidad_por_paquete/precio_paquete
-- son solo referencia para que el admin calcule valor_unitario a mano al
-- crear/editar (ej. "docena a $48.000 = $4.000 c/u") — una receta siempre usa
-- valor_unitario directo, nunca vuelve a dividir.
CREATE TABLE velas_insumos (
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

-- Fila única de parámetros globales (siempre se actualiza sobre id=true) —
-- multiplicador de precio por defecto (costo_base × multiplicador + empaque,
-- ver velas.service.ts::calcularCostoReceta). Arranca en 4, el valor que ya
-- usa el negocio a mano.
CREATE TABLE velas_parametros (
  id                  BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  multiplicador_precio NUMERIC(6,2) NOT NULL DEFAULT 4,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO velas_parametros (id) VALUES (true);

-- Receta/producto guardado — reutilizable, editable, duplicable. El costo NUNCA
-- se guarda acá (se recalcula en vivo contra los precios vigentes de las
-- tablas maestras cada vez que se consulta) — lo único persistido es la
-- composición de la receta y, opcionalmente, el precio final ya autorizado.
-- `tipo_vela` determina qué % del peso total NO es cera aprovechable
-- (decorativa -6%, decorativa_8 -8%, vaso -12%, wax_melt -10%, ver
-- calcularCostoReceta) — `peso_mezcla_g` siempre guarda el peso TOTAL que se
-- pesó, nunca el ya descontado, para no perder el dato de origen.
CREATE TABLE velas_productos (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                  VARCHAR(150) NOT NULL,
  tipo_vela               VARCHAR(20) NOT NULL DEFAULT 'decorativa' CHECK (tipo_vela IN ('decorativa','decorativa_8','vaso','wax_melt')),
  peso_mezcla_g           NUMERIC(10,2) NOT NULL CHECK (peso_mezcla_g > 0),
  pabilo_id               UUID REFERENCES velas_pabilos(id),
  cm_pabilo               NUMERIC(10,2),
  costo_mano_obra         NUMERIC(12,2) NOT NULL DEFAULT 0, -- monto fijo, no minutos × tarifa
  multiplicador_precio    NUMERIC(6,2), -- NULL = usa el global de velas_parametros
  redondeo                INT NOT NULL DEFAULT 100 CHECK (redondeo IN (0,100,500,1000)),
  precio_final_autorizado NUMERIC(12,2), -- distinto del precio sugerido calculado
  notas                   VARCHAR(300),
  activo                  BOOLEAN NOT NULL DEFAULT true,
  usuario_id              UUID REFERENCES usuarios(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE velas_producto_ceras (
  producto_id UUID NOT NULL REFERENCES velas_productos(id) ON DELETE CASCADE,
  cera_id     UUID NOT NULL REFERENCES velas_ceras(id),
  gramos      NUMERIC(10,2) NOT NULL CHECK (gramos > 0),
  PRIMARY KEY (producto_id, cera_id)
);

CREATE TABLE velas_producto_fragancias (
  producto_id  UUID NOT NULL REFERENCES velas_productos(id) ON DELETE CASCADE,
  fragancia_id UUID NOT NULL REFERENCES velas_fragancias(id),
  porcentaje   NUMERIC(5,2) NOT NULL CHECK (porcentaje > 0),
  PRIMARY KEY (producto_id, fragancia_id)
);

-- insumo_id (catálogo) O nombre_manual+valor_unitario_manual (uno solo,
-- escrito a mano en esa receta, sin agregarlo al catálogo) — nunca los dos.
CREATE TABLE velas_producto_insumos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id           UUID NOT NULL REFERENCES velas_productos(id) ON DELETE CASCADE,
  insumo_id             UUID REFERENCES velas_insumos(id),
  nombre_manual         VARCHAR(120),
  valor_unitario_manual NUMERIC(12,2),
  cantidad              NUMERIC(10,2) NOT NULL CHECK (cantidad > 0),
  CHECK (
    (insumo_id IS NOT NULL AND nombre_manual IS NULL AND valor_unitario_manual IS NULL) OR
    (insumo_id IS NULL AND nombre_manual IS NOT NULL AND valor_unitario_manual IS NOT NULL)
  )
);
-- Un mismo insumo de catálogo no se repite en una receta (mismo criterio de
-- antes, la antigua PK compuesta) — no aplica a los manuales, cada uno es su
-- propia fila con su propio nombre.
CREATE UNIQUE INDEX velas_producto_insumos_catalogo_uq ON velas_producto_insumos (producto_id, insumo_id) WHERE insumo_id IS NOT NULL;

-- ============================================================================
-- Inventario de Migao: catálogo de insumos "tal como los entrega el
-- proveedor" (ej. una torta de chocolate = 12 porciones, una paca de leche =
-- 6 unidades) + receta de qué consume cada producto vendible del menú. El
-- stock se guarda SIEMPRE en unidades sueltas (no en paquetes): el consumo
-- por venta es por unidad ("1 porción de torta"); unidades_por_paquete solo
-- sirve para convertir "llegaron 3 pacas" a unidades al registrar una
-- entrada, y para mostrar "~N paquetes" en pantalla. Prefijo `migao_` para no
-- confundir con `insumos`/`inventario_insumos` (multi-almacén, sin receta) ni
-- con `inventario_productos` de arriba (producto terminado de Con Sentido).
-- ============================================================================

CREATE TABLE migao_inventario_productos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                VARCHAR(120) NOT NULL,
  unidad_medida         VARCHAR(30) NOT NULL,
  unidades_por_paquete  NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (unidades_por_paquete > 0),
  tamano_unidad         VARCHAR(30),
  costo_paquete         NUMERIC(12,2),
  stock_unidades        NUMERIC(12,3) NOT NULL DEFAULT 0,
  stock_minimo_unidades NUMERIC(12,3),
  activo                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ledger firmado: cantidad_unidades positivo = entró stock, negativo = salió.
-- 'entrada'/'ajuste' se registran a mano (Root/Super Root/Cocina); 'consumo'
-- lo escribe el propio flujo de órdenes de Migao, nunca un formulario.
CREATE TABLE migao_inventario_movimientos (
  id                 BIGSERIAL PRIMARY KEY,
  producto_id        UUID NOT NULL REFERENCES migao_inventario_productos(id),
  tipo               VARCHAR(20) NOT NULL CHECK (tipo IN ('entrada','ajuste','consumo')),
  cantidad_unidades  NUMERIC(12,3) NOT NULL,
  motivo             VARCHAR(200),
  referencia_entidad VARCHAR(40),
  referencia_id      VARCHAR(64),
  usuario_id         UUID NOT NULL REFERENCES usuarios(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_migao_inv_mov_producto ON migao_inventario_movimientos(producto_id, created_at);

-- Receta: qué ingredientes (y cuántas unidades de cada uno) consume UNA
-- unidad vendida de un producto del menú (`productos`, no de este catálogo
-- nuevo). Un producto del menú sin filas acá simplemente no toca inventario
-- al venderse.
CREATE TABLE migao_producto_ingredientes (
  id                     BIGSERIAL PRIMARY KEY,
  producto_id            UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  inventario_producto_id UUID NOT NULL REFERENCES migao_inventario_productos(id),
  cantidad_por_unidad    NUMERIC(10,3) NOT NULL CHECK (cantidad_por_unidad > 0),
  UNIQUE (producto_id, inventario_producto_id)
);

-- Receta de una "base" (bolsita de Migao, ej. Migao Valluno): qué amasijos
-- y cuánto de cada uno se necesitan para prepararla. Tanto la base como los
-- amasijos son productos NORMALES de migao_inventario_productos — el mismo
-- inventario de siempre, con su propio stock y stock mínimo — así que acá
-- solo se guarda la receta, nunca un stock aparte (a diferencia de un
-- primer intento de este módulo que sí duplicaba el stock en tablas propias;
-- se descartó por quedar desincronizado del inventario real del negocio).
-- Preparar bases consume amasijos y da entrada a la base, con los mismos
-- movimientos de migao_inventario_movimientos que ya usa cualquier producto;
-- vender un producto del menú que sea un amasijo/base directo ya se resuelve
-- solo con una fila en migao_producto_ingredientes (arriba), sin código aparte.
CREATE TABLE migao_base_recetas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_producto_id    UUID NOT NULL REFERENCES migao_inventario_productos(id) ON DELETE CASCADE,
  amasijo_producto_id UUID NOT NULL REFERENCES migao_inventario_productos(id) ON DELETE CASCADE,
  cantidad_amasijo    NUMERIC(12,3) NOT NULL CHECK (cantidad_amasijo > 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(base_producto_id, amasijo_producto_id)
);
CREATE INDEX idx_migao_base_recetas_base ON migao_base_recetas(base_producto_id);

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

-- Ítems de un ingreso registrado a mano desde Caja General (botón "Registrar
-- ingreso", modo "Agregar productos") — igual que venta_items pero con
-- nombre libre en vez de producto_id: acá no hay catálogo detrás (puede ser
-- cualquier módulo/motivo), así que no hay a qué producto real enganchar la
-- línea (ver caja.service.ts::registrarIngreso).
CREATE TABLE caja_ingreso_items (
  id              BIGSERIAL PRIMARY KEY,
  venta_id        UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  nombre          VARCHAR(150) NOT NULL,
  cantidad        NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2) NOT NULL,
  subtotal        NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
);
CREATE INDEX idx_caja_ingreso_items_venta ON caja_ingreso_items(venta_id);

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
  -- Ubicación/tamaño en el plano visual del área (piso), en % (0-100) del
  -- lienzo — responsive sin depender de un tamaño de pantalla fijo. NULL =
  -- la mesa todavía no se dibujó en el editor (sigue existiendo y se puede
  -- seguir usando por número a mano, simplemente no aparece en ningún plano).
  pos_x     NUMERIC(5,2),
  pos_y     NUMERIC(5,2),
  ancho     NUMERIC(5,2),
  alto      NUMERIC(5,2),
  -- Soft-hide: ordenes.mesa_id no tiene ON DELETE, así que una mesa referenciada
  -- por cualquier orden (abierta o histórica) no se puede borrar de verdad —
  -- "eliminar" desactiva en ese caso en vez de fallar con un error de FK.
  activo    BOOLEAN NOT NULL DEFAULT true,
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
  -- NULL = todavía no se ha cobrado; si tiene valor, marca CUÁL venta ya lo
  -- pagó — permite cobrar productos sueltos de una cuenta que sigue abierta
  -- (el mesero puede seguir agregando productos nuevos mientras tanto), cada
  -- cobro parcial con su propia factura (ver migao.service.ts::pagarItems).
  venta_id        UUID REFERENCES ventas(id),
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

-- Cómo quedó partida una cuenta al iniciar el cobro (1 fila si no se divide
-- entre varias personas) — ver migao.service.ts::iniciarCobro. `monto_debido`
-- se calcula UNA vez al crear la parte y queda fijo; lo pagado se recalcula
-- siempre en vivo sumando `pagos.monto WHERE parte_id = esta`, nunca se
-- guarda un contador aparte.
CREATE TABLE migao_cuenta_partes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id     UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  indice       INT NOT NULL,
  modo         VARCHAR(20) NOT NULL CHECK (modo IN ('producto','igual')),
  monto_debido NUMERIC(12,2) NOT NULL CHECK (monto_debido > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venta_id, indice)
);

-- Solo para modo='producto': qué unidades de qué ítems le tocan a esta
-- parte — ya no se usa para calcular el monto (eso quedó fijo en
-- monto_debido), solo para mostrar el detalle en pantalla/factura.
CREATE TABLE migao_cuenta_parte_unidades (
  parte_id      UUID NOT NULL REFERENCES migao_cuenta_partes(id) ON DELETE CASCADE,
  orden_item_id BIGINT NOT NULL REFERENCES orden_items(id),
  cantidad      NUMERIC(10,3) NOT NULL CHECK (cantidad > 0),
  PRIMARY KEY (parte_id, orden_item_id)
);

CREATE TABLE pagos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id    UUID REFERENCES ordenes(id),
  venta_id    UUID REFERENCES ventas(id),
  -- 'administrativo': cuenta cerrada sin generar ingreso real en Caja General
  -- (ver migao.service.ts::cerrarOrden) — se lleva en un historial aparte.
  metodo_pago VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo','banco','administrativo')),
  monto       NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  referencia  VARCHAR(100),
  -- Cada abono (pago parcial o total) de una cuenta con pagos parciales/
  -- divididos queda tageado a su parte — NULL en el cobro simple de un solo
  -- paso (ver migao.service.ts::cerrarOrden, que no usa partes).
  parte_id    UUID REFERENCES migao_cuenta_partes(id),
  usuario_id  UUID REFERENCES usuarios(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (orden_id IS NOT NULL OR venta_id IS NOT NULL)
);

-- Reparto de propinas acumuladas al personal — un solo reparto puede cubrir
-- efectivo y banco a la vez (montos separados), porque a quién se le paga en
-- cada método lo decide cada entrega, no el reparto entero (ver
-- migao_propinas_entregas.metodo_pago). Nunca borra migao_propinas: las
-- marca como liquidadas para que dejen de contar en el "pendiente por
-- repartir" — el historial de cada propina individual queda intacto para
-- siempre, solo se reinicia el acumulado pendiente.
CREATE TABLE migao_propinas_liquidaciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monto_efectivo NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_banco    NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- No es GENERATED a propósito: la columna ya existía como valor normal
  -- antes de este cambio (con datos reales en producción), y ALTER no puede
  -- convertir una columna existente a generada — así que el service la
  -- sigue calculando él mismo (monto_efectivo + monto_banco) al insertar,
  -- igual en instalación nueva que en una ya existente.
  monto          NUMERIC(12,2) NOT NULL,
  nota           VARCHAR(200),
  -- Rango (min/max) de los días de propinas que se incluyeron en este reparto
  -- — NULL en liquidaciones viejas, de antes de poder elegir días concretos
  -- (esas repartían TODO lo pendiente sin filtro de fecha).
  fecha_desde    DATE,
  fecha_hasta    DATE,
  usuario_id     UUID REFERENCES usuarios(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (monto_efectivo > 0 OR monto_banco > 0)
);

-- Cómo se repartió el monto de una liquidación entre las personas del
-- equipo: una fila por persona/entrega, con su propio método de pago (en qué
-- se le entregó a ESA persona, independiente de en qué método vino la
-- propina original), fecha (puede diferir de created_at, ej. se registra
-- unos días después) y motivo/mensaje libre. La suma de los montos en
-- efectivo debe dar exactamente monto_efectivo de la liquidación, y lo mismo
-- para banco (se valida en el backend al crearlas, no con un CHECK de BD).
CREATE TABLE migao_propinas_entregas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  liquidacion_id  UUID NOT NULL REFERENCES migao_propinas_liquidaciones(id) ON DELETE CASCADE,
  nombre_persona  VARCHAR(120) NOT NULL,
  metodo_pago     VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo','banco')),
  monto           NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  fecha_entrega   DATE NOT NULL DEFAULT CURRENT_DATE,
  motivo          VARCHAR(300),
  usuario_id      UUID REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_migao_propinas_entregas_liquidacion ON migao_propinas_entregas(liquidacion_id);
CREATE INDEX idx_migao_propinas_entregas_fecha ON migao_propinas_entregas(fecha_entrega DESC);

-- Propina opcional al cobrar una cuenta de Migao: dinero del mesero/personal,
-- NUNCA se mezcla con movimientos_caja/turnos_caja (no cuenta para el cuadre
-- de turno del cajero) — vive en su propia tabla e historial aparte.
-- `porcentaje` NULL = valor voluntario/personalizado (no un 5%/10% fijo).
-- `liquidacion_id` NULL = todavía pendiente por repartir.
CREATE TABLE migao_propinas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id       UUID NOT NULL REFERENCES ordenes(id),
  venta_id       UUID NOT NULL REFERENCES ventas(id),
  mesero_id      UUID REFERENCES usuarios(id),
  usuario_id     UUID REFERENCES usuarios(id),
  monto          NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  porcentaje     NUMERIC(5,2),
  metodo_pago    VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo','banco')),
  liquidacion_id UUID REFERENCES migao_propinas_liquidaciones(id),
  -- De qué parte de la cuenta vino esta propina (cobro con pagos parciales/
  -- divididos) — NULL en el cobro simple de un solo paso.
  parte_id       UUID REFERENCES migao_cuenta_partes(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_migao_propinas_mesero ON migao_propinas(mesero_id);
CREATE INDEX idx_migao_propinas_fecha ON migao_propinas(created_at DESC);
CREATE INDEX idx_migao_propinas_liquidacion ON migao_propinas(liquidacion_id);

-- Cotización: presupuesto para un cliente ANTES de que exista una orden/venta
-- real — vive completamente aparte (nunca toca ordenes/ventas/inventario/caja).
-- Los ítems son texto libre (sin FK a productos) para poder cotizar cosas que
-- no están en el menú/catálogo; el frontend puede autocompletar desde el
-- catálogo de Migao como atajo, pero el valor guardado siempre es una copia.
CREATE TABLE migao_cotizaciones (
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

CREATE TABLE migao_cotizacion_items (
  id              BIGSERIAL PRIMARY KEY,
  cotizacion_id   UUID NOT NULL REFERENCES migao_cotizaciones(id) ON DELETE CASCADE,
  nombre          VARCHAR(150) NOT NULL,
  cantidad        NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2) NOT NULL,
  subtotal        NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
);
CREATE INDEX idx_migao_cotizacion_items_cotizacion ON migao_cotizacion_items(cotizacion_id);

-- Numeración legible ("F-000123") para facturas/tickets impresos — nunca se
-- reinicia ni se recalcula, cada factura toma el siguiente valor una sola vez.
CREATE SEQUENCE facturas_numero_seq;

CREATE TABLE facturas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id            UUID REFERENCES ventas(id),
  orden_id            UUID REFERENCES ordenes(id),
  pedido_id           UUID, -- FK diferida: se agrega tras crear la tabla pedidos
  -- Con Sentido tiene su propia tabla de ventas (con_sentido_ventas), aparte
  -- de la `ventas` compartida de arriba — ver SECCIÓN 1B de produccion.sql.
  con_sentido_venta_id UUID REFERENCES con_sentido_ventas(id),
  numero     VARCHAR(30) UNIQUE NOT NULL,
  tipo       VARCHAR(20) NOT NULL DEFAULT 'ticket' CHECK (tipo IN ('ticket','factura')),
  subtotal   NUMERIC(12,2) NOT NULL,
  impuestos  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total      NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (venta_id IS NOT NULL OR orden_id IS NOT NULL OR pedido_id IS NOT NULL OR con_sentido_venta_id IS NOT NULL)
);
-- Una sola factura por venta (get-or-create idempotente al reimprimir).
CREATE UNIQUE INDEX idx_facturas_venta_unica ON facturas(venta_id) WHERE venta_id IS NOT NULL;
CREATE UNIQUE INDEX idx_facturas_con_sentido_venta_unica ON facturas(con_sentido_venta_id) WHERE con_sentido_venta_id IS NOT NULL;

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
