# Recetario — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo nuevo "Recetario": Root/Super Root crean, editan y eliminan recetas (título, instrucciones, categoría, un medio principal que es imagen o video —uno de los dos—, y una sección opcional de ejemplo de emplatado); Cocina las navega en una pantalla aparte con letra grande, tarjetas con imagen y búsqueda/filtro rápido.

**Architecture:** Backend nuevo (`backend/src/modules/recetario/`), mismo patrón de 5 archivos ya usado por el módulo Vales de este sistema. Frontend nuevo (`frontend/src/modules/recetario/`) con dos páginas independientes — una de administración (tabla + modales) y una de navegación de solo lectura (grilla + detalle) — más dos entradas nuevas en el menú lateral. El video es siempre un link (nunca un archivo subido); las imágenes reusan el mecanismo de subida ya existente en la app, sin cambiarlo. Nombrado `recetario_*`/`recetario.*` en todo para no chocar con las "recetas" de amasijos que ya existen en Migao.

**Tech Stack:** Backend Node/Express+TypeScript+Zod+MySQL (vía el shim Postgres→MySQL ya existente). Frontend React+TypeScript+Vite, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-16-recetario-design.md`

## Global Constraints

- Trabajo directo en `main`, sin worktree; ejecución Native (inline) — ya aprobado por el usuario para toda esta sesión.
- Verificación backend: `cd backend && npx tsc --noEmit`. Verificación frontend: `cd frontend && npm run build`. Este repo no tiene framework de tests — mismo criterio ya usado en los planes anteriores de esta sesión.
- **Esta vez SÍ hay migración de base de datos** (a diferencia de los dos planes de minimizar anteriores) — la Tarea 1 escribe el SQL que el usuario debe correr a mano en phpMyAdmin antes de que el backend funcione contra una base real; `tsc`/`npm run build` solo verifican que el código compila, no que las tablas existan.
- Nombrado: tablas `recetario_categorias`/`recetario_recetas`, módulo slug `recetario`, permisos `recetario.ver`/`recetario.administrar` — nunca `recetas`/`migao.recetas.*` (ya existe ese nombre para las recetas de amasijos de Migao, es un concepto totalmente distinto).
- El video de una receta es siempre una URL (nunca un archivo subido) — no se toca `upload.middleware.ts` para nada relacionado a video.
- Las imágenes (principal y de emplatado) reusan `crearUploaderImagen`/`SubidaImagen` exactamente como ya existen, con una subcarpeta nueva `"recetario"` — sin cambios al mecanismo en sí.
- `video_url` e `imagen_principal_url` nunca coexisten: cada función del repositorio que fija una de las dos limpia la otra en la misma sentencia (nunca se confía solo en el CHECK de la base para esto — el CHECK es una red de seguridad, no el mecanismo).
- Crear una receta con una imagen principal (no video) no puede subir la imagen en el mismo POST que la crea — no existe el id todavía. El modal de creación crea la receta primero (sin media) y, si se eligió imagen, sube el archivo justo después dentro del mismo flujo de "Crear receta" — el usuario ve un solo botón y una sola acción, aunque internamente sean 2-3 llamadas en secuencia.

## Review Focus

- **Crear una receta con imagen principal debe terminar con `imagen_principal_url` puesto** tras la secuencia crear→subir — si la subida falla después de haber creado la receta, la receta debe seguir existiendo (sin media), nunca desaparecer ni quedar en un estado incierto sin aviso. Cubierto en la Tarea 7 (`NuevaRecetaModal`).
- **Cambiar el medio principal de una receta (de video a imagen o viceversa) nunca debe dejar los dos campos con valor a la vez** — cubierto en la Tarea 3 (`editarReceta`/`actualizarImagenPrincipal` del repositorio, cada uno limpia el otro campo en su propia sentencia).
- **Un link de video que no es de YouTube/Vimeo (ej. un link de Drive) debe guardarse y mostrarse igual**, como un link simple "Ver video" en vez de intentar incrustarlo — nunca debe romper la pantalla ni perder el link. Cubierto en la Tarea 9 (`urlEmbedVideo` devuelve `null` para lo que no reconoce, y el detalle cae al link simple).
- **La pantalla de Cocina ("Recetas") nunca debe mostrar controles de editar/eliminar**, sin importar que Root/Super Root también puedan abrirla para revisar — es de solo lectura para cualquiera que la abra. Cubierto en la Tarea 9 (`RecetarioVerPage`/`RecetaDetallePage` no importan ningún modal de edición).
- **Eliminar una receta que nunca tuvo ninguna media (solo título e instrucciones) debe funcionar igual que eliminar una con imagen/video** — sin casos especiales según qué campos tenga poblados. Cubierto en la Tarea 3 (`eliminarReceta` es un `DELETE` simple, sin lógica condicional sobre qué campos tiene la fila).

---

### Task 1: Migración de base de datos

**Files:**
- Create: `database/mysql/migraciones/2026-10-16_modulo_recetario.sql`
- Modify: `database/mysql/schema.sql`
- Modify: `database/seed.sql`

**Interfaces:**
- Produces: tablas `recetario_categorias`, `recetario_recetas`; módulo `recetario`; permisos `recetario.ver`/`recetario.administrar`. Las Tareas 2-6 (backend) asumen exactamente este shape de columnas.

- [ ] **Step 1: Crear el archivo de migración completo**

```sql
-- ============================================================================
-- Módulo Recetario — recetas para el equipo de cocina, con instrucciones
-- largas, categoría, un medio principal (imagen o video, nunca los dos a la
-- vez) y una sección opcional de ejemplo de emplatado.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- ============================================================================

CREATE TABLE recetario_categorias (
  id     INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) UNIQUE NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE recetario_recetas (
  id                    CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  titulo                VARCHAR(150) NOT NULL,
  instrucciones         TEXT NOT NULL,
  categoria_id          INT NULL,
  video_url             VARCHAR(500) NULL,
  imagen_principal_url  VARCHAR(500) NULL,
  imagen_emplatado_url  VARCHAR(500) NULL,
  descripcion_emplatado VARCHAR(500) NULL,
  creado_por_id         CHAR(36) NOT NULL,
  created_at            DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at            DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  FOREIGN KEY (categoria_id) REFERENCES recetario_categorias(id),
  FOREIGN KEY (creado_por_id) REFERENCES usuarios(id),
  CHECK (video_url IS NULL OR imagen_principal_url IS NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE INDEX idx_recetario_recetas_categoria ON recetario_recetas(categoria_id);

-- --- Módulo + permisos ---
INSERT INTO modulos (slug, nombre)
SELECT 'recetario', 'Recetario'
WHERE NOT EXISTS (SELECT 1 FROM modulos WHERE slug = 'recetario');

INSERT INTO permisos (modulo_id, accion, codigo)
SELECT (SELECT id FROM modulos WHERE slug = 'recetario'), x.accion, x.codigo
FROM (SELECT 'ver' AS accion, 'recetario.ver' AS codigo
      UNION ALL SELECT 'administrar', 'recetario.administrar') AS x
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE codigo = x.codigo);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre IN ('Root', 'Super Root')
  AND p.codigo IN ('recetario.ver', 'recetario.administrar')
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre = 'Cocina'
  AND p.codigo = 'recetario.ver'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);
