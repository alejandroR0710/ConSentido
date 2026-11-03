# Módulo Tareas / Rutina diaria — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Checklist de tareas diarias por usuario/rol, editable por Root/Super Root (plantillas recurrentes por día de semana o únicas para un día puntual), con pestaña propia y estado por tarea.

**Architecture:** Dos tablas (`tareas_plantilla` = la regla, `tareas_instancia` = la ocurrencia de un día con estado), generación perezosa de instancias al leer, permisos nuevos vía el RBAC ya existente (`roles_permisos`/`permisos`), módulo backend `tareas/` espejo de los módulos existentes (vales, reportes), módulo frontend `tareas/` con dos páginas.

**Tech Stack:** Backend: Express + TypeScript + Zod + `pool.query` (placeholders `$n`, mismo patrón que `usuarios.repository.ts`/`recepcion.ts`). Frontend: React + TypeScript + Tailwind. Sin framework de tests en ningún lado del repo — la verificación es `tsc`/`tsc -b` limpio más una prueba manual (no hay `npm test` en ninguno de los dos `package.json`).

**Spec:** `docs/superpowers/specs/2026-11-03-tareas-rutina-design.md`

## Global Constraints

- Sin test runner: cada tarea se verifica con `cd backend && npm run typecheck` o `cd frontend && npx tsc -b --noEmit`, más una prueba manual descrita en la tarea. No escribir specs/tests — no hay dónde correrlos.
- SQL: UUID PK vía `CHAR(36) ... DEFAULT (UUID())`, `DATETIME(6)`, snake_case, placeholders `$1,$2,...` en `pool.query` — seguir exactamente el estilo de `database/mysql/migraciones/2026-10-05_modulo_vales.sql` y `backend/src/modules/general/usuarios/usuarios.repository.ts`.
- Permisos: nunca comparar `rol_nombre`/`rolId` a mano en una ruta o servicio — todo gateo de acceso pasa por `requirePermission(codigo)` (`backend/src/shared/middlewares/rbac.middleware.ts`), igual que el resto del backend.
- Roles existentes (exactamente estos 6, de `database/mysql/seed.sql`): Super Root, Root, Cajero, Cocina, Mesero, Administrador.
- Frontend: tonos verdes pastel para fondos/estados (preferencia ya establecida en el resto de la plataforma) — no colores saturados nuevos.
- Nunca se borra una plantilla físicamente (tiene instancias históricas enganchadas por FK) — desactivar es `activo = false`.
- "Hoy" cuando no se manda `fecha` explícita se resuelve con `SELECT CURDATE()` en SQL, nunca con `new Date()` en Node — la sesión MySQL ya está fija en -05:00 (`backend/src/shared/db/pool.ts:44-47`), mientras que `new Date()` usa la zona del proceso Node y puede no coincidir cerca de medianoche.

## Review Focus

- **Zona horaria / "hoy":** qué cuenta como el día de hoy debe ser el mismo criterio de día operativo que ya usa el resto del sistema (fecha del servidor, no UTC arbitrario) — si no, una tarea "de hoy" se generaría con el día equivocado cerca de medianoche.
- **Usuario sin ninguna plantilla aplicable ese día:** su tablero debe quedar vacío sin error (nunca un 500 por asumir que siempre hay al menos una instancia).
- **Plantilla desactivada:** `activo = false` detiene la generación de instancias NUEVAS, pero nunca debe borrar ni alterar las instancias ya generadas (el historial de días pasados se conserva intacto).
- **Usuario cuyo rol cambió o fue desactivado:** deja de generar instancias nuevas bajo el rol/plantilla viejo de inmediato, pero sus instancias ya generadas antes del cambio no desaparecen ni se reasignan.
- **Generación concurrente:** dos pedidos simultáneos de "mis tareas de hoy" (dos pestañas abiertas, doble click) no deben crear instancias duplicadas — la combinación `UNIQUE(plantilla_id, usuario_id, fecha)` + `INSERT ... ON DUPLICATE KEY` debe probarse, no solo declararse.

---

### Task 1: Migración de base de datos

