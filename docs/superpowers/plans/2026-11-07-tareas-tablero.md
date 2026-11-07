# Módulo Tareas — Tablero compartido por área — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tablero tipo Scrum dentro del módulo Tareas — Root/Super Root publica una tarea suelta para un área (texto libre) y una fecha; cualquier usuario puede unirse; solo quien está unido (o Root/Super Root) puede cerrarla. Estado compartido para todo el que participe, sin confirmación por persona.

**Architecture:** Dos tablas nuevas (`tareas_scrum`, `tareas_scrum_participantes`) agregadas al módulo backend `tareas/` ya existente (mismos archivos, funciones nuevas — no un módulo aparte). Sin permisos nuevos: reutiliza `tareas.ver_propias`/`tareas.gestionar`. Pestaña frontend nueva "Tablero", separada de "Mis tareas"/"Administrar tareas".

**Tech Stack:** Backend: Express + TypeScript + Zod + `pool.query` (placeholders `$n`). Frontend: React + TypeScript + Tailwind v4. Sin test runner — verificación por `tsc`/`tsc -b` + prueba manual.

**Spec:** `docs/superpowers/specs/2026-11-07-tareas-tablero-design.md`

## Global Constraints

- Sin test runner: cada tarea se verifica con `cd backend && npm run typecheck` / `cd frontend && npx tsc -b --noEmit`, más una prueba manual.
- SQL: `CHAR(36) ... DEFAULT (UUID())`, `DATETIME(6)`, snake_case, placeholders `$1,$2,...` — seguir el estilo exacto de `database/mysql/migraciones/2026-11-03_modulo_tareas.sql` y `backend/src/modules/tareas/tareas.repository.ts`.
- "Hoy" cuando `?fecha=` viene vacío se resuelve con `SELECT CURDATE() AS hoy` vía `pool.query` (ya existe `resolverFecha` en `tareas.routes.ts` — reutilizarla, no reimplementarla), nunca `new Date()` en Node.
- Permisos: nunca comparar `rol_nombre`/`rolId` a mano — todo gateo pasa por `requirePermission(codigo)` en las rutas y `tienePermiso(rolId, codigo)` en el service, exactamente como ya hace el resto de `tareas.routes.ts`/`tareas.service.ts`. Sin permisos nuevos: `tareas.ver_propias` y `tareas.gestionar` ya existen y ya están otorgados a los roles correctos.
- Esta funcionalidad vive DENTRO de los archivos existentes del módulo `tareas` (`tareas.types.ts`, `tareas.repository.ts`, `tareas.service.ts`, `tareas.routes.ts`) — se agregan funciones/tipos nuevos, no se crea un módulo backend aparte.
- Frontend: tonos verdes pastel ya establecidos en toda la plataforma — sin colores nuevos.

## Review Focus

- **Doble clic en "Unirme"**: no debe crear una fila duplicada ni lanzar un error — la operación debe ser idempotente (`ON DUPLICATE KEY` o equivalente contra la PK compuesta).
- **Cerrar una tarea ya cerrada**: debe devolver un error claro (409), no sobreescribir `cerrado_en`/`cerrado_por_id` de la primera vez que se cerró.
- **Cerrar sin estar unido y sin `tareas.gestionar`**: debe devolver 403 — nadie ajeno a la tarea puede cerrarla por otros.
- **Salir de una tarea ya cerrada**: no debe fallar ni reabrirla — simplemente ya no aparece en la lista de participantes de una tarea que de todas formas sigue cerrada.
- **"Hoy" consistente**: el tablero debe resolver "hoy" igual que el resto del módulo (`CURDATE()` en SQL), no con la fecha local del navegador, para no desincronizarse del resto de Tareas.

---

### Task 1: Migración de base de datos

**Files:**
- Create: `database/mysql/migraciones/2026-11-07_tareas_scrum.sql`

**Interfaces:**
- Produces: tablas `tareas_scrum` y `tareas_scrum_participantes` (columnas exactas en la Spec §1).

- [ ] **Paso 1: Escribir la migración** con el CREATE TABLE exacto de la Spec §1 para ambas tablas (incluye el índice `idx_tareas_scrum_fecha`). Sin `modulos`/`permisos`/`roles_permisos` que insertar — este tablero reutiliza los permisos ya existentes del módulo `tareas`.

- [ ] **Paso 2: Correr la migración contra la base de datos de desarrollo.**

- [ ] **Paso 3: Verificar**