```

- [ ] **Step 2: Agregar el módulo a la lista de `modulos` en `schema.sql` (para instalaciones nuevas)**

`old_string`:

```
INSERT INTO modulos (slug, nombre) VALUES
  ('general', 'Módulo general'),
  ('insumos', 'Insumos'),
  ('talleres', 'Talleres / Experiencias'),
  ('con_sentido', 'Con Sentido'),
  ('migao', 'Migao (POS)'),
  ('pedidos', 'Pedidos / Encargos'),
  ('vales', 'Vales');
```

`new_string`:

```
INSERT INTO modulos (slug, nombre) VALUES
  ('general', 'Módulo general'),
  ('insumos', 'Insumos'),
  ('talleres', 'Talleres / Experiencias'),
  ('con_sentido', 'Con Sentido'),
  ('migao', 'Migao (POS)'),
  ('pedidos', 'Pedidos / Encargos'),
  ('vales', 'Vales'),
  ('recetario', 'Recetario');
```

- [ ] **Step 3: Agregar la sección "7.2 MODULO RECETARIO" en `schema.sql`, justo antes de la sección 8**

`old_string`:

```
CREATE INDEX idx_vales_fuente ON vales(fuente);
CREATE INDEX idx_vales_dueno ON vales(dueno_id);
CREATE INDEX idx_vales_tipo ON vales(tipo);

-- ============================================================================
-- 8. SEED MINIMO DE MODULOS
-- ============================================================================
```

`new_string`:

```
CREATE INDEX idx_vales_fuente ON vales(fuente);
CREATE INDEX idx_vales_dueno ON vales(dueno_id);
CREATE INDEX idx_vales_tipo ON vales(tipo);

-- ============================================================================
-- 7.2 MODULO RECETARIO
-- ============================================================================

CREATE TABLE recetario_categorias (
  id     INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) UNIQUE NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE recetario_recetas (
  id                    CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  titulo                VARCHAR(150) NOT NULL,
  instrucciones         TEXT NOT NULL,
  categoria_id          INT NULL,
  video_url             VARCHAR(500) NULL,
  imagen_principal_url  VARCHAR(500) NULL,
  imagen_emplatado_url  VARCHAR(500) NULL,
  descripcion_emplatado VARCHAR(500) NULL,
  creado_por_id         CHAR(36) NOT NULL,
  created_at            DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at            DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  FOREIGN KEY (categoria_id) REFERENCES recetario_categorias(id),
  FOREIGN KEY (creado_por_id) REFERENCES usuarios(id),
  CHECK (video_url IS NULL OR imagen_principal_url IS NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE INDEX idx_recetario_recetas_categoria ON recetario_recetas(categoria_id);

-- ============================================================================
-- 8. SEED MINIMO DE MODULOS
-- ============================================================================
```

- [ ] **Step 4: Agregar los permisos de Recetario a `seed.sql` (Super Root/Root ya toman todos los permisos por su INSERT sin filtro — solo falta agregarlos a la lista de `permisos` y al bloque explícito de Cocina)**

`old_string`:

```
  ((SELECT id FROM modulos WHERE slug = 'vales'), 'ver',             'vales.ver'),
  ((SELECT id FROM modulos WHERE slug = 'vales'), 'crear',           'vales.crear'),
  ((SELECT id FROM modulos WHERE slug = 'vales'), 'marcar_repuesto', 'vales.marcar_repuesto'),
  ((SELECT id FROM modulos WHERE slug = 'vales'), 'anular',          'vales.anular'),
  ((SELECT id FROM modulos WHERE slug = 'vales'), 'marcar_cobrado',  'vales.marcar_cobrado');
```

`new_string`:

```
  ((SELECT id FROM modulos WHERE slug = 'vales'), 'ver',             'vales.ver'),
  ((SELECT id FROM modulos WHERE slug = 'vales'), 'crear',           'vales.crear'),
  ((SELECT id FROM modulos WHERE slug = 'vales'), 'marcar_repuesto', 'vales.marcar_repuesto'),
  ((SELECT id FROM modulos WHERE slug = 'vales'), 'anular',          'vales.anular'),
  ((SELECT id FROM modulos WHERE slug = 'vales'), 'marcar_cobrado',  'vales.marcar_cobrado'),
  ((SELECT id FROM modulos WHERE slug = 'recetario'), 'ver',          'recetario.ver'),
  ((SELECT id FROM modulos WHERE slug = 'recetario'), 'administrar',  'recetario.administrar');
```

`old_string`:

```
-- Cocina: SOLO puede ver la cola de pedidos y cambiar el estado a preparando/listo.
-- Sin acceso a migao.ordenes.* (no ve cobros, no crea órdenes, no cierra mesas).
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT (SELECT id FROM roles WHERE nombre = 'Cocina'), p.id
FROM permisos p
WHERE p.codigo IN (
  'migao.cocina.ver',
  'migao.cocina.actualizar_estado',
  'migao.inventario.ver',
  'migao.inventario.administrar',
  'migao.amasijos.ver',
  'migao.amasijos.administrar'
);
```

`new_string`:

```
-- Cocina: SOLO puede ver la cola de pedidos y cambiar el estado a preparando/listo,
-- más consultar inventario/amasijos y ver (no administrar) el Recetario.
-- Sin acceso a migao.ordenes.* (no ve cobros, no crea órdenes, no cierra mesas).
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT (SELECT id FROM roles WHERE nombre = 'Cocina'), p.id
FROM permisos p
WHERE p.codigo IN (
  'migao.cocina.ver',
  'migao.cocina.actualizar_estado',
  'migao.inventario.ver',
  'migao.inventario.administrar',
  'migao.amasijos.ver',
  'migao.amasijos.administrar',
  'recetario.ver'
);
```

- [ ] **Step 5: Commit**

```bash
git add database/mysql/migraciones/2026-10-16_modulo_recetario.sql database/mysql/schema.sql database/seed.sql
git commit -m "feat(recetario): agrega las tablas, módulo y permisos de Recetario"
```

---

### Task 2: `recetario.schema.ts`

**Files:**
- Create: `backend/src/modules/recetario/recetario.schema.ts`

**Interfaces:**
- Produces: `crearCategoriaSchema`, `crearRecetaSchema` (+ `CrearRecetaInput`), `editarRecetaSchema` (+ `EditarRecetaInput`). Las Tareas 4 y 5 los consumen con estos nombres exactos.

- [ ] **Step 1: Crear el archivo completo**

```ts
import { z } from "zod";

export const crearCategoriaSchema = z.object({
  nombre: z.string().trim().min(1, "Escribe el nombre de la categoría").max(80),
});

export const crearRecetaSchema = z.object({
  titulo: z.string().trim().min(1, "Escribe el título de la receta").max(150),
  instrucciones: z.string().trim().min(1, "Escribe las instrucciones de la receta"),
  categoriaId: z.number().int().positive().optional(),
  videoUrl: z.string().trim().url("El link de video no es una URL válida").max(500).optional(),
  descripcionEmplatado: z.string().trim().max(500).optional(),
});
export type CrearRecetaInput = z.infer<typeof crearRecetaSchema>;

// Todos opcionales (edición parcial). `.nullable()` en categoriaId/videoUrl/
// descripcionEmplatado deja distinguir "no tocar este campo" (omitido) de
// "vaciarlo" (null) — fijar videoUrl limpia la imagen principal en el
// repositorio (nunca coexisten), así que el frontend manda null acá cuando
// el cajero elige "Imagen" en vez de "Video" para el medio principal.
export const editarRecetaSchema = z.object({
  titulo: z.string().trim().min(1, "Escribe el título de la receta").max(150).optional(),
  instrucciones: z.string().trim().min(1, "Escribe las instrucciones de la receta").optional(),
  categoriaId: z.number().int().positive().nullable().optional(),
  videoUrl: z.string().trim().url("El link de video no es una URL válida").max(500).nullable().optional(),
  descripcionEmplatado: z.string().trim().max(500).nullable().optional(),
});
export type EditarRecetaInput = z.infer<typeof editarRecetaSchema>;
```

- [ ] **Step 2: Verificar compilación**

Run: `cd backend && npx tsc --noEmit`
Expected: compila sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/recetario/recetario.schema.ts
git commit -m "feat(recetario): agrega los schemas de validación"
```

---

### Task 3: `recetario.repository.ts`

**Files:**
- Create: `backend/src/modules/recetario/recetario.repository.ts`

**Interfaces:**
- Produces: `listarCategorias`, `crearCategoria`, `listarRecetas`, `getRecetaById`, `crearReceta`, `editarReceta`, `actualizarImagenPrincipal`, `actualizarImagenEmplatado`, `eliminarReceta`. La Tarea 4 (service) los consume con estos nombres exactos.

- [ ] **Step 1: Crear el archivo completo**

```ts
import { Pool, PoolClient, pool } from "../../shared/db/pool";

type Executor = Pool | PoolClient;

export async function listarCategorias(executor: Executor = pool) {
  const result = await executor.query(`SELECT id, nombre FROM recetario_categorias ORDER BY nombre ASC`);
  return result.rows;
}

export async function crearCategoria(nombre: string, executor: Executor = pool) {
  const result = await executor.query(
    `INSERT INTO recetario_categorias (nombre) VALUES ($1) RETURNING id, nombre`,
    [nombre],
  );
  return result.rows[0];
}

const SELECT_RECETA = `
  SELECT r.*, c.nombre AS categoria_nombre, u.nombre AS creado_por_nombre
    FROM recetario_recetas r
    LEFT JOIN recetario_categorias c ON c.id = r.categoria_id
    LEFT JOIN usuarios u ON u.id = r.creado_por_id
`;

export async function listarRecetas(executor: Executor = pool) {
  const result = await executor.query(`${SELECT_RECETA} ORDER BY r.titulo ASC`);
  return result.rows;
}

export async function getRecetaById(id: string, executor: Executor = pool) {
  const result = await executor.query(`${SELECT_RECETA} WHERE r.id = $1`, [id]);
  return result.rowCount ? result.rows[0] : null;
}

export async function crearReceta(
  params: {
    titulo: string;
    instrucciones: string;
    categoriaId: number | null;
    videoUrl: string | null;
    descripcionEmplatado: string | null;
    creadoPorId: string;
  },
  executor: Executor = pool,
) {
  const result = await executor.query(
    `INSERT INTO recetario_recetas (titulo, instrucciones, categoria_id, video_url, descripcion_emplatado, creado_por_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      params.titulo,
      params.instrucciones,
      params.categoriaId,
      params.videoUrl,
      params.descripcionEmplatado,
      params.creadoPorId,
    ],
  );
  return result.rows[0].id as string;
}

