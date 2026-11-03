# Módulo Tareas / Rutina diaria — diseño

**Fecha:** 2026-11-03
**Estado:** Borrador — pendiente de confirmación antes de pasar a plan de implementación.

## 0. Qué es (y qué no es)

El pedido original lo llama "scrum", pero lo que se describe es un **checklist de
tareas diarias con estado**, no un tablero Scrum literal (sin sprints, backlog,
story points ni ceremonias). Este diseño construye eso: tareas predefinidas por
rol o por usuario, que root/super root pueden editar y agregar — ya sea como
rutina recurrente de un día de la semana, o como algo puntual de un solo día —
con una pestaña propia y estado por tarea.

**Fuera de alcance:** sprints/backlog, asignación múltiple de una misma tarea a
varias personas a la vez (una plantilla por rol genera una tarea POR usuario de
ese rol, no una tarea compartida), notificaciones/recordatorios.

## 1. Modelo de datos

Dos tablas: una de **plantillas** (la regla — qué tarea, para quién, cuándo
aplica) y una de **instancias** (la ocurrencia concreta de un día, con su
estado — lo que el usuario realmente marca).

```sql
CREATE TABLE tareas_plantilla (
  id                CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  titulo            VARCHAR(150) NOT NULL,
  descripcion       TEXT NULL,
  -- Exactamente uno de los dos: la plantilla es de UN rol (todos los usuarios
  -- con ese rol la reciben, cada uno con su propia instancia) o de UN usuario
  -- puntual (asignación directa).
  rol_id            INT NULL,
  usuario_id        CHAR(36) NULL,
  tipo_recurrencia  VARCHAR(10) NOT NULL CHECK (tipo_recurrencia IN ('semanal','unica')),
  -- 'semanal': CSV de días 1=lunes..7=domingo, ej. '1,2,3,4,5'. 'unica': NULL.
  dias_semana       VARCHAR(20) NULL,
  -- 'unica': la fecha puntual. 'semanal': NULL.
  fecha_unica       DATE NULL,
  orden             INT NOT NULL DEFAULT 0,
  activo            BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por_id     CHAR(36) NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (rol_id) REFERENCES roles(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (creado_por_id) REFERENCES usuarios(id),
  CHECK ((rol_id IS NOT NULL) <> (usuario_id IS NOT NULL)),
  CHECK (
    (tipo_recurrencia = 'semanal' AND dias_semana IS NOT NULL AND fecha_unica IS NULL)
    OR (tipo_recurrencia = 'unica' AND fecha_unica IS NOT NULL AND dias_semana IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE tareas_instancia (
  id                CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  plantilla_id      CHAR(36) NOT NULL,
  usuario_id        CHAR(36) NOT NULL,
  fecha             DATE NOT NULL,
  estado            VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                     CHECK (estado IN ('pendiente','en_progreso','completada','omitida')),
  actualizado_por_id CHAR(36) NULL,
  actualizado_en    DATETIME(6) NULL,
  FOREIGN KEY (plantilla_id) REFERENCES tareas_plantilla(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (actualizado_por_id) REFERENCES usuarios(id),
  UNIQUE (plantilla_id, usuario_id, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
```

**Por qué dos tablas:** el estado se marca por día concreto (la de hoy es un
checkbox distinto al de mañana), pero la regla de "quién/cuándo" es recurrente.
Separarlas evita guardar un estado por cada día futuro que aún no ha llegado.

**Generación de instancias — perezosa, sin cron:** cuando alguien abre su
pestaña para una fecha, el backend resuelve qué plantillas activas aplican
(por `rol_id` = su rol, o `usuario_id` = él mismo; y `dias_semana` incluye el
día de la semana de esa fecha, o `fecha_unica` = esa fecha exacta) y crea con
`INSERT ... ON DUPLICATE KEY` las instancias que falten para ese usuario+fecha,
luego devuelve todas. Idempotente, sin necesidad de un job nocturno.

**Tarea puntual para un solo día:** se modela igual que cualquier plantilla,
solo que con `tipo_recurrencia = 'unica'` — no hace falta un camino especial.

## 2. Permisos (módulo nuevo `tareas`)

- `tareas.ver_propias` — ver y cambiar el estado de las propias tareas.
  Se otorga a **los 6 roles existentes** (Super Root, Root, Cajero, Cocina,
  Mesero, Administrador): todos tienen rutina diaria.
- `tareas.gestionar` — crear/editar/desactivar plantillas (de cualquier rol o
  usuario), ver la vista cruzada filtrando por usuario o por rol, y
  sobreescribir el estado de la tarea de cualquier persona. Solo **Root** y
  **Super Root**.

## 3. Backend — endpoints (`backend/src/modules/tareas/`)

- `GET /api/v1/tareas/mias?fecha=` — instancias propias del día (hoy si se
  omite), generándolas si faltan. `tareas.ver_propias`.
- `PATCH /api/v1/tareas/instancias/:id/estado` — cambia el estado de una
  instancia propia. `tareas.ver_propias`, y el service valida que
  `usuario_id` de la instancia sea el del que llama (salvo que tenga
  `tareas.gestionar`).
- `GET /api/v1/tareas/plantillas?rolId=&usuarioId=` — listar plantillas.
  `tareas.gestionar`.
- `POST /api/v1/tareas/plantillas` / `PATCH /api/v1/tareas/plantillas/:id` —
  crear / editar o desactivar (`activo=false`, nunca borrado físico: las
  instancias ya generadas referencian la plantilla). `tareas.gestionar`.
- `GET /api/v1/tareas/vista?fecha=&rolId=&usuarioId=` — vista cruzada
  (todas las instancias de ese día, filtrables por rol o usuario puntual).
  `tareas.gestionar`.

## 4. Frontend (`frontend/src/modules/tareas/`)

- **Pestaña "Tareas"** (todos los roles, sin filtro de `roles` en
  `modules-meta.ts` — transversal como Dashboard): tablero de 3 columnas
  (Pendiente / En progreso / Completada) con las tareas propias del día,
  selector de fecha para ver días pasados. Tonos pasteles verdes, igual
  que el resto de la plataforma.
- **Vista de administración** (solo Root/Super Root, enlace aparte tipo el de
  "Usuarios"): CRUD de plantillas — elegir rol o usuario puntual, recurrente
  (checkboxes de día de semana) o única (selector de fecha) — y la vista
  cruzada filtrable por rol/usuario con el estado de cada quién, con opción
  de sobreescribir un estado manualmente.

## 5. Migración

`database/mysql/migraciones/2026-11-03_modulo_tareas.sql`: las dos tablas,
`INSERT` en `modulos` (slug `tareas`), los dos permisos, y `roles_permisos`
otorgando `tareas.ver_propias` a los 6 roles y `tareas.gestionar` a Root y
Super Root — mismo patrón que la migración de Vales.