```sql
DESCRIBE tareas_scrum;
DESCRIBE tareas_scrum_participantes;
```
Expected: ambas tablas existen con las columnas de la Spec §1, sin filas.

- [ ] **Paso 4: Commit**

```bash
git add database/mysql/migraciones/2026-11-07_tareas_scrum.sql
git commit -m "feat(tareas): migración del tablero compartido (scrum) por área"
```

---

### Task 2: Tipos y repositorio

**Files:**
- Modify: `backend/src/modules/tareas/tareas.types.ts`
- Modify: `backend/src/modules/tareas/tareas.repository.ts`

**Interfaces:**
- Consumes: tablas de Task 1.
- Produces (usado por Task 3):
  - `type EstadoTareaScrum = 'abierta' | 'cerrada'`
  - `interface TareaScrum { id: string; titulo: string; area: string; descripcion: string | null; fecha: string; estado: EstadoTareaScrum; creadoPorId: string; cerradoPorId: string | null; cerradoEn: string | null; }`
  - `interface ParticipanteScrum { usuarioId: string; nombre: string; }`
  - `crearTareaScrum(datos: { titulo: string; area: string; descripcion: string | null; fecha: string; creadoPorId: string }): Promise<TareaScrum>`
  - `listarTareasScrumDelDia(fecha: string): Promise<TareaScrum[]>` — todas las tareas de esa fecha, sin participantes (eso es una consulta aparte, Task 3 las combina).
  - `listarParticipantes(tareaId: string): Promise<ParticipanteScrum[]>` — un `JOIN` a `usuarios` para el nombre.
  - `listarParticipantesDeVariasTareas(tareaIds: string[]): Promise<Map<string, ParticipanteScrum[]>>` — para no hacer N consultas (una por tarea) al listar el tablero completo de un día; agrupa por `tarea_id`.
  - `estaUnido(tareaId: string, usuarioId: string): Promise<boolean>`
  - `unirseATarea(tareaId: string, usuarioId: string): Promise<void>` — `INSERT ... ON DUPLICATE KEY UPDATE usuario_id = usuario_id` (no-op, idempotente — mismo patrón que `generarInstanciasFaltantes` en este mismo archivo).
  - `salirDeTarea(tareaId: string, usuarioId: string): Promise<void>` — `DELETE`, idempotente (no falla si ya no estaba).
  - `obtenerTareaScrumPorId(id: string): Promise<TareaScrum | null>`
  - `cerrarTareaScrum(id: string, cerradoPorId: string): Promise<TareaScrum | null>` — `UPDATE ... SET estado='cerrada', cerrado_por_id=$2, cerrado_en=now() WHERE id=$1 AND estado='abierta' RETURNING ...` (el `AND estado='abierta'` en el WHERE es lo que hace que cerrar dos veces no pise `cerrado_en`: la segunda vez `rowCount` es 0).

- [ ] **Paso 1: Agregar los tipos a `tareas.types.ts`.**

- [ ] **Paso 2: Agregar las funciones a `tareas.repository.ts`**, siguiendo el estilo ya usado en ese mismo archivo (mapeo manual de filas, `pool.query` parametrizado).

- [ ] **Paso 3: Verificar**

```bash
cd backend && npm run typecheck
```

- [ ] **Paso 4: Commit**

```bash
git add backend/src/modules/tareas/tareas.types.ts backend/src/modules/tareas/tareas.repository.ts
git commit -m "feat(tareas): tipos y repositorio del tablero compartido"
```

---

### Task 3: Servicio

**Files:**
- Modify: `backend/src/modules/tareas/tareas.service.ts`

**Interfaces:**
- Consumes: todo lo de Task 2.
- Produces (usado por Task 4):
  - `crearTareaScrum(datos: { titulo: string; area: string; descripcion: string | null; fecha: string }, creadoPorId: string): Promise<TareaScrum>` — valida `titulo`/`area` no vacíos (400 si vienen vacíos tras `trim()`; el resto de la validación de forma ya la hace Zod en la ruta).
  - `listarTableroDelDia(fecha: string, usuarioId: string): Promise<(TareaScrum & { participantes: ParticipanteScrum[]; yaUnido: boolean })[]>` — combina `listarTareasScrumDelDia` + `listarParticipantesDeVariasTareas` (una sola consulta extra, no N) + marca `yaUnido` comparando contra `usuarioId`.
  - `unirseATareaScrum(tareaId: string, usuarioId: string): Promise<void>` — 404 si la tarea no existe; no valida que esté abierta (unirse a una ya cerrada es inofensivo, simplemente no podrá cerrarla de nuevo — ver cerrarTareaScrum).
  - `salirDeTareaScrum(tareaId: string, usuarioId: string): Promise<void>` — igual, 404 si no existe.
  - `cerrarTareaScrum(params: { tareaId: string; llamadorId: string; llamadorPuedeGestionar: boolean }): Promise<TareaScrum>` — 404 si no existe; si `!llamadorPuedeGestionar`, exige `estaUnido(tareaId, llamadorId)` (403 si no); si la tarea ya está `cerrada`, 409 (`Errors.conflict`).