export async function editarReceta(
  id: string,
  campos: {
    titulo?: string;
    instrucciones?: string;
    categoriaId?: number | null;
    videoUrl?: string | null;
    descripcionEmplatado?: string | null;
  },
  executor: Executor = pool,
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  function agregar(columna: string, valor: unknown) {
    params.push(valor);
    sets.push(`${columna} = $${params.length}`);
  }
  if (campos.titulo !== undefined) agregar("titulo", campos.titulo);
  if (campos.instrucciones !== undefined) agregar("instrucciones", campos.instrucciones);
  if (campos.categoriaId !== undefined) agregar("categoria_id", campos.categoriaId);
  if (campos.videoUrl !== undefined) {
    agregar("video_url", campos.videoUrl);
    // Un video y una imagen principal nunca coexisten — fijar el video limpia
    // la imagen principal que hubiera, en la misma sentencia (nunca basta con
    // el CHECK de la base solo: eso rechazaría el UPDATE en vez de resolverlo).
    agregar("imagen_principal_url", null);
  }
  if (campos.descripcionEmplatado !== undefined) agregar("descripcion_emplatado", campos.descripcionEmplatado);
  if (sets.length === 0) return;
  params.push(id);
  await executor.query(`UPDATE recetario_recetas SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
}

export async function actualizarImagenPrincipal(id: string, imagenUrl: string, executor: Executor = pool) {
  // Fijar la imagen principal limpia cualquier video — nunca coexisten.
  await executor.query(`UPDATE recetario_recetas SET imagen_principal_url = $2, video_url = NULL WHERE id = $1`, [
    id,
    imagenUrl,
  ]);
}

export async function actualizarImagenEmplatado(id: string, imagenUrl: string, executor: Executor = pool) {
  await executor.query(`UPDATE recetario_recetas SET imagen_emplatado_url = $2 WHERE id = $1`, [id, imagenUrl]);
}

export async function eliminarReceta(id: string, executor: Executor = pool): Promise<boolean> {
  const result = await executor.query(`DELETE FROM recetario_recetas WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
```

- [ ] **Step 2: Verificar compilación**

Run: `cd backend && npx tsc --noEmit`
Expected: compila sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/recetario/recetario.repository.ts
git commit -m "feat(recetario): agrega el repositorio"
```

---

### Task 4: `recetario.service.ts`

**Files:**
- Create: `backend/src/modules/recetario/recetario.service.ts`

**Interfaces:**
- Consumes: todo lo de la Tarea 3 (`recetario.repository.ts`) y los tipos `CrearRecetaInput`/`EditarRecetaInput` de la Tarea 2.
- Produces: `listarCategorias`, `crearCategoria`, `listarRecetas`, `obtenerReceta`, `crearReceta`, `editarReceta`, `eliminarReceta`, `actualizarImagenPrincipal`, `actualizarImagenEmplatado`. La Tarea 5 (controller) los consume con estos nombres exactos.

- [ ] **Step 1: Crear el archivo completo**

```ts
import { Errors } from "../../shared/utils/app-error";
import * as repo from "./recetario.repository";
import { CrearRecetaInput, EditarRecetaInput } from "./recetario.schema";

export async function listarCategorias() {
  return repo.listarCategorias();
}

export async function crearCategoria(nombre: string) {
  return repo.crearCategoria(nombre);
}

export async function listarRecetas() {
  return repo.listarRecetas();
}

export async function obtenerReceta(id: string) {
  const receta = await repo.getRecetaById(id);
  if (!receta) throw Errors.notFound("Receta no encontrada");
  return receta;
}

export async function crearReceta(input: CrearRecetaInput, usuarioId: string) {
  const id = await repo.crearReceta({
    titulo: input.titulo,
    instrucciones: input.instrucciones,
    categoriaId: input.categoriaId ?? null,
    videoUrl: input.videoUrl ?? null,
    descripcionEmplatado: input.descripcionEmplatado ?? null,
    creadoPorId: usuarioId,
  });
  return repo.getRecetaById(id);
}

export async function editarReceta(id: string, input: EditarRecetaInput) {
  const receta = await repo.getRecetaById(id);
  if (!receta) throw Errors.notFound("Receta no encontrada");
  await repo.editarReceta(id, input);
  return repo.getRecetaById(id);
}

export async function eliminarReceta(id: string) {
  const eliminada = await repo.eliminarReceta(id);
  if (!eliminada) throw Errors.notFound("Receta no encontrada");
}

export async function actualizarImagenPrincipal(id: string, imagenUrl: string) {
  const receta = await repo.getRecetaById(id);
  if (!receta) throw Errors.notFound("Receta no encontrada");
  await repo.actualizarImagenPrincipal(id, imagenUrl);
  return repo.getRecetaById(id);
}

export async function actualizarImagenEmplatado(id: string, imagenUrl: string) {
  const receta = await repo.getRecetaById(id);
  if (!receta) throw Errors.notFound("Receta no encontrada");
  await repo.actualizarImagenEmplatado(id, imagenUrl);
  return repo.getRecetaById(id);
}
```

- [ ] **Step 2: Verificar compilación**

Run: `cd backend && npx tsc --noEmit`
Expected: compila sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/recetario/recetario.service.ts
git commit -m "feat(recetario): agrega la capa de servicio"
```

---

### Task 5: `recetario.controller.ts` + `recetario.routes.ts` + montaje en `app.ts`

**Files:**
- Create: `backend/src/modules/recetario/recetario.controller.ts`
- Create: `backend/src/modules/recetario/recetario.routes.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `recetario.service.ts` (Tarea 4), `recetario.schema.ts` (Tarea 2), `crearUploaderImagen`/`rutaPublicaImagen` de `upload.middleware.ts` (ya existen).
- Produces: router montado en `/api/v1/recetario` — el frontend (Tarea 6) depende de esta ruta exacta.

- [ ] **Step 1: Crear `recetario.controller.ts`**

```ts
import { Request, Response } from "express";
import { Errors } from "../../shared/utils/app-error";
import { ok, created } from "../../shared/utils/response";
import { rutaPublicaImagen } from "../../shared/middlewares/upload.middleware";
import * as service from "./recetario.service";
import { crearCategoriaSchema, crearRecetaSchema, editarRecetaSchema } from "./recetario.schema";

export async function listarCategoriasController(req: Request, res: Response) {
  return ok(res, await service.listarCategorias());
}

export async function crearCategoriaController(req: Request, res: Response) {
  const data = crearCategoriaSchema.parse(req.body);
  return created(res, await service.crearCategoria(data.nombre));
}

export async function listarRecetasController(req: Request, res: Response) {
  return ok(res, await service.listarRecetas());
}

export async function obtenerRecetaController(req: Request, res: Response) {
  return ok(res, await service.obtenerReceta(req.params.id));
}

export async function crearRecetaController(req: Request, res: Response) {
  const data = crearRecetaSchema.parse(req.body);
  return created(res, await service.crearReceta(data, req.auth!.usuarioId));
}

export async function editarRecetaController(req: Request, res: Response) {
  const data = editarRecetaSchema.parse(req.body);
  return ok(res, await service.editarReceta(req.params.id, data));
}

export async function eliminarRecetaController(req: Request, res: Response) {
  await service.eliminarReceta(req.params.id);
  return ok(res, { eliminada: true });
}

export async function subirImagenPrincipalController(req: Request, res: Response) {
  if (!req.file) throw Errors.badRequest("Falta el archivo de imagen");
  const imagenUrl = rutaPublicaImagen("recetario", req.file.filename);
  return ok(res, await service.actualizarImagenPrincipal(req.params.id, imagenUrl));
}

export async function subirImagenEmplatadoController(req: Request, res: Response) {
  if (!req.file) throw Errors.badRequest("Falta el archivo de imagen");
  const imagenUrl = rutaPublicaImagen("recetario", req.file.filename);
  return ok(res, await service.actualizarImagenEmplatado(req.params.id, imagenUrl));
}
```

- [ ] **Step 2: Crear `recetario.routes.ts`**

```ts
import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../shared/middlewares/rbac.middleware";
import { crearUploaderImagen } from "../../shared/middlewares/upload.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  crearCategoriaController,
  crearRecetaController,
  editarRecetaController,
  eliminarRecetaController,
  listarCategoriasController,
  listarRecetasController,
  obtenerRecetaController,
  subirImagenEmplatadoController,
  subirImagenPrincipalController,
} from "./recetario.controller";

export const recetarioRouter = Router();
const subirImagenRecetario = crearUploaderImagen("recetario");

recetarioRouter.use(authMiddleware);
recetarioRouter.use(requirePermission("recetario.ver"));

recetarioRouter.get("/categorias", asyncHandler(listarCategoriasController));
recetarioRouter.post(
  "/categorias",
  requirePermission("recetario.administrar"),
  asyncHandler(crearCategoriaController),
);
recetarioRouter.get("/recetas", asyncHandler(listarRecetasController));
recetarioRouter.get("/recetas/:id", asyncHandler(obtenerRecetaController));
recetarioRouter.post("/recetas", requirePermission("recetario.administrar"), asyncHandler(crearRecetaController));
recetarioRouter.patch(
  "/recetas/:id",
  requirePermission("recetario.administrar"),
  asyncHandler(editarRecetaController),
);
recetarioRouter.delete(
  "/recetas/:id",
  requirePermission("recetario.administrar"),
  asyncHandler(eliminarRecetaController),
);
recetarioRouter.post(
  "/recetas/:id/imagen-principal",
  requirePermission("recetario.administrar"),
  subirImagenRecetario.single("imagen"),
  asyncHandler(subirImagenPrincipalController),
);
recetarioRouter.post(
  "/recetas/:id/imagen-emplatado",
  requirePermission("recetario.administrar"),
  subirImagenRecetario.single("imagen"),
  asyncHandler(subirImagenEmplatadoController),
);
```

- [ ] **Step 3: Montar el router en `app.ts`**

`old_string`:

```
import { usuariosRouter } from "./modules/general/usuarios/usuarios.routes";
import { migaoRouter } from "./modules/migao/migao.routes";
import { pedidosRouter } from "./modules/pedidos/pedidos.routes";
import { valesRouter } from "./modules/vales/vales.routes";
```

`new_string`:

```
import { usuariosRouter } from "./modules/general/usuarios/usuarios.routes";
import { migaoRouter } from "./modules/migao/migao.routes";
import { pedidosRouter } from "./modules/pedidos/pedidos.routes";
import { recetarioRouter } from "./modules/recetario/recetario.routes";
import { valesRouter } from "./modules/vales/vales.routes";
```

`old_string`:

```
  app.use("/api/v1/vales", valesRouter);
```

`new_string`:

```
  app.use("/api/v1/vales", valesRouter);
  app.use("/api/v1/recetario", recetarioRouter);
```

- [ ] **Step 4: Verificar compilación**

Run: `cd backend && npx tsc --noEmit`
Expected: compila sin errores.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/recetario/recetario.controller.ts backend/src/modules/recetario/recetario.routes.ts backend/src/app.ts
git commit -m "feat(recetario): agrega el controller, las rutas, y las monta en app.ts"
```

---

### Task 6: `frontend/src/modules/recetario/api.ts`

**Files:**
- Create: `frontend/src/modules/recetario/api.ts`

**Interfaces:**
- Produces: tipos `RecetarioCategoria`, `Receta`, `CrearRecetaInput`, `EditarRecetaInput`; objeto `recetarioApi`. Las Tareas 7-9 lo consumen con estos nombres exactos.

- [ ] **Step 1: Crear el archivo completo**

```ts
import { apiFetch, apiUpload } from "../../shared/api/client";

export interface RecetarioCategoria {
  id: number;
  nombre: string;
}

export interface Receta {
  id: string;
  titulo: string;
  instrucciones: string;
  categoria_id: number | null;
  categoria_nombre: string | null;
  video_url: string | null;
  imagen_principal_url: string | null;
  imagen_emplatado_url: string | null;
  descripcion_emplatado: string | null;
  creado_por_id: string;
  creado_por_nombre: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrearRecetaInput {
  titulo: string;
  instrucciones: string;
  categoriaId?: number;
  videoUrl?: string;
  descripcionEmplatado?: string;
}

export interface EditarRecetaInput {
  titulo?: string;
  instrucciones?: string;
  categoriaId?: number | null;
  videoUrl?: string | null;
  descripcionEmplatado?: string | null;
}

export const recetarioApi = {
  listarCategorias: () => apiFetch<RecetarioCategoria[]>("/recetario/categorias"),
  crearCategoria: (nombre: string) =>
    apiFetch<RecetarioCategoria>("/recetario/categorias", { method: "POST", body: { nombre } }),
  listar: () => apiFetch<Receta[]>("/recetario/recetas"),
  obtener: (id: string) => apiFetch<Receta>(`/recetario/recetas/${id}`),
  crear: (input: CrearRecetaInput) => apiFetch<Receta>("/recetario/recetas", { method: "POST", body: input }),
  editar: (id: string, input: EditarRecetaInput) =>
    apiFetch<Receta>(`/recetario/recetas/${id}`, { method: "PATCH", body: input }),
  eliminar: (id: string) => apiFetch<{ eliminada: boolean }>(`/recetario/recetas/${id}`, { method: "DELETE" }),
  subirImagenPrincipal: (id: string, file: File) =>
    apiUpload<Receta>(`/recetario/recetas/${id}/imagen-principal`, file),
  subirImagenEmplatado: (id: string, file: File) =>
    apiUpload<Receta>(`/recetario/recetas/${id}/imagen-emplatado`, file),
};
```

- [ ] **Step 2: Verificar compilación**

Run: `cd frontend && npm run build`
Expected: compila sin errores (archivo todavía no importado por nadie).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/recetario/api.ts
git commit -m "feat(recetario): agrega el cliente de API del frontend"
```

---

### Task 7: `NuevaRecetaModal.tsx` + `EditarRecetaModal.tsx`

**Files:**
- Create: `frontend/src/modules/recetario/components/NuevaRecetaModal.tsx`
- Create: `frontend/src/modules/recetario/components/EditarRecetaModal.tsx`

**Interfaces:**
- Consumes: `recetarioApi`/tipos de la Tarea 6; `Modal` y `SubidaImagen` ya existentes (`shared/components/`).
- Produces: componentes `NuevaRecetaModal({ categorias, onCerrar, onCreado, onCategoriaCreada })` y `EditarRecetaModal({ receta, categorias, onCerrar, onGuardado, onCategoriaCreada })`. La Tarea 8 los consume con estos nombres/props exactos.

- [ ] **Step 1: Crear `NuevaRecetaModal.tsx` completo**

```tsx
import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { recetarioApi, type RecetarioCategoria } from "../api";

interface NuevaRecetaModalProps {
  categorias: RecetarioCategoria[];
  onCerrar: () => void;
  onCreado: () => Promise<void> | void;
  onCategoriaCreada: (categoria: RecetarioCategoria) => void;
}

const OPCIONES_MEDIO = [
  { valor: "imagen" as const, etiqueta: "Imagen" },
  { valor: "video" as const, etiqueta: "Video" },
];

/** Crea la receta primero (sin media) y, si se eligió imagen, sube el
 *  archivo justo después — no existe un id al que subirle una foto antes de
 *  que la receta misma exista (ver Global Constraints del plan). El cajero
 *  ve un solo botón y una sola acción. */
export function NuevaRecetaModal({ categorias, onCerrar, onCreado, onCategoriaCreada }: NuevaRecetaModalProps) {
  const [titulo, setTitulo] = useState("");
  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [instrucciones, setInstrucciones] = useState("");
  const [medioPrincipal, setMedioPrincipal] = useState<"imagen" | "video">("imagen");
  const [videoUrl, setVideoUrl] = useState("");
  const [imagenPrincipalFile, setImagenPrincipalFile] = useState<File | null>(null);
  const [imagenEmplatadoFile, setImagenEmplatadoFile] = useState<File | null>(null);
  const [descripcionEmplatado, setDescripcionEmplatado] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [creandoCategoria, setCreandoCategoria] = useState(false);

  async function crearCategoria() {
    if (!nuevaCategoria.trim()) return;
    setCreandoCategoria(true);
    setError(null);
    try {
      const categoria = await recetarioApi.crearCategoria(nuevaCategoria.trim());
      onCategoriaCreada(categoria);
      setCategoriaId(categoria.id);
      setNuevaCategoria("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la categoría");
    } finally {
      setCreandoCategoria(false);
    }
  }

  async function crear() {
    if (!titulo.trim() || !instrucciones.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const receta = await recetarioApi.crear({
        titulo: titulo.trim(),
        instrucciones: instrucciones.trim(),
        categoriaId: categoriaId ? Number(categoriaId) : undefined,
        videoUrl: medioPrincipal === "video" && videoUrl.trim() ? videoUrl.trim() : undefined,
        descripcionEmplatado: descripcionEmplatado.trim() || undefined,
      });
      if (medioPrincipal === "imagen" && imagenPrincipalFile) {
        await recetarioApi.subirImagenPrincipal(receta.id, imagenPrincipalFile);
      }
      if (imagenEmplatadoFile) {
        await recetarioApi.subirImagenEmplatado(receta.id, imagenEmplatadoFile);
      }
      await onCreado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la receta");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal titulo="Nueva receta" onCerrar={onCerrar} maxWidth="sm:max-w-xl">
      <label className="mb-1 block text-xs font-medium">Título</label>
      <input
        autoFocus
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Categoría (opcional)</label>
      <select
        value={categoriaId}
        onChange={(e) => setCategoriaId(e.target.value ? Number(e.target.value) : "")}
        className="mb-2 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      >
        <option value="">Sin categoría</option>
        {categorias.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>

      <div className="mb-4 flex gap-2">
        <input
          value={nuevaCategoria}
          onChange={(e) => setNuevaCategoria(e.target.value)}
          placeholder="Nueva categoría..."
          className="flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-xs text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
        <button
          type="button"
          onClick={crearCategoria}
          disabled={creandoCategoria || !nuevaCategoria.trim()}
          className="rounded-md border border-brand-green-700 px-2 py-1 text-xs text-brand-green-700 hover:bg-brand-green-50 disabled:opacity-60 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
        >
          + Agregar
        </button>
      </div>

      <label className="mb-1 block text-xs font-medium">Instrucciones</label>
      <textarea
        value={instrucciones}
        onChange={(e) => setInstrucciones(e.target.value)}
        rows={6}
        className="mb-4 w-full resize-y rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-2 block text-xs font-medium">Medio principal</label>
      <div className="mb-3 flex rounded-lg border border-brand-vanilla-dark p-1 dark:border-brand-green-700">
        {OPCIONES_MEDIO.map((op) => (
          <button
            key={op.valor}
            type="button"
            onClick={() => setMedioPrincipal(op.valor)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              medioPrincipal === op.valor
                ? "bg-brand-green-600 text-white"
                : "text-brand-ink/70 hover:bg-brand-green-50 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
            }`}
          >
            {op.etiqueta}
          </button>
        ))}
      </div>

      {medioPrincipal === "video" ? (
        <input
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="https://..."
          className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
      ) : (
        <div className="mb-4">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setImagenPrincipalFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm text-brand-ink dark:text-brand-vanilla"
          />
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2 rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand-ink/70 dark:text-brand-vanilla/70">
          Ejemplo de emplatado (opcional)
        </span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setImagenEmplatadoFile(e.target.files?.[0] ?? null)}
          className="w-full text-sm text-brand-ink dark:text-brand-vanilla"
        />
        <textarea
          value={descripcionEmplatado}
          onChange={(e) => setDescripcionEmplatado(e.target.value)}
          rows={2}
          placeholder="Detalles de cómo servirlo..."
          className="w-full resize-y rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={crear}
        disabled={submitting || !titulo.trim() || !instrucciones.trim()}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {submitting ? "Creando..." : "Crear receta"}
      </button>
    </Modal>
  );
}
```

- [ ] **Step 2: Crear `EditarRecetaModal.tsx` completo**

```tsx
import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { SubidaImagen } from "../../../shared/components/SubidaImagen";
import { recetarioApi, type Receta, type RecetarioCategoria } from "../api";