**Files:**
- Create: `database/mysql/migraciones/2026-11-03_modulo_tareas.sql`

**Interfaces:**
- Produces: tablas `tareas_plantilla`, `tareas_instancia` (columnas exactas en la Spec §1); módulo `modulos.slug = 'tareas'`; permisos `tareas.ver_propias` (otorgado a los 6 roles) y `tareas.gestionar` (otorgado solo a Root y Super Root).

- [ ] **Paso 1: Escribir la migración**

Usar el CREATE TABLE exacto de la Spec §1 para ambas tablas. Seguir con los
`INSERT` de `modulos`/`permisos`/`roles_permisos` en el mismo estilo que
`database/mysql/migraciones/2026-10-05_modulo_vales.sql` (líneas 54-77):
`INSERT ... SELECT ... WHERE NOT EXISTS` para que sea re-ejecutable sin
duplicar filas.

- [ ] **Paso 2: Correr la migración contra la base de datos de desarrollo**

Ejecutar el archivo contra la DB local (phpMyAdmin o el cliente mysql que use
el proyecto).

- [ ] **Paso 3: Verificar**

```sql
SELECT * FROM tareas_plantilla LIMIT 1;  -- tabla existe, sin filas
SELECT * FROM tareas_instancia LIMIT 1; -- tabla existe, sin filas
SELECT p.codigo, r.nombre FROM roles_permisos rp
  JOIN permisos p ON p.id = rp.permiso_id JOIN roles r ON r.id = rp.rol_id
  WHERE p.codigo LIKE 'tareas.%' ORDER BY p.codigo, r.nombre;
```
Expected: `tareas.ver_propias` con 6 filas (una por rol), `tareas.gestionar`
con 2 filas (Root, Super Root).

- [ ] **Paso 4: Commit**

```bash
git add database/mysql/migraciones/2026-11-03_modulo_tareas.sql
git commit -m "feat(tareas): migración del módulo de tareas/rutina diaria"
```

---

### Task 2: Tipos y repositorio backend

**Files:**
- Create: `backend/src/modules/tareas/tareas.types.ts`
- Create: `backend/src/modules/tareas/tareas.repository.ts`

