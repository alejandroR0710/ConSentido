-- ============================================================================
-- SIsteMAPOS - Esquema de Base de Datos para MySQL 8 (rama hosting-mysql)
-- Traducción de database/schema.sql (PostgreSQL). Mismas tablas y columnas,
-- con estas equivalencias:
--   UUID          -> CHAR(36) DEFAULT (UUID())
--   TIMESTAMPTZ   -> DATETIME(6) en hora de Bogotá (-05:00, sin horario de verano)
--   JSONB         -> JSON
--   SERIAL        -> INT AUTO_INCREMENT
--   trigger set_updated_at() -> ON UPDATE CURRENT_TIMESTAMP(6)
--   índices únicos parciales (WHERE ...) -> columna generada + UNIQUE
--   SEQUENCE      -> tabla `secuencias` (ver backend/src/shared/db/pool.ts)
--
-- Para importar en phpMyAdmin: selecciona la base de datos vacía → Importar
-- → este archivo. Después importa el archivo de datos generado por
-- backend/scripts/migrar-supabase-a-mysql.js.
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '-05:00';
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
-- 0. SECUENCIAS (reemplazo de CREATE SEQUENCE)
-- ============================================================================

CREATE TABLE secuencias (
  nombre VARCHAR(60) PRIMARY KEY,
  valor  BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

INSERT INTO secuencias (nombre, valor) VALUES ('comensal_seq', 0), ('facturas_numero_seq', 0);

-- ============================================================================
-- 1. MODULO GENERAL TRANSVERSAL
-- ============================================================================

CREATE TABLE modulos (
  id     SMALLINT AUTO_INCREMENT PRIMARY KEY,
  slug   VARCHAR(40) UNIQUE NOT NULL,
  nombre VARCHAR(80) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE roles (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(60) UNIQUE NOT NULL,
  descripcion TEXT,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE permisos (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  modulo_id SMALLINT NOT NULL,
  accion    VARCHAR(60) NOT NULL,
  codigo    VARCHAR(120) UNIQUE NOT NULL,
  FOREIGN KEY (modulo_id) REFERENCES modulos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE roles_permisos (
  rol_id     INT NOT NULL,
  permiso_id INT NOT NULL,
  PRIMARY KEY (rol_id, permiso_id),
  FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permiso_id) REFERENCES permisos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE usuarios (
  id                CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  nombre            VARCHAR(120) NOT NULL,
  email             VARCHAR(160) UNIQUE,
  numero_documento  VARCHAR(30) UNIQUE,
  password_hash     TEXT NOT NULL,
  rol_id            INT NOT NULL,
  activo            BOOLEAN NOT NULL DEFAULT true,
  -- Se llena cuando "Eliminar" no pudo borrar físicamente al tener actividad
  -- registrada (ver usuarios.service.ts::eliminarUsuario) — el usuario sigue
  -- vinculado en todo su historial, solo queda marcado como eliminado.
  deleted_at        DATETIME(6) NULL,
  ultimo_login      DATETIME(6),
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT chk_usuarios_identificador CHECK ((email IS NOT NULL) <> (numero_documento IS NOT NULL)),
  FOREIGN KEY (rol_id) REFERENCES roles(id),
  INDEX idx_usuarios_rol (rol_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE usuarios_modulos (
  usuario_id CHAR(36) NOT NULL,
  modulo_id  SMALLINT NOT NULL,
  PRIMARY KEY (usuario_id, modulo_id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (modulo_id) REFERENCES modulos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE auditoria (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id CHAR(36),
  modulo_id  SMALLINT,
  accion     VARCHAR(60) NOT NULL,
  entidad    VARCHAR(80) NOT NULL,
  entidad_id VARCHAR(64),
  detalle    JSON,
  ip         VARCHAR(45),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (modulo_id) REFERENCES modulos(id),
  INDEX idx_auditoria_entidad (entidad, entidad_id),
  INDEX idx_auditoria_fecha (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE alertas (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  tipo       VARCHAR(40) NOT NULL,
  modulo_id  SMALLINT,
  entidad    VARCHAR(80),
  entidad_id VARCHAR(64),
  mensaje    TEXT NOT NULL,
  severidad  VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (severidad IN ('info','advertencia','critica')),
  leida      BOOLEAN NOT NULL DEFAULT false,
  usuario_id CHAR(36),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (modulo_id) REFERENCES modulos(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_alertas_usuario_leida (usuario_id, leida)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE categorias_gasto (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  nombre    VARCHAR(80) UNIQUE NOT NULL,
  activo    BOOLEAN NOT NULL DEFAULT true,
  modulo_id SMALLINT,
  FOREIGN KEY (modulo_id) REFERENCES modulos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE turnos_caja (
  id                              CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  cajero_id                       CHAR(36) NOT NULL,
  monto_inicial_efectivo          DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_inicial_banco             DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_final_declarado_efectivo  DECIMAL(12,2),
  monto_final_calculado_efectivo  DECIMAL(12,2),
  diferencia_efectivo             DECIMAL(12,2),
  monto_final_calculado_banco     DECIMAL(12,2),
  estado                          VARCHAR(20) NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
  abierto_en                      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  cerrado_en                      DATETIME(6),
  -- Reemplazo del índice único parcial `WHERE estado = 'abierto'`: vale 1
  -- solo en el turno abierto (NULL en los cerrados, que no chocan entre sí).
  abierto_unico                   TINYINT GENERATED ALWAYS AS (IF(estado = 'abierto', 1, NULL)) STORED,
  CHECK (estado = 'abierto' OR cerrado_en IS NOT NULL),
  FOREIGN KEY (cajero_id) REFERENCES usuarios(id),
  INDEX idx_turnos_caja_cajero (cajero_id, estado),
  UNIQUE KEY uq_turno_abierto_global (abierto_unico)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE movimientos_caja (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  turno_id           CHAR(36) NOT NULL,
  tipo               VARCHAR(20) NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
  modulo_origen_id   SMALLINT,
  categoria_gasto_id INT,
  referencia_entidad VARCHAR(80),
  referencia_id      VARCHAR(64),
  monto              DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  monto_sin_descuento DECIMAL(12,2),
  descuento_porcentaje DECIMAL(5,2),
  metodo_pago        VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo', 'banco')),
  es_pago_mixto      BOOLEAN NOT NULL DEFAULT false,
  -- Últimos 4 del ID de la transferencia (letras/números): obligatorio en
  -- todo ingreso por banco desde 2026-09-27; null en efectivo y en los anteriores.
  referencia_banco   VARCHAR(4),
  motivo             TEXT,
  usuario_id         CHAR(36), -- en producción hay movimientos viejos sin usuario
  created_at         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  proveedor_id       CHAR(36),
  CHECK (tipo = 'ingreso' OR categoria_gasto_id IS NOT NULL),
  FOREIGN KEY (turno_id) REFERENCES turnos_caja(id),
  FOREIGN KEY (modulo_origen_id) REFERENCES modulos(id),
  FOREIGN KEY (categoria_gasto_id) REFERENCES categorias_gasto(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_movimientos_caja_turno (turno_id, created_at),
  INDEX idx_movimientos_caja_referencia (referencia_entidad, referencia_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE movimientos_caja_ediciones (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  movimiento_id BIGINT,
  fecha         VARCHAR(10) NOT NULL,
  accion        VARCHAR(20) NOT NULL CHECK (accion IN ('creado', 'editado', 'anulado')),
  datos_antes   JSON,
  datos_despues JSON NOT NULL,
  nota          VARCHAR(300) NOT NULL,
  usuario_id    CHAR(36) NOT NULL,
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (movimiento_id) REFERENCES movimientos_caja(id) ON DELETE SET NULL,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_movimientos_caja_ediciones_fecha (fecha, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE push_subscriptions (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id  CHAR(36) NOT NULL,
  -- TEXT no admite UNIQUE en MySQL; los endpoints de Web Push miden ~200 caracteres.
  endpoint    VARCHAR(700) NOT NULL UNIQUE,
  p256dh      VARCHAR(255) NOT NULL,
  auth        VARCHAR(255) NOT NULL,
  user_agent  VARCHAR(300),
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_push_subscriptions_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

-- ============================================================================
-- 2. CLIENTES
-- ============================================================================

CREATE TABLE clientes (
  id                  CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  nombre              VARCHAR(150) NOT NULL,
  telefono            VARCHAR(30),
  email               VARCHAR(160),
  direccion           TEXT,
  documento_identidad VARCHAR(40),
  notas               TEXT,
  activo              BOOLEAN NOT NULL DEFAULT true,
  created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_clientes_telefono (telefono),
  INDEX idx_clientes_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

-- ============================================================================
-- 3. INSUMOS
-- ============================================================================

CREATE TABLE categorias_insumo (
  id     INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) UNIQUE NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE proveedores (
  id         CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  nombre     VARCHAR(150) NOT NULL,
  contacto   VARCHAR(120),
  telefono   VARCHAR(30),
  email      VARCHAR(160),
  activo     BOOLEAN NOT NULL DEFAULT true,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

ALTER TABLE movimientos_caja ADD FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);

CREATE TABLE caja_egresos_acumulado (
  id                 CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  categoria_gasto_id INT NOT NULL,
  proveedor_id       CHAR(36),
  monto              DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  metodo_pago        VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo','banco')),
  motivo             VARCHAR(200) NOT NULL,
  usuario_id         CHAR(36) NOT NULL,
  created_at         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (categoria_gasto_id) REFERENCES categorias_gasto(id),
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE almacenes (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  nombre    VARCHAR(100) NOT NULL,
  modulo_id SMALLINT,
  ubicacion VARCHAR(150),
  activo    BOOLEAN NOT NULL DEFAULT true,
  FOREIGN KEY (modulo_id) REFERENCES modulos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE insumos (
  id                     CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  nombre                 VARCHAR(150) NOT NULL,
  categoria_id           INT,
  unidad_medida          VARCHAR(20) NOT NULL,
  stock_minimo           DECIMAL(12,3) NOT NULL DEFAULT 0,
  costo_unitario         DECIMAL(12,2) NOT NULL DEFAULT 0,
  proveedor_principal_id CHAR(36),
  imagen_url             TEXT,
  descripcion            TEXT,
  activo                 BOOLEAN NOT NULL DEFAULT true,
  created_at             DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at             DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  FOREIGN KEY (categoria_id) REFERENCES categorias_insumo(id),
  FOREIGN KEY (proveedor_principal_id) REFERENCES proveedores(id),
  INDEX idx_insumos_categoria (categoria_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE inventario_insumos (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  insumo_id       CHAR(36) NOT NULL,
  almacen_id      INT NOT NULL,
  cantidad_actual DECIMAL(14,3) NOT NULL DEFAULT 0,
  updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE (insumo_id, almacen_id),
  FOREIGN KEY (insumo_id) REFERENCES insumos(id) ON DELETE CASCADE,
  FOREIGN KEY (almacen_id) REFERENCES almacenes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE movimientos_insumo (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  insumo_id         CHAR(36) NOT NULL,
  almacen_id        INT NOT NULL,
  tipo              VARCHAR(20) NOT NULL CHECK (tipo IN ('entrada','salida','transferencia','ajuste')),
  cantidad          DECIMAL(14,3) NOT NULL CHECK (cantidad > 0),
  costo_unitario    DECIMAL(12,2),
  motivo            VARCHAR(150),
  modulo_origen_id  SMALLINT,
  referencia_entidad VARCHAR(80),
  referencia_id     VARCHAR(64),
  almacen_destino_id INT,
  proveedor_id      CHAR(36),
  usuario_id        CHAR(36),
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (insumo_id) REFERENCES insumos(id),
  FOREIGN KEY (almacen_id) REFERENCES almacenes(id),
  FOREIGN KEY (modulo_origen_id) REFERENCES modulos(id),
  FOREIGN KEY (almacen_destino_id) REFERENCES almacenes(id),
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_mov_insumo_insumo (insumo_id, created_at),
  INDEX idx_mov_insumo_referencia (referencia_entidad, referencia_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

-- ============================================================================
-- 4. TALLERES / EXPERIENCIAS
-- ============================================================================

CREATE TABLE actividades (
  id              CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  nombre          VARCHAR(150) NOT NULL,
  descripcion     TEXT,
  fecha           DATETIME(6) NOT NULL,
  capacidad       INT NOT NULL,
  precio          DECIMAL(12,2) NOT NULL DEFAULT 0,
  costo_estimado  DECIMAL(12,2) NOT NULL DEFAULT 0,
  estado          VARCHAR(20) NOT NULL DEFAULT 'programada'
                  CHECK (estado IN ('programada','en_curso','cerrada','cancelada')),
  responsable_id  CHAR(36),
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  FOREIGN KEY (responsable_id) REFERENCES usuarios(id),
  INDEX idx_actividades_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE reservas (
  id                CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  actividad_id      CHAR(36) NOT NULL,
  cliente_id        CHAR(36),
  cantidad_personas INT NOT NULL DEFAULT 1,
  estado            VARCHAR(20) NOT NULL DEFAULT 'confirmada'
                    CHECK (estado IN ('pendiente','confirmada','cancelada','asistio','no_asistio')),
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (actividad_id) REFERENCES actividades(id) ON DELETE CASCADE,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  INDEX idx_reservas_actividad (actividad_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE asistentes (
  id         CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  reserva_id CHAR(36) NOT NULL,
  nombre     VARCHAR(150) NOT NULL,
  telefono   VARCHAR(30),
  email      VARCHAR(160),
  FOREIGN KEY (reserva_id) REFERENCES reservas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE actividad_materiales (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  actividad_id      CHAR(36) NOT NULL,
  insumo_id         CHAR(36) NOT NULL,
  cantidad_planeada DECIMAL(12,3) NOT NULL DEFAULT 0,
  cantidad_real     DECIMAL(12,3),
  FOREIGN KEY (actividad_id) REFERENCES actividades(id) ON DELETE CASCADE,
  FOREIGN KEY (insumo_id) REFERENCES insumos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE actividad_cierres (
  id               CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  actividad_id     CHAR(36) NOT NULL UNIQUE,
  ingresos         DECIMAL(12,2) NOT NULL DEFAULT 0,
  costo_materiales DECIMAL(12,2) NOT NULL DEFAULT 0,
  costo_otros      DECIMAL(12,2) NOT NULL DEFAULT 0,
  rentabilidad     DECIMAL(12,2) GENERATED ALWAYS AS (ingresos - costo_materiales - costo_otros) STORED,
  cerrado_por      CHAR(36),
  created_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (actividad_id) REFERENCES actividades(id) ON DELETE CASCADE,
  FOREIGN KEY (cerrado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

-- ============================================================================
-- 5. CON SENTIDO
-- ============================================================================

CREATE TABLE categorias_producto (
  id     INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) UNIQUE NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE productos (
  id             CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  nombre         VARCHAR(150) NOT NULL,
  -- Sincronización con el e-commerce (solo Con Sentido; ver
  -- migraciones/2026-09-28_sincronizacion_ecommerce.sql).
  sku                  VARCHAR(191) NULL,
  ecommerce_item_key   VARCHAR(191) NULL,
  ecommerce_product_id VARCHAR(191) NULL,
  ecommerce_variant_id VARCHAR(191) NULL,
  ecommerce_publicado  BOOLEAN NULL,
  categoria_id   INT,
  modulo_id      SMALLINT NOT NULL,
  precio         DECIMAL(12,2) NOT NULL DEFAULT 0,
  costo          DECIMAL(12,2) NOT NULL DEFAULT 0,
  unidad_medida  VARCHAR(20) NOT NULL DEFAULT 'unidad',
  imagen_url     TEXT,
  descripcion    TEXT,
  activo         BOOLEAN NOT NULL DEFAULT true,
  es_para_llevar BOOLEAN NOT NULL DEFAULT false,
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  FOREIGN KEY (categoria_id) REFERENCES categorias_producto(id),
  FOREIGN KEY (modulo_id) REFERENCES modulos(id),
  INDEX idx_productos_modulo (modulo_id),
  UNIQUE INDEX uq_productos_ecommerce_item (ecommerce_item_key),
  INDEX idx_productos_ecommerce_producto (ecommerce_product_id),
  INDEX idx_productos_sku (sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE inventario_productos (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  producto_id     CHAR(36) NOT NULL UNIQUE,
  cantidad_actual DECIMAL(14,3) NOT NULL DEFAULT 0,
  stock_minimo    DECIMAL(12,3) NOT NULL DEFAULT 0,
  updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE con_sentido_ventas (
  id             CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  usuario_id     CHAR(36),
  monto          DECIMAL(12,2) NOT NULL,
  metodo_pago    VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo', 'banco', 'mixto')),
  monto_efectivo DECIMAL(12,2),
  monto_banco    DECIMAL(12,2),
  estado         VARCHAR(20) NOT NULL DEFAULT 'completada' CHECK (estado IN ('completada', 'anulada')),
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_con_sentido_ventas_fecha (created_at DESC),
  INDEX idx_con_sentido_ventas_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE con_sentido_venta_items (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  venta_id        CHAR(36) NOT NULL,
  producto_id     CHAR(36) NULL,
  sku             VARCHAR(191) NULL,
  producto        VARCHAR(255) NOT NULL,
  descripcion     TEXT,
  categoria       VARCHAR(100),
  cantidad        DECIMAL(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario DECIMAL(12,2) NOT NULL,
  -- Obligatoria si la venta dejó el producto en stock negativo: por qué no
  -- cuadró el inventario (apareció en bodega, mala contada...).
  observacion_inventario TEXT NULL,
  subtotal        DECIMAL(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (venta_id) REFERENCES con_sentido_ventas(id) ON DELETE CASCADE,
  CONSTRAINT fk_con_sentido_venta_items_producto
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL,
  INDEX idx_con_sentido_venta_items_venta (venta_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

-- Avisos de stock por enviar al e-commerce / ya recibidos de él
-- (ver backend/src/modules/integracion_ecommerce).
CREATE TABLE ecommerce_sync_salida (
  seq             BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_id        CHAR(36) NOT NULL,
  tipo            VARCHAR(30) NOT NULL,
  payload         JSON NOT NULL,
  estado          VARCHAR(12) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'fallido')),
  intentos        INT NOT NULL DEFAULT 0,
  proximo_intento DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  ultimo_error    TEXT,
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  enviado_at      DATETIME(6) NULL,
  UNIQUE KEY uq_ecommerce_sync_salida_evento (event_id),
  INDEX idx_ecommerce_sync_salida_estado (estado, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE ecommerce_sync_recibidos (
  event_id   VARCHAR(191) PRIMARY KEY,
  tipo       VARCHAR(30) NOT NULL,
  resultado  VARCHAR(20) NOT NULL,
  detalle    TEXT,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

-- ============================================================================
-- 5B. CALCULADORA DE COSTOS DE VELAS
-- ============================================================================

CREATE TABLE velas_ceras (
  id              CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  nombre          VARCHAR(80) NOT NULL,
  presentacion_kg DECIMAL(10,3) NOT NULL CHECK (presentacion_kg > 0),
  precio_compra   DECIMAL(12,2) NOT NULL CHECK (precio_compra > 0),
  valor_gramo     DECIMAL(12,4) GENERATED ALWAYS AS (precio_compra / presentacion_kg / 1000) STORED,
  proveedor       VARCHAR(120),
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE velas_fragancias (
  id             CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  nombre         VARCHAR(80) NOT NULL,
  presentacion_g DECIMAL(10,2) NOT NULL DEFAULT 1000 CHECK (presentacion_g > 0),
  precio_compra  DECIMAL(12,2) NOT NULL CHECK (precio_compra > 0),
  valor_gramo    DECIMAL(12,4) GENERATED ALWAYS AS (precio_compra / presentacion_g) STORED,
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE velas_pabilos (
  id             CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  talla          VARCHAR(10) NOT NULL,
  longitud_m     DECIMAL(10,2) NOT NULL CHECK (longitud_m > 0),
  precio_carrete DECIMAL(12,2) NOT NULL CHECK (precio_carrete > 0),
  valor_cm       DECIMAL(12,4) GENERATED ALWAYS AS (precio_carrete / longitud_m / 100) STORED,
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE velas_insumos (
  id                   CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  codigo               VARCHAR(30),
  nombre               VARCHAR(120) NOT NULL,
  categoria            VARCHAR(30) NOT NULL CHECK (categoria IN
                       ('recipiente','tapa','empaque','decoracion','identidad','papeleria','proteccion','otro')),
  unidad_costo         VARCHAR(10) NOT NULL CHECK (unidad_costo IN ('unidad','cm','g','hoja','metro')),
  valor_unitario       DECIMAL(12,2) NOT NULL CHECK (valor_unitario > 0),
  cantidad_por_paquete DECIMAL(10,2),
  precio_paquete       DECIMAL(12,2),
  proveedor            VARCHAR(120),
  activo               BOOLEAN NOT NULL DEFAULT true,
  created_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE velas_parametros (
  id                   BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  multiplicador_precio DECIMAL(6,2) NOT NULL DEFAULT 4,
  updated_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
INSERT INTO velas_parametros (id) VALUES (true);

CREATE TABLE concreto_parametros (
  id                     BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  precio_cemento_gramo   DECIMAL(10,4) NOT NULL DEFAULT 2.125,
  precio_marmolina_gramo DECIMAL(10,4) NOT NULL DEFAULT 0.7975,
  costo_agua             DECIMAL(12,2) NOT NULL DEFAULT 400,
  costo_pintura          DECIMAL(12,2) NOT NULL DEFAULT 400,
  costo_sellante         DECIMAL(12,2) NOT NULL DEFAULT 200,
  costo_lija             DECIMAL(12,2) NOT NULL DEFAULT 100,
  costo_mano_obra        DECIMAL(12,2) NOT NULL DEFAULT 3000,
  multiplicador_precio   DECIMAL(6,2)  NOT NULL DEFAULT 3,
  redondeo               INT NOT NULL DEFAULT 100 CHECK (redondeo IN (0, 100, 500, 1000)),
  updated_at             DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
INSERT INTO concreto_parametros (id) VALUES (true);

CREATE TABLE velas_productos (
  id                      CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  nombre                  VARCHAR(150) NOT NULL,
  tipo_vela               VARCHAR(20) NOT NULL DEFAULT 'decorativa' CHECK (tipo_vela IN ('decorativa','decorativa_8','vaso','wax_melt')),
  peso_mezcla_g           DECIMAL(10,2) NOT NULL CHECK (peso_mezcla_g > 0),
  pabilo_id               CHAR(36),
  cm_pabilo               DECIMAL(10,2),
  costo_mano_obra         DECIMAL(12,2) NOT NULL DEFAULT 0,
  multiplicador_precio    DECIMAL(6,2),
  redondeo                INT NOT NULL DEFAULT 100 CHECK (redondeo IN (0,100,500,1000)),
  precio_final_autorizado DECIMAL(12,2),
  notas                   VARCHAR(300),
  activo                  BOOLEAN NOT NULL DEFAULT true,
  usuario_id              CHAR(36),
  created_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (pabilo_id) REFERENCES velas_pabilos(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE velas_producto_ceras (
  producto_id CHAR(36) NOT NULL,
  cera_id     CHAR(36) NOT NULL,
  gramos      DECIMAL(10,2) NOT NULL CHECK (gramos > 0),
  -- Orden de inserción (InnoDB devuelve las filas por llave primaria, no en
  -- el orden en que se agregaron como hacía Postgres).
  orden       BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
  PRIMARY KEY (producto_id, cera_id),
  FOREIGN KEY (producto_id) REFERENCES velas_productos(id) ON DELETE CASCADE,
  FOREIGN KEY (cera_id) REFERENCES velas_ceras(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE velas_producto_fragancias (
  producto_id  CHAR(36) NOT NULL,
  fragancia_id CHAR(36) NOT NULL,
  porcentaje   DECIMAL(5,2) NOT NULL CHECK (porcentaje > 0),
  orden        BIGINT NOT NULL AUTO_INCREMENT UNIQUE, -- orden de inserción
  PRIMARY KEY (producto_id, fragancia_id),
  FOREIGN KEY (producto_id) REFERENCES velas_productos(id) ON DELETE CASCADE,
  FOREIGN KEY (fragancia_id) REFERENCES velas_fragancias(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE velas_producto_insumos (
  id                    CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  producto_id           CHAR(36) NOT NULL,
  insumo_id             CHAR(36),
  nombre_manual         VARCHAR(120),
  valor_unitario_manual DECIMAL(12,2),
  cantidad              DECIMAL(10,2) NOT NULL CHECK (cantidad > 0),
  orden                 BIGINT NOT NULL AUTO_INCREMENT UNIQUE, -- orden de inserción
  CHECK (
    (insumo_id IS NOT NULL AND nombre_manual IS NULL AND valor_unitario_manual IS NULL) OR
    (insumo_id IS NULL AND nombre_manual IS NOT NULL AND valor_unitario_manual IS NOT NULL)
  ),
  -- En MySQL los NULL no chocan en un UNIQUE, así que esto equivale al
  -- índice parcial `WHERE insumo_id IS NOT NULL` de Postgres.
  UNIQUE KEY velas_producto_insumos_catalogo_uq (producto_id, insumo_id),
  FOREIGN KEY (producto_id) REFERENCES velas_productos(id) ON DELETE CASCADE,
  FOREIGN KEY (insumo_id) REFERENCES velas_insumos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

-- ============================================================================
-- Inventario de Migao
-- ============================================================================

CREATE TABLE migao_inventario_categorias (
  id     INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) UNIQUE NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE migao_inventario_productos (
  id                    CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  nombre                VARCHAR(120) NOT NULL,
  categoria_id          INT,
  unidad_medida         VARCHAR(30) NOT NULL,
  unidades_por_paquete  DECIMAL(10,2) NOT NULL DEFAULT 1 CHECK (unidades_por_paquete > 0),
  tamano_unidad         VARCHAR(30),
  costo_paquete         DECIMAL(12,2),
  stock_unidades        DECIMAL(12,3) NOT NULL DEFAULT 0,
  stock_minimo_unidades DECIMAL(12,3),
  activo                BOOLEAN NOT NULL DEFAULT true,
  created_at            DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (categoria_id) REFERENCES migao_inventario_categorias(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE migao_inventario_movimientos (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  producto_id        CHAR(36) NOT NULL,
  tipo               VARCHAR(20) NOT NULL CHECK (tipo IN ('entrada','ajuste','consumo')),
  cantidad_unidades  DECIMAL(12,3) NOT NULL,
  motivo             VARCHAR(200),
  referencia_entidad VARCHAR(40),
  referencia_id      VARCHAR(64),
  usuario_id         CHAR(36) NOT NULL,
  created_at         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (producto_id) REFERENCES migao_inventario_productos(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_migao_inv_mov_producto (producto_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE migao_producto_ingredientes (
  id                     BIGINT AUTO_INCREMENT PRIMARY KEY,
  producto_id            CHAR(36) NOT NULL,
  inventario_producto_id CHAR(36) NOT NULL,
  cantidad_por_unidad    DECIMAL(10,3) NOT NULL CHECK (cantidad_por_unidad > 0),
  UNIQUE (producto_id, inventario_producto_id),
  FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE,
  FOREIGN KEY (inventario_producto_id) REFERENCES migao_inventario_productos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE migao_base_recetas (
  id                  CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  base_producto_id    CHAR(36) NOT NULL,
  amasijo_producto_id CHAR(36) NOT NULL,
  cantidad_amasijo    DECIMAL(12,3) NOT NULL CHECK (cantidad_amasijo > 0),
  created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE (base_producto_id, amasijo_producto_id),
  FOREIGN KEY (base_producto_id) REFERENCES migao_inventario_productos(id) ON DELETE CASCADE,
  FOREIGN KEY (amasijo_producto_id) REFERENCES migao_inventario_productos(id) ON DELETE CASCADE,
  INDEX idx_migao_base_recetas_base (base_producto_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE promociones (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  producto_id  CHAR(36) NOT NULL,
  tipo         VARCHAR(20) NOT NULL CHECK (tipo IN ('porcentaje','monto_fijo')),
  valor        DECIMAL(12,2) NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin    DATE NOT NULL,
  activo       BOOLEAN NOT NULL DEFAULT true,
  CHECK (fecha_fin >= fecha_inicio),
  FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE ventas (
  id                   CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  modulo_id            SMALLINT NOT NULL,
  cliente_id           CHAR(36),
  usuario_id           CHAR(36),
  orden_id             CHAR(36),
  subtotal             DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuento            DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuento_porcentaje DECIMAL(5,2) NOT NULL DEFAULT 0,
  impuestos            DECIMAL(12,2) NOT NULL DEFAULT 0,
  total                DECIMAL(12,2) NOT NULL DEFAULT 0,
  estado               VARCHAR(20) NOT NULL DEFAULT 'completada' CHECK (estado IN ('completada','anulada')),
  created_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (modulo_id) REFERENCES modulos(id),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_ventas_modulo_fecha (modulo_id, created_at),
  INDEX idx_ventas_cliente (cliente_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE venta_items (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  venta_id        CHAR(36) NOT NULL,
  producto_id     CHAR(36) NOT NULL,
  cantidad        DECIMAL(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario DECIMAL(12,2) NOT NULL,
  subtotal        DECIMAL(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
  FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES productos(id),
  INDEX idx_venta_items_venta (venta_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE caja_ingreso_items (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  venta_id        CHAR(36) NOT NULL,
  -- Producto del catálogo elegido en el autocompletar (NULL = texto libre).
  producto_id     CHAR(36) NULL,
  nombre          TEXT NOT NULL,
  cantidad        DECIMAL(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario DECIMAL(12,2) NOT NULL,
  -- Igual que en con_sentido_venta_items: por qué quedó en stock negativo.
  observacion_inventario TEXT NULL,
  subtotal        DECIMAL(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
  FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE,
  CONSTRAINT fk_caja_ingreso_items_producto
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL,
  INDEX idx_caja_ingreso_items_venta (venta_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

-- ============================================================================
-- 6. MIGAO (POS / Cafetería)
-- ============================================================================

CREATE TABLE zonas (
  id     INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE mesas (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  zona_id   INT,
  numero    VARCHAR(10) NOT NULL,
  piso      SMALLINT NOT NULL DEFAULT 1,
  capacidad INT NOT NULL DEFAULT 4,
  estado    VARCHAR(20) NOT NULL DEFAULT 'libre'
            CHECK (estado IN ('libre','ocupada','reservada','en_limpieza')),
  pos_x     DECIMAL(5,2),
  pos_y     DECIMAL(5,2),
  ancho     DECIMAL(5,2),
  alto      DECIMAL(5,2),
  activo    BOOLEAN NOT NULL DEFAULT true,
  -- Reemplazo del índice único parcial (numero, piso) WHERE zona_id IS NULL.
  numero_piso_sin_zona VARCHAR(20) GENERATED ALWAYS AS (IF(zona_id IS NULL, CONCAT(numero, '|', piso), NULL)) STORED,
  UNIQUE (zona_id, numero, piso),
  UNIQUE KEY uq_mesas_numero_piso_sin_zona (numero_piso_sin_zona),
  FOREIGN KEY (zona_id) REFERENCES zonas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE ordenes (
  id              CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  mesa_id         INT,
  mesero_id       CHAR(36),
  cliente_id      CHAR(36),
  nombre          VARCHAR(120),
  -- Antes DEFAULT nextval('comensal_seq'): ahora lo asigna el INSERT con
  -- nextval('comensal_seq'), que el backend resuelve contra `secuencias`.
  comensal_numero INT NOT NULL,
  numero_personas SMALLINT,
  estado          VARCHAR(20) NOT NULL DEFAULT 'abierta'
                  CHECK (estado IN ('abierta','en_preparacion','servida','pagando','cerrada','cancelada')),
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  closed_at       DATETIME(6),
  FOREIGN KEY (mesa_id) REFERENCES mesas(id),
  FOREIGN KEY (mesero_id) REFERENCES usuarios(id),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  INDEX idx_ordenes_mesa (mesa_id),
  INDEX idx_ordenes_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

ALTER TABLE ventas ADD CONSTRAINT fk_ventas_orden FOREIGN KEY (orden_id) REFERENCES ordenes(id);

CREATE TABLE orden_items (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  orden_id        CHAR(36) NOT NULL,
  producto_id     CHAR(36) NOT NULL,
  cantidad        DECIMAL(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario DECIMAL(12,2) NOT NULL,
  estado          VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','preparando','listo','servido','cancelado')),
  listo_cocina    BOOLEAN NOT NULL DEFAULT false,
  observaciones   VARCHAR(300),
  venta_id        CHAR(36),
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (orden_id) REFERENCES ordenes(id) ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES productos(id),
  FOREIGN KEY (venta_id) REFERENCES ventas(id),
  INDEX idx_orden_items_orden (orden_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE orden_historial (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  orden_id      CHAR(36) NOT NULL,
  orden_item_id BIGINT,
  accion        VARCHAR(40) NOT NULL
                CHECK (accion IN (
                  'item_agregado', 'item_editado', 'item_cancelado', 'item_entregado',
                  'item_preparando', 'item_listo'
                )),
  detalle       JSON,
  usuario_id    CHAR(36),
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (orden_id) REFERENCES ordenes(id) ON DELETE CASCADE,
  FOREIGN KEY (orden_item_id) REFERENCES orden_items(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_orden_historial_orden (orden_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE migao_cuenta_partes (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  venta_id     CHAR(36) NOT NULL,
  indice       INT NOT NULL,
  modo         VARCHAR(20) NOT NULL CHECK (modo IN ('producto','igual')),
  monto_debido DECIMAL(12,2) NOT NULL CHECK (monto_debido > 0),
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE (venta_id, indice),
  FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE migao_cuenta_parte_unidades (
  parte_id      CHAR(36) NOT NULL,
  orden_item_id BIGINT NOT NULL,
  cantidad      DECIMAL(10,3) NOT NULL CHECK (cantidad > 0),
  PRIMARY KEY (parte_id, orden_item_id),
  FOREIGN KEY (parte_id) REFERENCES migao_cuenta_partes(id) ON DELETE CASCADE,
  FOREIGN KEY (orden_item_id) REFERENCES orden_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE pagos (
  id                      CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  orden_id                CHAR(36),
  venta_id                CHAR(36),
  metodo_pago             VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo','banco','administrativo')),
  monto                   DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  referencia              TEXT,
  parte_id                CHAR(36),
  usuario_id              CHAR(36),
  created_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  monto_recibido_efectivo DECIMAL(12,2),
  vuelto_efectivo         DECIMAL(12,2),
  CHECK (orden_id IS NOT NULL OR venta_id IS NOT NULL),
  FOREIGN KEY (orden_id) REFERENCES ordenes(id),
  FOREIGN KEY (venta_id) REFERENCES ventas(id),
  FOREIGN KEY (parte_id) REFERENCES migao_cuenta_partes(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE migao_propinas_liquidaciones (
  id             CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  monto_efectivo DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_banco    DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto          DECIMAL(12,2) NOT NULL,
  nota           VARCHAR(200),
  fecha_desde    DATE,
  fecha_hasta    DATE,
  -- Columna vieja (antes de separar efectivo/banco), solo informativa.
  metodo_pago    VARCHAR(20),
  usuario_id     CHAR(36),
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CHECK (monto_efectivo > 0 OR monto_banco > 0),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE migao_propinas_entregas (
  id              CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  liquidacion_id  CHAR(36) NOT NULL,
  nombre_persona  VARCHAR(120) NOT NULL,
  metodo_pago     VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo','banco')),
  monto           DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  fecha_entrega   DATE NOT NULL DEFAULT (CURRENT_DATE),
  motivo          VARCHAR(300),
  usuario_id      CHAR(36),
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (liquidacion_id) REFERENCES migao_propinas_liquidaciones(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_migao_propinas_entregas_liquidacion (liquidacion_id),
  INDEX idx_migao_propinas_entregas_fecha (fecha_entrega DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE migao_propinas (
  id             CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  orden_id       CHAR(36) NOT NULL,
  venta_id       CHAR(36) NOT NULL,
  mesero_id      CHAR(36),
  usuario_id     CHAR(36),
  monto          DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  porcentaje     DECIMAL(5,2),
  metodo_pago    VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo','banco')),
  liquidacion_id CHAR(36),
  parte_id       CHAR(36),
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (orden_id) REFERENCES ordenes(id),
  FOREIGN KEY (venta_id) REFERENCES ventas(id),
  FOREIGN KEY (mesero_id) REFERENCES usuarios(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (liquidacion_id) REFERENCES migao_propinas_liquidaciones(id),
  FOREIGN KEY (parte_id) REFERENCES migao_cuenta_partes(id),
  INDEX idx_migao_propinas_mesero (mesero_id),
  INDEX idx_migao_propinas_fecha (created_at DESC),
  INDEX idx_migao_propinas_liquidacion (liquidacion_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE migao_cotizaciones (
  id               CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  numero           BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
  cliente_nombre   VARCHAR(150),
  cliente_telefono VARCHAR(30),
  nota             VARCHAR(300),
  subtotal         DECIMAL(12,2) NOT NULL DEFAULT 0,
  total            DECIMAL(12,2) NOT NULL DEFAULT 0,
  usuario_id       CHAR(36),
  created_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  venta_id         CHAR(36),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (venta_id) REFERENCES ventas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE migao_cotizacion_items (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  cotizacion_id   CHAR(36) NOT NULL,
  nombre          VARCHAR(150) NOT NULL,
  cantidad        DECIMAL(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario DECIMAL(12,2) NOT NULL,
  subtotal        DECIMAL(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
  FOREIGN KEY (cotizacion_id) REFERENCES migao_cotizaciones(id) ON DELETE CASCADE,
  INDEX idx_migao_cotizacion_items_cotizacion (cotizacion_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE facturas (
  id                   CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  venta_id             CHAR(36),
  orden_id             CHAR(36),
  pedido_id            CHAR(36),
  con_sentido_venta_id CHAR(36),
  numero               VARCHAR(30) UNIQUE NOT NULL,
  tipo                 VARCHAR(20) NOT NULL DEFAULT 'ticket' CHECK (tipo IN ('ticket','factura')),
  subtotal             DECIMAL(12,2) NOT NULL,
  impuestos            DECIMAL(12,2) NOT NULL DEFAULT 0,
  total                DECIMAL(12,2) NOT NULL,
  created_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CHECK (venta_id IS NOT NULL OR orden_id IS NOT NULL OR pedido_id IS NOT NULL OR con_sentido_venta_id IS NOT NULL),
  -- Una sola factura por venta (los NULL no chocan en un UNIQUE de MySQL).
  UNIQUE KEY idx_facturas_venta_unica (venta_id),
  UNIQUE KEY idx_facturas_con_sentido_venta_unica (con_sentido_venta_id),
  FOREIGN KEY (venta_id) REFERENCES ventas(id),
  FOREIGN KEY (orden_id) REFERENCES ordenes(id),
  FOREIGN KEY (con_sentido_venta_id) REFERENCES con_sentido_ventas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

-- ============================================================================
-- 7. PEDIDOS / ENCARGOS
-- ============================================================================

CREATE TABLE pedidos (
  id                      CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  cliente_id              CHAR(36) NULL,
  descripcion             TEXT NOT NULL,
  fecha_entrega           DATE NOT NULL,
  destinatario_nombre     VARCHAR(150) NULL,
  destinatario_documento  VARCHAR(30) NULL,
  destinatario_telefono   VARCHAR(30) NULL,
  direccion_envio         VARCHAR(250) NULL,
  ciudad_envio            VARCHAR(100) NULL,
  transportadora          VARCHAR(100) NULL,
  numero_guia             VARCHAR(100) NULL,
  -- Cómo se entregó al marcar "enviado" — null hasta ese momento.
  metodo_envio            VARCHAR(20) NULL
                           CHECK (metodo_envio IN ('transportadora','recoge_tienda','plataforma')),
  conductor_nombre        VARCHAR(150) NULL,
  conductor_placa         VARCHAR(20) NULL,
  conductor_descripcion   TEXT NULL,
  notas_entrega           TEXT NULL,
  costo_estimado          DECIMAL(12,2) NOT NULL DEFAULT 0,
  precio_acordado         DECIMAL(12,2) NOT NULL DEFAULT 0,
  estado                  VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                           CHECK (estado IN ('pendiente','alistado','enviado','entregado','cancelado')),
  responsable_id          CHAR(36) NULL,
  creado_por_id           CHAR(36) NULL,
  alistado_en             DATETIME(6) NULL,
  enviado_en              DATETIME(6) NULL,
  entregado_en            DATETIME(6) NULL,
  proxima_alarma_en       DATETIME(6) NULL,
  created_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (responsable_id) REFERENCES usuarios(id),
  FOREIGN KEY (creado_por_id) REFERENCES usuarios(id),
  INDEX idx_pedidos_cliente (cliente_id),
  INDEX idx_pedidos_estado_fecha (estado, fecha_entrega),
  INDEX idx_pedidos_proxima_alarma (proxima_alarma_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

ALTER TABLE facturas ADD CONSTRAINT fk_facturas_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos(id);
CREATE UNIQUE INDEX idx_facturas_pedido_unica ON facturas(pedido_id);

CREATE TABLE pedido_items (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  pedido_id       CHAR(36) NOT NULL,
  producto_id     CHAR(36) NULL,
  sku             VARCHAR(50) NULL,
  nombre          VARCHAR(150) NOT NULL,
  cantidad        DECIMAL(12,3) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES productos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE INDEX idx_pedido_items_pedido ON pedido_items(pedido_id);

CREATE TABLE pedido_abonos (
  id          CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  pedido_id   CHAR(36) NOT NULL,
  monto       DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  metodo_pago VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo','banco')),
  usuario_id  CHAR(36),
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_pedido_abonos_pedido (pedido_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE pedido_historial (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  pedido_id   CHAR(36) NOT NULL,
  accion      VARCHAR(30) NOT NULL,
  detalle     JSON NULL,
  usuario_id  CHAR(36) NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_pedido_historial_pedido (pedido_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE pedidos_parametros (
  id                        BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  intervalo_alarma_minutos  INT NOT NULL DEFAULT 30,
  updated_at                DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
INSERT INTO pedidos_parametros (id) VALUES (true);

-- ============================================================================
-- 8. SEED MINIMO DE MODULOS
-- ============================================================================
-- Nota: si vas a importar los datos migrados desde Supabase, el archivo de
-- datos vacía y vuelve a llenar esta tabla con los ids originales.

INSERT INTO modulos (slug, nombre) VALUES
  ('general', 'Módulo general'),
  ('insumos', 'Insumos'),
  ('talleres', 'Talleres / Experiencias'),
  ('con_sentido', 'Con Sentido'),
  ('migao', 'Migao (POS)'),
  ('pedidos', 'Pedidos / Encargos');

SET FOREIGN_KEY_CHECKS = 1;