- [ ] **Paso 1: Implementar las 4 funciones** en `tareas.service.ts`, importando `Errors` (ya importado en ese archivo) para 400/403/404/409.

- [ ] **Paso 2: Verificar manualmente la idempotencia de unirse/cerrar**

Script descartable (`backend/scripts/`, con `tsx`) contra la DB de desarrollo: crear una tarea de prueba, llamar `unirseATareaScrum` dos veces seguidas (confirmar por SQL que sigue habiendo 1 sola fila en `tareas_scrum_participantes`), cerrar dos veces seguidas (confirmar que la segunda lanza el 409 y que `cerrado_en` no cambió). Borrar el script y los datos de prueba al terminar.

- [ ] **Paso 3: Verificar**

```bash
cd backend && npm run typecheck
```

- [ ] **Paso 4: Commit**

```bash
git add backend/src/modules/tareas/tareas.service.ts
git commit -m "feat(tareas): servicio del tablero compartido (unirse/salir/cerrar)"
```

---

### Task 4: Rutas

**Files:**
- Modify: `backend/src/modules/tareas/tareas.routes.ts`

**Interfaces:**
- Consumes: servicio de Task 3.
- Produces: los 5 endpoints de la Spec §3 bajo `/api/v1/tareas/scrum`.

- [ ] **Paso 1: Agregar los 5 endpoints**, siguiendo el patrón exacto ya usado en este mismo archivo (`requirePermission`, `tienePermiso` para calcular `llamadorPuedeGestionar`, `resolverFecha` ya existente para `GET /scrum?fecha=`):
  - `GET /scrum?fecha=` → `tareas.ver_propias`, llama `listarTableroDelDia(fechaResuelta, req.auth!.usuarioId)`.
  - `POST /scrum` → `tareas.gestionar`, body `{ titulo, area, descripcion?, fecha? }` (Zod: `titulo`/`area` strings no vacíos, `fecha` con el mismo `fechaOpcionalSchema` ya definido en este archivo, resuelta con `resolverFecha` si viene vacía).
  - `POST /scrum/:id/unirse` → `tareas.ver_propias`.
  - `POST /scrum/:id/salir` → `tareas.ver_propias`.
  - `POST /scrum/:id/cerrar` → `tareas.ver_propias` (el override de `tareas.gestionar` se calcula igual que en `PATCH /instancias/:id/estado`, con `tienePermiso`).

- [ ] **Paso 2: Verificar**

```bash
cd backend && npm run typecheck && npm run dev
```
Con el servidor arriba, probar con `curl` (token real): crear una tarea, unirse con otro usuario, confirmar 403 al cerrar desde un tercer usuario no unido y sin `tareas.gestionar`, confirmar 200 al cerrar desde quien sí está unido, confirmar 409 al cerrar de nuevo.

- [ ] **Paso 3: Commit**

```bash
git add backend/src/modules/tareas/tareas.routes.ts
git commit -m "feat(tareas): endpoints del tablero compartido"
```

---

### Task 5: Cliente API frontend

**Files:**
- Modify: `frontend/src/modules/tareas/api.ts`

**Interfaces:**
- Consumes: endpoints de Task 4.
- Produces (usado por Tasks 6-7): tipos `EstadoTareaScrum`/`TareaScrum`/`ParticipanteScrum` espejo de los de Task 2, más `TareaScrumConParticipantes extends TareaScrum { participantes: ParticipanteScrum[]; yaUnido: boolean }`, y funciones `listarTablero(fecha?)`, `crearTareaScrum(datos)`, `unirseATarea(id)`, `salirDeTarea(id)`, `cerrarTarea(id)`.

- [ ] **Paso 1: Agregar los tipos y funciones a `api.ts`**, siguiendo el estilo ya usado ahí (mismo wrapper `apiFetch`).

- [ ] **Paso 2: Verificar**

```bash
cd frontend && npx tsc -b --noEmit
```

