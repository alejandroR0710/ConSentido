# Módulo Tareas — Tablero compartido por área — diseño

**Fecha:** 2026-11-07
**Estado:** Aprobado en brainstorming, pendiente de plan de implementación.

## 0. Qué es (y en qué se diferencia de lo que ya existe)

El módulo Tareas ya tiene un sistema de **rutina recurrente**: Root/Super Root
define plantillas por rol o por una persona puntual, y cada quien tiene su
propia tarea privada, generada sola día por día.

Esto es distinto: un **tablero tipo Scrum**, compartido. Root/Super Root
publica una tarea suelta para un área (texto libre, ej. "Cocina" → "Lavar
neveras"), y **cualquier usuario** que la vea puede unirse a ella. La tarea
tiene un solo estado compartido para todo el que participe — no hay
confirmación por persona. Solo quien está unido puede cerrarla.

**Fuera de alcance de esta versión:** recurrencia automática (cada tarea se
publica a mano, el día que haga falta); restricción de área por rol (el
área es solo una etiqueta, visible y abierta a todos); notificaciones.

## 1. Modelo de datos

```sql
CREATE TABLE tareas_scrum (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  titulo        VARCHAR(150) NOT NULL,
  area          VARCHAR(80) NOT NULL,
  descripcion   TEXT NULL,
  fecha         DATE NOT NULL,
  estado        VARCHAR(10) NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada')),
  creado_por_id CHAR(36) NOT NULL,
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  cerrado_por_id CHAR(36) NULL,
  cerrado_en    DATETIME(6) NULL,
  FOREIGN KEY (creado_por_id) REFERENCES usuarios(id),
  FOREIGN KEY (cerrado_por_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE INDEX idx_tareas_scrum_fecha ON tareas_scrum(fecha);

CREATE TABLE tareas_scrum_participantes (
  tarea_id   CHAR(36) NOT NULL,
  usuario_id CHAR(36) NOT NULL,
  unido_en   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (tarea_id, usuario_id),
  FOREIGN KEY (tarea_id) REFERENCES tareas_scrum(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
```

**Por qué dos tablas:** la tarea es una fila (un solo estado compartido);
quién participa es una relación muchos-a-muchos aparte — une/sale sin tocar
la tarea misma, y "cerrar" solo lo puede hacer alguien que está en esa
tabla (o Root/Super Root).

**`area` es texto libre**, igual que `titulo` — no hay catálogo de áreas ni
restricción de acceso por ella; es solo para agrupar visualmente el
tablero. El frontend sugiere (autocompletar) las áreas ya usadas antes, sin
imponer una lista cerrada.

**Sin recurrencia:** a diferencia de `tareas_plantilla`, no hay
`dias_semana`/`fecha_unica`/`activo`. Cada fila es una tarea puntual para
`fecha`; publicar "lo mismo" otro día es crear otra fila.

## 2. Permisos (ninguno nuevo)

- `tareas.ver_propias` (los 6 roles + Apartamento) — ver el tablero,
  unirse/salir de una tarea, y cerrarla si ya está unido.
- `tareas.gestionar` (Root/Super Root) — crear una tarea nueva, y cerrar
  cualquiera aunque no esté unido (mismo criterio de "override" que ya usa
  el resto del módulo).

## 3. Backend — endpoints (`backend/src/modules/tareas/`)

- `GET /api/v1/tareas/scrum?fecha=` — tareas de ese día (hoy si se omite,
  mismo `CURDATE()` que el resto del módulo), con su lista de participantes
  (id + nombre) y si el usuario que llama ya está unido. `tareas.ver_propias`.
- `POST /api/v1/tareas/scrum` — crear: `{ titulo, area, descripcion?, fecha? }`
  (fecha por defecto hoy). `tareas.gestionar`.
- `POST /api/v1/tareas/scrum/:id/unirse` — unirse (idempotente: ya unido no
  es error). `tareas.ver_propias`.
- `POST /api/v1/tareas/scrum/:id/salir` — salir (idempotente). `tareas.ver_propias`.
- `POST /api/v1/tareas/scrum/:id/cerrar` — cerrar: exige que el llamador
  esté en `tareas_scrum_participantes` para esa tarea, salvo que tenga
  `tareas.gestionar`. No se puede cerrar una tarea ya cerrada (409).
  `tareas.ver_propias`.

## 4. Frontend

Nueva pestaña **"Tablero"** (todos los roles, sin filtro — como "Tareas"),
separada de "Mis tareas"/"Administrar tareas":

- Selector de fecha (default hoy), tarjetas agrupadas visualmente por
  `area`, cada tarjeta muestra título, descripción, lista de participantes
  (nombres), y:
  - **"Unirme"** si no está unido.
  - **"Salir"** + **"Cerrar"** si ya está unido (y la tarea sigue abierta).
  - Tarjetas cerradas se ven atenuadas/con un check, siguen visibles (no se
    ocultan ni se borran).
- Root/Super Root ven además un botón **"+ Nueva tarea"** (título, área con
  autocompletar de áreas ya usadas, descripción opcional, fecha).

## 5. Migración

`database/mysql/migraciones/2026-11-07_tareas_scrum.sql`: las dos tablas de
arriba. Sin permisos nuevos que insertar (reutiliza los dos que ya existen).