**Interfaces:**
- Consumes: tablas de Task 1.
- Produces (usado por Task 3):
  - `type EstadoTarea = 'pendiente' | 'en_progreso' | 'completada' | 'omitida'`
  - `interface PlantillaTarea { id: string; titulo: string; descripcion: string | null; rolId: number | null; usuarioId: string | null; tipoRecurrencia: 'semanal' | 'unica'; diasSemana: number[] | null; fechaUnica: string | null; orden: number; activo: boolean; }`
  - `interface InstanciaTarea { id: string; plantillaId: string; usuarioId: string; fecha: string; estado: EstadoTarea; titulo: string; descripcion: string | null; actualizadoPorId: string | null; actualizadoEn: string | null; }` (trae `titulo`/`descripcion` vía JOIN a la plantilla — la pantalla nunca necesita pedirlos aparte)
  - `listarPlantillasAplicables(fecha: string, usuarioId: string, rolId: number): Promise<PlantillaTarea[]>` — activas, y (`rolId` coincide Y `dias_semana` incluye el día de semana de `fecha`) O (`rolId` coincide Y `fecha_unica = fecha`) O (`usuarioId` coincide con el mismo criterio de recurrencia.
  - `generarInstanciasFaltantes(plantillas: PlantillaTarea[], usuarioId: string, fecha: string): Promise<void>` — un `INSERT ... ON DUPLICATE KEY UPDATE id = id` (no-op update) por plantilla, para que sea idempotente sin lanzar error de duplicado.
  - `listarInstanciasDeUsuario(usuarioId: string, fecha: string): Promise<InstanciaTarea[]>`
  - `actualizarEstadoInstancia(id: string, estado: EstadoTarea, actualizadoPorId: string): Promise<InstanciaTarea | null>`
  - `obtenerInstanciaPorId(id: string): Promise<InstanciaTarea | null>` (para que el service valide dueño antes de actualizar)
  - `crearPlantilla(datos: Omit<PlantillaTarea, 'id'|'activo'> & { creadoPorId: string }): Promise<PlantillaTarea>`
  - `listarPlantillas(filtros: { rolId?: number; usuarioId?: string }): Promise<PlantillaTarea[]>`
  - `actualizarPlantilla(id: string, cambios: Partial<Pick<PlantillaTarea,'titulo'|'descripcion'|'orden'|'activo'|'diasSemana'|'fechaUnica'>>): Promise<PlantillaTarea | null>`
  - `listarInstanciasVista(fecha: string, filtros: { rolId?: number; usuarioId?: string }): Promise<(InstanciaTarea & { usuarioNombre: string })[]>` — para la vista cruzada de Root/Super Root.

- [ ] **Paso 1: Escribir `tareas.types.ts`** con las interfaces de arriba.

- [ ] **Paso 2: Escribir `tareas.repository.ts`**

Seguir el estilo de `backend/src/modules/general/usuarios/usuarios.repository.ts`
(un `pool.query` parametrizado por función, mapeo manual de filas). El mapeo
de `dias_semana` (CSV en la columna) ↔ `number[]` (en el tipo) vive aquí, no
en el service.

- [ ] **Paso 3: Verificar**

```bash
cd backend && npm run typecheck
```
Expected: sin errores.

- [ ] **Paso 4: Commit**

```bash
git add backend/src/modules/tareas/tareas.types.ts backend/src/modules/tareas/tareas.repository.ts
git commit -m "feat(tareas): tipos y repositorio del módulo de tareas"
```

---

### Task 3: Servicio backend (generación + reglas de permiso)

**Files:**
- Create: `backend/src/modules/tareas/tareas.service.ts`

**Interfaces:**
- Consumes: todo lo de Task 2.
- Produces (usado por Task 4):
  - `obtenerTareasDelDia(usuarioId: string, rolId: number, fecha: string): Promise<InstanciaTarea[]>` — resuelve plantillas aplicables, genera las instancias que falten, devuelve las instancias del usuario para esa fecha ordenadas por `orden`.
  - `cambiarEstado(params: { instanciaId: string; estado: EstadoTarea; llamadorId: string; llamadorPuedeGestionar: boolean }): Promise<InstanciaTarea>` — si `!llamadorPuedeGestionar`, exige que la instancia pertenezca a `llamadorId` (si no, lanza `Errors.forbidden`); si no existe, `Errors.notFound`.
  - `crearPlantilla(datos: ..., creadoPorId: string): Promise<PlantillaTarea>` — valida con Zod en el caller (Task 4), aquí solo la regla de negocio: exactamente uno de `rolId`/`usuarioId`, y la combinación tipo/días-o-fecha de la Spec §1.
  - `editarPlantilla(id: string, cambios: ...): Promise<PlantillaTarea>`
  - `listarPlantillas(filtros): Promise<PlantillaTarea[]>`
  - `obtenerVistaCruzada(fecha: string, filtros): Promise<...>` — igual que `listarInstanciasVista` pero generando antes las instancias faltantes de cada usuario afectado por los filtros (mismo camino perezoso que `obtenerTareasDelDia`, para que la vista de Root/Super Root nunca muestre un día vacío por no haberse generado aún).

- [ ] **Paso 1: Implementar el servicio** con las reglas de arriba.

Importar `Errors` de `backend/src/shared/utils/app-error.ts` (mismo patrón
que el resto de los módulos) para los 403/404.

- [ ] **Paso 2: Verificar manualmente la generación perezosa**

Escribir un script descartable en `backend/scripts/` (o usar `tsx` directo)
que llame `obtenerTareasDelDia` dos veces seguidas para el mismo
usuario+fecha contra la DB de desarrollo y confirme por SQL que NO se
duplicaron filas en `tareas_instancia` (cubre el ítem de concurrencia/
duplicados del Review Focus). Borrar el script al terminar — no se commitea.

- [ ] **Paso 3: Verificar**

```bash
cd backend && npm run typecheck
```

- [ ] **Paso 4: Commit**

```bash
git add backend/src/modules/tareas/tareas.service.ts
git commit -m "feat(tareas): servicio con generación de instancias y reglas de permiso"
```

---

### Task 4: Rutas backend

**Files:**
- Create: `backend/src/modules/tareas/tareas.routes.ts`
- Modify: `backend/src/app.ts` (montar el router, mismo patrón que la línea 96 para `reportesRouter`)

**Interfaces:**
- Consumes: servicio de Task 3.
- Produces: endpoints de la Spec §3 bajo `/api/v1/tareas`.

- [ ] **Paso 1: Escribir `tareas.routes.ts`**

Seguir el patrón exacto de `backend/src/modules/reportes/reportes.routes.ts`:
`router.use(authMiddleware)`, cada ruta con su `requirePermission(codigo)`,
body/query validados con `zod` (esquemas para crear/editar plantilla y para
`PATCH estado`). `llamadorPuedeGestionar` para el service se calcula
llamando `tienePermiso(req.auth.rolId, 'tareas.gestionar')` (ya existe en
`rbac.middleware.ts`), no re-implementar el chequeo. Cuando `?fecha=` viene
vacío en `GET /mias` y `GET /vista`, resolver "hoy" con
`SELECT CURDATE() AS hoy` vía `pool.query` (ver Global Constraints) antes de
llamar al service — nunca `new Date().toISOString().slice(0,10)`.

- [ ] **Paso 2: Montar el router en `app.ts`**

```ts
import { tareasRouter } from "./modules/tareas/tareas.routes";
// ...
app.use("/api/v1/tareas", tareasRouter);
```

- [ ] **Paso 3: Verificar**

```bash
cd backend && npm run typecheck && npm run dev
```
Con el servidor arriba, probar con `curl` (token real de un usuario de
prueba): `GET /api/v1/tareas/mias` sin ninguna plantilla creada aún →
`200` con `[]` (cubre el ítem "usuario sin plantillas" del Review Focus,
no un 500).

- [ ] **Paso 4: Commit**

```bash
git add backend/src/modules/tareas/tareas.routes.ts backend/src/app.ts
git commit -m "feat(tareas): endpoints del módulo de tareas"
```

---

### Task 5: Cliente API frontend

**Files:**
- Create: `frontend/src/modules/tareas/api.ts`

**Interfaces:**
- Consumes: endpoints de Task 4.
- Produces (usado por Tasks 6-7): tipos `InstanciaTarea`/`PlantillaTarea`/`EstadoTarea` espejo de `tareas.types.ts`, y funciones `obtenerMisTareas(fecha?)`, `cambiarEstadoTarea(id, estado)`, `listarPlantillas(filtros)`, `crearPlantilla(datos)`, `editarPlantilla(id, cambios)`, `obtenerVistaCruzada(fecha, filtros)`.

- [ ] **Paso 1: Escribir `api.ts`** siguiendo el estilo de
  `frontend/src/modules/reportes/api.ts` (mismo wrapper de fetch/axios que
  ya usa el resto del frontend para llamadas autenticadas).

- [ ] **Paso 2: Verificar**

```bash
cd frontend && npx tsc -b --noEmit
```

- [ ] **Paso 3: Commit**

```bash
git add frontend/src/modules/tareas/api.ts
git commit -m "feat(tareas): cliente API del módulo de tareas"
```

---

### Task 6: Página "Mis tareas"

**Files:**
- Create: `frontend/src/modules/tareas/pages/TareasPage.tsx`
- Create: `frontend/src/modules/tareas/components/TareaCard.tsx`

**Interfaces:**
- Consumes: `api.ts` de Task 5.

- [ ] **Paso 1: `TareaCard.tsx`** — tarjeta de una tarea (título, descripción,
  selector de estado con las 4 opciones de `EstadoTarea`), tonos verdes
  pastel para el estado "completada".

- [ ] **Paso 2: `TareasPage.tsx`** — selector de fecha (default hoy),
  3 columnas (Pendiente/En progreso — agrupa también "omitida" si aplica
  — /Completada) pobladas con `obtenerMisTareas(fecha)`, cambiar estado
  llama `cambiarEstadoTarea` y refresca la columna. Estado vacío (sin
  tarjetas) debe mostrar un mensaje, no verse roto.

- [ ] **Paso 3: Verificar**

```bash
cd frontend && npx tsc -b --noEmit
```
Luego manualmente: `npm run dev`, iniciar sesión con un usuario de prueba,
abrir la página (aún sin ruta de menú — navegar directo a la URL), confirmar
que carga vacío sin error.

- [ ] **Paso 4: Commit**

```bash
git add frontend/src/modules/tareas/pages/TareasPage.tsx frontend/src/modules/tareas/components/TareaCard.tsx
git commit -m "feat(tareas): pantalla de tareas propias"
```

---

### Task 7: Administración (Root/Super Root)

**Files:**
- Create: `frontend/src/modules/tareas/pages/TareasAdminPage.tsx`
- Create: `frontend/src/modules/tareas/components/PlantillaForm.tsx`

**Interfaces:**
- Consumes: `api.ts` de Task 5.

- [ ] **Paso 1: `PlantillaForm.tsx`** — formulario crear/editar plantilla:
  título, descripción, selector rol-o-usuario (mutuamente excluyente),
  selector recurrencia (checkboxes de día de semana, o un date picker para
  "única"), toggle activo.

- [ ] **Paso 2: `TareasAdminPage.tsx`** — lista de plantillas (con filtro por
  rol/usuario) + botón para abrir `PlantillaForm`, y la vista cruzada del
  día (filtrable por rol o usuario) mostrando el estado de cada persona con
  opción de sobreescribirlo.

- [ ] **Paso 3: Verificar**

```bash
cd frontend && npx tsc -b --noEmit
```
Manualmente: crear una plantilla recurrente para un rol, confirmar en la
vista cruzada que aparece para cada usuario de ese rol; desactivarla y
confirmar que las instancias de días pasados siguen visibles (Review
Focus: plantilla desactivada no borra historial).

- [ ] **Paso 4: Commit**

```bash
git add frontend/src/modules/tareas/pages/TareasAdminPage.tsx frontend/src/modules/tareas/components/PlantillaForm.tsx
git commit -m "feat(tareas): administración de plantillas para Root/Super Root"
```

---

### Task 8: Navegación

**Files:**
- Modify: `frontend/src/shared/layout/modules-meta.ts`
- Modify: `frontend/src/App.tsx` (o el archivo de rutas equivalente)

**Interfaces:**
- Consumes: páginas de Tasks 6-7.

- [ ] **Paso 1: Agregar a `MODULES_META`**

```ts
{ slug: "tareas", label: "Tareas", path: "/tareas", icon: "✅" },
{ slug: "tareas", label: "Administrar tareas", path: "/tareas/administrar", icon: "🗂️", roles: ["Super Root", "Root"] },
```
Sin filtro `roles` en la primera entrada (visible para los 6 roles, como
Dashboard). Revisar si conviene sumarlas a algún `NAV_GROUPS` existente o
dejarlas sueltas — por defecto, sueltas (es una sección propia, no parte de
Migao/Con Sentido/Insumos).

- [ ] **Paso 2: Agregar las rutas** en el router de la app, apuntando a
  `TareasPage`/`TareasAdminPage`, protegidas igual que el resto (requieren
  sesión; el permiso real ya lo exige el backend, el front solo oculta/
  muestra el enlace).

- [ ] **Paso 3: Verificar**

```bash
cd frontend && npx tsc -b --noEmit
```
Manualmente: iniciar sesión con cada tipo de rol (al menos uno operativo
como Cajero y uno administrativo como Root) y confirmar que el link
"Tareas" aparece para todos, y "Administrar tareas" solo para Root/Super
Root.

- [ ] **Paso 4: Commit**

```bash
git add frontend/src/shared/layout/modules-meta.ts frontend/src/App.tsx
git commit -m "feat(tareas): agregar pestañas de Tareas a la navegación"
```