- [ ] **Paso 3: Commit**

```bash
git add frontend/src/modules/tareas/api.ts
git commit -m "feat(tareas): cliente API del tablero compartido"
```

---

### Task 6: Página "Tablero" (ver, unirse, salir, cerrar)

**Files:**
- Create: `frontend/src/modules/tareas/pages/TableroPage.tsx`
- Create: `frontend/src/modules/tareas/components/TareaScrumCard.tsx`

**Interfaces:**
- Consumes: `api.ts` de Task 5.

- [ ] **Paso 1: `TareaScrumCard.tsx`** — tarjeta de una tarea: título, descripción, lista de nombres de participantes, y según `yaUnido`/`estado`: botón "Unirme" (si no unido y abierta), botones "Salir" + "Cerrar" (si unido y abierta), nada interactivo si `cerrada` (solo una marca visual de "Cerrada", atenuada — tono verde pastel, no roja).

- [ ] **Paso 2: `TableroPage.tsx`** — selector de fecha (default hoy), agrupa las tarjetas por `area` (un encabezado por área, igual estilo que las columnas de `TareasPage.tsx`), llama `listarTablero(fecha)`; cada acción (unirse/salir/cerrar) refresca la tarjeta. Estado vacío con mensaje si no hay tareas ese día.

- [ ] **Paso 3: Verificar**

```bash
cd frontend && npx tsc -b --noEmit
```
Manualmente: confirmar que el botón "Cerrar" solo aparece para quien está unido (o tiene acceso total), y que una tarea sin ninguna tarea ese día muestra el estado vacío sin romperse.

- [ ] **Paso 4: Commit**

```bash
git add frontend/src/modules/tareas/pages/TableroPage.tsx frontend/src/modules/tareas/components/TareaScrumCard.tsx
git commit -m "feat(tareas): pantalla del tablero compartido"
```

---

### Task 7: Creación de tareas (Root/Super Root)

**Files:**
- Create: `frontend/src/modules/tareas/components/NuevaTareaScrumModal.tsx`
- Modify: `frontend/src/modules/tareas/pages/TableroPage.tsx`

**Interfaces:**
- Consumes: `api.ts` de Task 5; se monta desde `TableroPage.tsx` (Task 6).

- [ ] **Paso 1: `NuevaTareaScrumModal.tsx`** — formulario: título, área (input de texto con `<datalist>` o similar sugiriendo las áreas ya vistas en las tareas cargadas de `TableroPage`, sin restringir a esa lista), descripción (opcional), fecha (default hoy). Llama `crearTareaScrum`.

- [ ] **Paso 2: Agregar a `TableroPage.tsx`** un botón "+ Nueva tarea" visible solo para quien tiene acceso total (mismo patrón ya usado en otras pantallas: `tieneAccesoTotal(usuario?.rol)` de `shared/auth/roles.ts`), que abre el modal; al guardar, refresca el tablero.

- [ ] **Paso 3: Verificar**

```bash
cd frontend && npx tsc -b --noEmit
```
Manualmente: crear una tarea para un área nueva y confirmar que aparece agrupada correctamente en el tablero; crear una segunda tarea reusando la misma área y confirmar que el autocompletar la sugiere.

- [ ] **Paso 4: Commit**

```bash
git add frontend/src/modules/tareas/components/NuevaTareaScrumModal.tsx frontend/src/modules/tareas/pages/TableroPage.tsx
git commit -m "feat(tareas): creación de tareas del tablero (Root/Super Root)"
```

---

### Task 8: Navegación

**Files:**
- Modify: `frontend/src/shared/layout/modules-meta.ts`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: página de Tasks 6-7.

- [ ] **Paso 1: Agregar a `MODULES_META`**

```ts
{ slug: "tareas", label: "Tablero", path: "/tareas/tablero", icon: "🗒️" },
```
Sin filtro `roles` (visible a los 6 roles + Apartamento, como "Tareas").

- [ ] **Paso 2: Agregar la ruta** en `App.tsx`, mismo patrón que `/tareas` y `/tareas/administrar`.

- [ ] **Paso 3: Verificar**

```bash
cd frontend && npx tsc -b --noEmit
```
Manualmente: confirmar que "Tablero" aparece en el menú para un rol normal y para Root/Super Root por igual.

- [ ] **Paso 4: Commit**

```bash
git add frontend/src/shared/layout/modules-meta.ts frontend/src/App.tsx
git commit -m "feat(tareas): agregar la pestaña Tablero a la navegación"
```