interface EditarRecetaModalProps {
  receta: Receta;
  categorias: RecetarioCategoria[];
  onCerrar: () => void;
  onGuardado: () => Promise<void> | void;
  onCategoriaCreada: (categoria: RecetarioCategoria) => void;
}

const OPCIONES_MEDIO = [
  { valor: "imagen" as const, etiqueta: "Imagen" },
  { valor: "video" as const, etiqueta: "Video" },
];

export function EditarRecetaModal({
  receta,
  categorias,
  onCerrar,
  onGuardado,
  onCategoriaCreada,
}: EditarRecetaModalProps) {
  const [titulo, setTitulo] = useState(receta.titulo);
  const [categoriaId, setCategoriaId] = useState<number | "">(receta.categoria_id ?? "");
  const [instrucciones, setInstrucciones] = useState(receta.instrucciones);
  const [medioPrincipal, setMedioPrincipal] = useState<"imagen" | "video">(receta.video_url ? "video" : "imagen");
  const [videoUrl, setVideoUrl] = useState(receta.video_url ?? "");
  const [imagenPrincipalUrl, setImagenPrincipalUrl] = useState(receta.imagen_principal_url);
  const [imagenEmplatadoUrl, setImagenEmplatadoUrl] = useState(receta.imagen_emplatado_url);
  const [descripcionEmplatado, setDescripcionEmplatado] = useState(receta.descripcion_emplatado ?? "");
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [creandoCategoria, setCreandoCategoria] = useState(false);

  async function crearCategoria() {
    if (!nuevaCategoria.trim()) return;
    setCreandoCategoria(true);
    setError(null);
    try {
      const categoria = await recetarioApi.crearCategoria(nuevaCategoria.trim());
      onCategoriaCreada(categoria);
      setCategoriaId(categoria.id);
      setNuevaCategoria("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la categoría");
    } finally {
      setCreandoCategoria(false);
    }
  }

  async function subirImagenPrincipal(file: File) {
    const actualizada = await recetarioApi.subirImagenPrincipal(receta.id, file);
    setImagenPrincipalUrl(actualizada.imagen_principal_url);
    setMedioPrincipal("imagen");
    setVideoUrl("");
    await onGuardado();
  }

  async function subirImagenEmplatado(file: File) {
    const actualizada = await recetarioApi.subirImagenEmplatado(receta.id, file);
    setImagenEmplatadoUrl(actualizada.imagen_emplatado_url);
    await onGuardado();
  }

  async function guardar() {
    if (!titulo.trim() || !instrucciones.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      await recetarioApi.editar(receta.id, {
        titulo: titulo.trim(),
        instrucciones: instrucciones.trim(),
        categoriaId: categoriaId ? Number(categoriaId) : null,
        videoUrl: medioPrincipal === "video" ? videoUrl.trim() || null : undefined,
        descripcionEmplatado: descripcionEmplatado.trim() || null,
      });
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la receta");
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!confirm(`¿Eliminar la receta "${receta.titulo}"? Esta acción no se puede deshacer.`)) return;
    setEliminando(true);
    setError(null);
    try {
      await recetarioApi.eliminar(receta.id);
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar la receta");
    } finally {
      setEliminando(false);
    }
  }

  const bloqueado = guardando || eliminando;

  return (
    <Modal titulo="Editar receta" onCerrar={onCerrar} maxWidth="sm:max-w-xl">
      <label className="mb-1 block text-xs font-medium">Título</label>
      <input
        autoFocus
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Categoría</label>
      <select
        value={categoriaId}
        onChange={(e) => setCategoriaId(e.target.value ? Number(e.target.value) : "")}
        className="mb-2 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      >
        <option value="">Sin categoría</option>
        {categorias.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>

      <div className="mb-4 flex gap-2">
        <input
          value={nuevaCategoria}
          onChange={(e) => setNuevaCategoria(e.target.value)}
          placeholder="Nueva categoría..."
          className="flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-xs text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
        <button
          type="button"
          onClick={crearCategoria}
          disabled={creandoCategoria || !nuevaCategoria.trim()}
          className="rounded-md border border-brand-green-700 px-2 py-1 text-xs text-brand-green-700 hover:bg-brand-green-50 disabled:opacity-60 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
        >
          + Agregar
        </button>
      </div>

      <label className="mb-1 block text-xs font-medium">Instrucciones</label>
      <textarea
        value={instrucciones}
        onChange={(e) => setInstrucciones(e.target.value)}
        rows={6}
        className="mb-4 w-full resize-y rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-2 block text-xs font-medium">Medio principal</label>
      <div className="mb-3 flex rounded-lg border border-brand-vanilla-dark p-1 dark:border-brand-green-700">
        {OPCIONES_MEDIO.map((op) => (
          <button
            key={op.valor}
            type="button"
            onClick={() => setMedioPrincipal(op.valor)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              medioPrincipal === op.valor
                ? "bg-brand-green-600 text-white"
                : "text-brand-ink/70 hover:bg-brand-green-50 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
            }`}
          >
            {op.etiqueta}
          </button>
        ))}
      </div>

      {medioPrincipal === "video" ? (
        <input
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="https://..."
          className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
      ) : (
        <SubidaImagen imagenUrl={imagenPrincipalUrl} onSubir={subirImagenPrincipal} />
      )}

      <div className="mb-4 flex flex-col gap-2 rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand-ink/70 dark:text-brand-vanilla/70">
          Ejemplo de emplatado (opcional)
        </span>
        <SubidaImagen imagenUrl={imagenEmplatadoUrl} onSubir={subirImagenEmplatado} />
        <textarea
          value={descripcionEmplatado}
          onChange={(e) => setDescripcionEmplatado(e.target.value)}
          rows={2}
          placeholder="Detalles de cómo servirlo..."
          className="w-full resize-y rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={bloqueado || !titulo.trim() || !instrucciones.trim()}
        className="mb-2 w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar cambios"}
      </button>

      <button
        onClick={eliminar}
        disabled={bloqueado}
        className="w-full rounded-md border border-red-300 px-4 py-3 font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
      >
        {eliminando ? "Eliminando..." : "Eliminar receta"}
      </button>
    </Modal>
  );
}
```

- [ ] **Step 3: Verificar compilación**

Run: `cd frontend && npm run build`
Expected: compila sin errores (todavía no están montados en ninguna página).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/recetario/components/NuevaRecetaModal.tsx frontend/src/modules/recetario/components/EditarRecetaModal.tsx
git commit -m "feat(recetario): agrega los modales de crear/editar receta"
```

---

### Task 8: `RecetarioAdminPage.tsx`

**Files:**
- Create: `frontend/src/modules/recetario/pages/RecetarioAdminPage.tsx`

**Interfaces:**
- Consumes: `recetarioApi`/tipos de la Tarea 6; `NuevaRecetaModal`/`EditarRecetaModal` de la Tarea 7.
- Produces: componente `RecetarioAdminPage` (sin props). La Tarea 10 lo monta en la ruta `/recetario`.

- [ ] **Step 1: Crear el archivo completo**

```tsx
import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { EditarRecetaModal } from "../components/EditarRecetaModal";
import { NuevaRecetaModal } from "../components/NuevaRecetaModal";
import { recetarioApi, type Receta, type RecetarioCategoria } from "../api";

export function RecetarioAdminPage() {
  const [recetas, setRecetas] = useState<Receta[]>([]);
  const [categorias, setCategorias] = useState<RecetarioCategoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [recetaEditando, setRecetaEditando] = useState<Receta | null>(null);

  async function cargar() {
    try {
      const [r, c] = await Promise.all([recetarioApi.listar(), recetarioApi.listarCategorias()]);
      setRecetas(r);
      setCategorias(c);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las recetas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  function onCategoriaCreada(categoria: RecetarioCategoria) {
    setCategorias((actual) => [...actual, categoria].sort((a, b) => a.nombre.localeCompare(b.nombre)));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Recetario</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Recetas que ve el equipo de cocina en "Recetas".
          </p>
        </div>
        <button
          onClick={() => setModalAbierto(true)}
          className="rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
        >
          + Nueva receta
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : recetas.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
          Todavía no hay recetas.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-3 py-2">Título</th>
                <th className="px-3 py-2">Categoría</th>
                <th className="px-3 py-2">Medio</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {recetas.map((r) => (
                <tr key={r.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                  <td className="px-3 py-2 font-medium text-brand-ink dark:text-brand-vanilla">{r.titulo}</td>
                  <td className="px-3 py-2">{r.categoria_nombre ?? "—"}</td>
                  <td className="px-3 py-2">{r.video_url ? "🎬 Video" : r.imagen_principal_url ? "🖼️ Imagen" : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setRecetaEditando(r)}
                      className="rounded-md border border-brand-green-700 px-2 py-1 text-xs font-medium text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalAbierto && (
        <NuevaRecetaModal
          categorias={categorias}
          onCerrar={() => setModalAbierto(false)}
          onCreado={async () => {
            setModalAbierto(false);
            await cargar();
          }}
          onCategoriaCreada={onCategoriaCreada}
        />
      )}

      {recetaEditando && (
        <EditarRecetaModal
          receta={recetaEditando}
          categorias={categorias}
          onCerrar={() => setRecetaEditando(null)}
          onGuardado={async () => {
            setRecetaEditando(null);
            await cargar();
          }}
          onCategoriaCreada={onCategoriaCreada}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar compilación**

Run: `cd frontend && npm run build`
Expected: compila sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/recetario/pages/RecetarioAdminPage.tsx
git commit -m "feat(recetario): agrega la página de administración"
```

---

### Task 9: Helper de embed de video + `RecetarioVerPage.tsx` + `RecetaDetallePage.tsx`

**Files:**
- Create: `frontend/src/modules/recetario/video.ts`
- Create: `frontend/src/modules/recetario/pages/RecetarioVerPage.tsx`
- Create: `frontend/src/modules/recetario/pages/RecetaDetallePage.tsx`

**Interfaces:**
- Consumes: `recetarioApi`/tipos de la Tarea 6.
- Produces: `urlEmbedVideo(url)`; componentes `RecetarioVerPage`/`RecetaDetallePage` (sin props, `RecetaDetallePage` lee `:id` de la URL). La Tarea 10 los monta en `/recetario/ver` y `/recetario/ver/:id`.

- [ ] **Step 1: Crear `video.ts` completo**

```ts
/** Convierte un link de YouTube/Vimeo en una URL de embed para un <iframe>.
 *  Cualquier otro formato (Drive, etc.) no se puede incrustar de forma
 *  genérica — devuelve null, y el detalle cae a mostrar un link simple en
 *  vez de intentar un embed que no funcionaría. */
export function urlEmbedVideo(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname.includes("youtube.com")) {
    const id = u.searchParams.get("v");
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }
  if (u.hostname === "youtu.be") {
    const id = u.pathname.slice(1);
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }
  if (u.hostname.includes("vimeo.com")) {
    const id = u.pathname.split("/").filter(Boolean).pop();
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }
  return null;
}
```

- [ ] **Step 2: Crear `RecetarioVerPage.tsx` completo**

```tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, resolveImageUrl } from "../../../shared/api/client";
import { recetarioApi, type Receta, type RecetarioCategoria } from "../api";

export function RecetarioVerPage() {
  const [recetas, setRecetas] = useState<Receta[]>([]);
  const [categorias, setCategorias] = useState<RecetarioCategoria[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([recetarioApi.listar(), recetarioApi.listarCategorias()])
      .then(([r, c]) => {
        setRecetas(r);
        setCategorias(c);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar las recetas"))
      .finally(() => setLoading(false));
  }, []);

  const recetasFiltradas = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return recetas.filter((r) => {
      if (categoriaFiltro !== null && r.categoria_id !== categoriaFiltro) return false;
      if (texto && !r.titulo.toLowerCase().includes(texto)) return false;
      return true;
    });
  }, [recetas, busqueda, categoriaFiltro]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Recetas</h1>

      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar receta..."
        className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-4 py-3 text-lg text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {categorias.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {categorias.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoriaFiltro((actual) => (actual === c.id ? null : c.id))}
              className={`rounded-full border-2 px-4 py-2 text-sm font-medium transition-colors ${
                categoriaFiltro === c.id
                  ? "border-brand-green-600 bg-brand-green-50 text-brand-green-700 dark:border-brand-green-500 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                  : "border-brand-vanilla-dark text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/20"
              }`}
            >
              {c.nombre}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : recetasFiltradas.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-lg text-brand-ink/60 dark:border-brand-green-700">
          {recetas.length === 0 ? "Todavía no hay recetas." : "No se encontró ninguna receta con ese filtro."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recetasFiltradas.map((r) => (
            <Link
              key={r.id}
              to={`/recetario/ver/${r.id}`}
              className="flex flex-col overflow-hidden rounded-xl border-2 border-brand-vanilla-dark transition-colors hover:border-brand-green-600 dark:border-brand-green-700"
            >
              <div className="flex h-40 items-center justify-center bg-brand-green-50 dark:bg-brand-green-700/20">
                {r.imagen_principal_url ? (
                  <img
                    src={resolveImageUrl(r.imagen_principal_url) ?? undefined}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : r.video_url ? (
                  <span className="text-5xl" aria-hidden>
                    ▶
                  </span>
                ) : (
                  <span className="text-5xl" aria-hidden>
                    🍲
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1 p-3">
                <span className="text-lg font-semibold text-brand-ink dark:text-brand-vanilla">{r.titulo}</span>
                {r.categoria_nombre && (
                  <span className="self-start rounded-full bg-brand-green-50 px-2 py-0.5 text-xs font-medium text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                    {r.categoria_nombre}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Crear `RecetaDetallePage.tsx` completo**

```tsx
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, resolveImageUrl } from "../../../shared/api/client";
import { recetarioApi, type Receta } from "../api";
import { urlEmbedVideo } from "../video";

export function RecetaDetallePage() {
  const { id } = useParams<{ id: string }>();
  const [receta, setReceta] = useState<Receta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    recetarioApi
      .obtener(id)
      .then(setReceta)
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar la receta"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!receta) return null;

  const embedVideo = receta.video_url ? urlEmbedVideo(receta.video_url) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link
        to="/recetario/ver"
        className="self-start text-sm font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla"
      >
        ← Volver a recetas
      </Link>

      <h1 className="text-3xl font-bold text-brand-green-700 dark:text-brand-vanilla">{receta.titulo}</h1>
      {receta.categoria_nombre && (
        <span className="self-start rounded-full bg-brand-green-50 px-3 py-1 text-sm font-medium text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
          {receta.categoria_nombre}
        </span>
      )}

      {receta.imagen_principal_url && (
        <img
          src={resolveImageUrl(receta.imagen_principal_url) ?? undefined}
          alt=""
          className="w-full rounded-xl object-cover"
        />
      )}

      {receta.video_url &&
        (embedVideo ? (
          <div className="aspect-video w-full overflow-hidden rounded-xl">
            <iframe src={embedVideo} allowFullScreen className="h-full w-full" title={receta.titulo} />
          </div>
        ) : (
          <a
            href={receta.video_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-brand-green-700 px-4 py-3 text-center text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
          >
            ▶ Ver video
          </a>
        ))}

      <p className="whitespace-pre-wrap text-xl leading-relaxed text-brand-ink dark:text-brand-vanilla">
        {receta.instrucciones}
      </p>

      {(receta.imagen_emplatado_url || receta.descripcion_emplatado) && (
        <div className="flex flex-col gap-3 rounded-xl border border-brand-vanilla-dark p-4 dark:border-brand-green-700">
          <h2 className="text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">Ejemplo de emplatado</h2>
          {receta.imagen_emplatado_url && (
            <img
              src={resolveImageUrl(receta.imagen_emplatado_url) ?? undefined}
              alt=""
              className="w-full rounded-lg object-cover"
            />
          )}
          {receta.descripcion_emplatado && (
            <p className="text-base text-brand-ink/80 dark:text-brand-vanilla/80">{receta.descripcion_emplatado}</p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verificar compilación**

Run: `cd frontend && npm run build`
Expected: compila sin errores.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/recetario/video.ts frontend/src/modules/recetario/pages/RecetarioVerPage.tsx frontend/src/modules/recetario/pages/RecetaDetallePage.tsx
git commit -m "feat(recetario): agrega la navegación de solo lectura para cocina"
```

---

### Task 10: Registrar en el menú y en las rutas

**Files:**
- Modify: `frontend/src/shared/layout/modules-meta.ts`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `RecetarioAdminPage` (Tarea 8), `RecetarioVerPage`/`RecetaDetallePage` (Tarea 9).

- [ ] **Step 1: Agregar las dos entradas al menú lateral**

`old_string`:

```
  { slug: "pedidos", label: "Pedidos", path: "/pedidos", icon: "📋" },
  // Gestor de usuarios: exclusivo de Root/Super Root, se ancla al final del
```

`new_string`:

```
  { slug: "pedidos", label: "Pedidos", path: "/pedidos", icon: "📋" },
  // Recetario: Root/Super Root administran las recetas; Cocina (y también
  // Root/Super Root, para poder revisar cómo le queda) las navega en una
  // pantalla aparte, pensada para leerse mientras se cocina.
  { slug: "recetario", label: "Recetario", path: "/recetario", icon: "📖", roles: ["Super Root", "Root"] },
  { slug: "recetario", label: "Recetas", path: "/recetario/ver", icon: "🍲", roles: ["Super Root", "Root", "Cocina"] },
  // Gestor de usuarios: exclusivo de Root/Super Root, se ancla al final del
```

- [ ] **Step 2: Importar las páginas en `App.tsx`**

`old_string`:

```
import { UsuariosPage } from "./modules/general/pages/UsuariosPage";
import { DetalleValePage } from "./modules/vales/pages/DetalleValePage";
```

`new_string`:

```
import { UsuariosPage } from "./modules/general/pages/UsuariosPage";
import { RecetaDetallePage } from "./modules/recetario/pages/RecetaDetallePage";
import { RecetarioAdminPage } from "./modules/recetario/pages/RecetarioAdminPage";
import { RecetarioVerPage } from "./modules/recetario/pages/RecetarioVerPage";
import { DetalleValePage } from "./modules/vales/pages/DetalleValePage";
```

- [ ] **Step 3: Registrar las tres rutas**

`old_string`:

```
        <Route path="/vales" element={<ValesPage />} />
        <Route path="/vales/:id" element={<DetalleValePage />} />
        <Route path="/menu" element={<MenuPage />} />
```

`new_string`:

```
        <Route path="/vales" element={<ValesPage />} />
        <Route path="/vales/:id" element={<DetalleValePage />} />
        <Route path="/recetario" element={<RecetarioAdminPage />} />
        <Route path="/recetario/ver" element={<RecetarioVerPage />} />
        <Route path="/recetario/ver/:id" element={<RecetaDetallePage />} />
        <Route path="/menu" element={<MenuPage />} />
```

- [ ] **Step 4: Verificar compilación**

Run: `cd frontend && npm run build`
Expected: compila sin errores — esta es la primera verificación de todo el módulo frontend conectado de punta a punta.

- [ ] **Step 5: Verificación manual (usuario, en su entorno, después de correr la migración de la Tarea 1)**

1. Iniciar sesión como Root/Super Root → aparecen "Recetario" y "Recetas" en el menú.
2. En "Recetario", crear una receta con imagen principal → aparece en la tabla con el badge "🖼️ Imagen".
3. Crear otra con un link de YouTube como video → badge "🎬 Video".
4. Editar la primera, cambiar su medio principal a video → la imagen anterior deja de aplicar (el backend la limpia solo).
5. En "Recetas", buscar por texto y filtrar por categoría → la grilla se actualiza sin recargar.
6. Abrir el detalle de la receta con video de YouTube → se ve incrustado y se puede reproducir.
7. Pegar un link de Google Drive como video en una receta nueva → en el detalle aparece como un botón "▶ Ver video" (no un embed roto).
8. Eliminar una receta desde "Recetario" → confirmación, luego desaparece de la tabla y de "Recetas".
9. Iniciar sesión como un usuario con rol Cocina → solo ve "Recetas" en el menú (no "Recetario"), y dentro de "Recetas" no hay ningún botón de editar/eliminar.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/shared/layout/modules-meta.ts frontend/src/App.tsx
git commit -m "feat(recetario): registra el módulo en el menú y las rutas"
```

---

## Execution Handoff

**Esta vez sí hay migración de base de datos** (Tarea 1) — hay que entregársela al usuario para que la corra a mano en phpMyAdmin antes de que el módulo funcione contra una base real; el resto del plan solo se verifica con `tsc`/`npm run build`. Dado que ya se aprobó ejecución Native (inline, en esta misma sesión) y trabajo directo en `main`, se recomienda continuar igual para este plan salvo que el usuario prefiera otro método.
