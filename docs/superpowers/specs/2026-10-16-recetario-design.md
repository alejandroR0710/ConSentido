# Recetario — diseño

**Fecha:** 2026-10-16
**Estado:** Aprobado en brainstorming, pendiente de plan de implementación.

## 1. Qué es esto

Un módulo nuevo: Root y Super Root crean, editan y eliminan recetas (título, instrucciones, categoría, un medio principal que es imagen o video — nunca los dos a la vez —, y opcionalmente una imagen + descripción corta de ejemplo de emplatado). El rol Cocina las navega en una pantalla aparte, pensada para usarse mientras se cocina: letra grande, tarjetas con imagen, buscador y filtro por categoría para encontrar la receta rápido.

**Decisiones de alcance:**
- El video es siempre un link (YouTube/Vimeo/Drive/etc.), nunca un archivo subido — se incrusta en la pantalla del detalle. No existe en este repo ningún precedente de subir/servir archivos de video, y el almacenamiento en disco que ya usa la app para imágenes no es duradero en el hosting actual — construir subida de video real sería infraestructura nueva y riesgosa, fuera de lo que esta funcionalidad necesita.
- "Imagen o video" es una elección del medio principal — una receta tiene como máximo uno de los dos, nunca ambos a la vez. Puede no tener ninguno (una receta solo de texto es válida).
- Dos pantallas separadas, no una que se adapta por rol: una de administración (Root/Super Root) y una de navegación de solo lectura (Cocina, y también Root/Super Root para poder revisar cómo le queda a Cocina).
- Categorías: una lista simple, creable sobre la marcha al crear/editar una receta — mismo patrón ya usado para las categorías de productos en este sistema. No es una pantalla de administración aparte.
- Nombrado `recetario_*` (tablas) y `recetario.*` (permisos/slug de módulo) en todo — este sistema ya tiene un concepto distinto de "receta" dentro de Migao (recetas de amasijos para inventario), y este nombrado evita la ambigüedad.

**Fuera de alcance:** subir archivos de video; un flujo de "borrador/publicado" (toda receta creada queda visible de inmediato para Cocina); un límite de cantidad de recetas; paginación en el backend (la cantidad de recetas no lo justifica, se filtra sobre la lista ya cargada).

## 2. Modelo de datos

**`recetario_categorias`** — mismo shape que `categorias_producto` ya existente:
- `id` (PK autoincremental).
- `nombre` (único).

**`recetario_recetas`:**
- `id` (PK, UUID — mismo patrón que el resto de las tablas de este sistema).
- `titulo` (obligatorio).
- `instrucciones` (texto largo, obligatorio — el "text area" de la receta).
- `categoria_id` (FK a `recetario_categorias`, opcional — nulo si no se eligió ninguna).
- `video_url` (opcional).
- `imagen_principal_url` (opcional) — como mucho uno de `video_url`/`imagen_principal_url` tiene valor a la vez; nunca los dos juntos.
- `imagen_emplatado_url` (opcional) e `descripcion_emplatado` (texto corto, opcional) — independientes entre sí; cualquiera de las dos puede tener valor sin la otra.
- `creado_por_id` (FK a `usuarios`, quién la creó — mismo patrón que otros módulos de este sistema).
- `created_at`, `updated_at`.

## 3. Arquitectura

- **Backend:** módulo nuevo `backend/src/modules/recetario/` (`recetario.schema.ts`/`.repository.ts`/`.service.ts`/`.controller.ts`/`.routes.ts`), mismo patrón ya usado por el módulo Vales de este sistema. Montado en `backend/src/app.ts` bajo `/api/v1/recetario`.
- **Permisos:** módulo nuevo en la tabla `modulos` con slug `recetario`. Dos permisos: `recetario.ver` (otorgado a Root, Super Root y Cocina) y `recetario.administrar` (crear/editar/eliminar recetas y categorías — solo Root y Super Root).
- **Subida de imágenes:** reusa el mecanismo ya existente de este sistema (el mismo que usan los productos) con una subcarpeta nueva (`recetario`) — sin cambios al mecanismo en sí, solo un punto de montaje nuevo.
- **Frontend:** módulo nuevo `frontend/src/modules/recetario/` con `api.ts` y dos páginas independientes:
  - `RecetarioAdminPage.tsx` (ruta `/recetario`) — administración, Root/Super Root.
  - `RecetarioVerPage.tsx` (ruta `/recetario/ver`) — navegación de solo lectura, Cocina + Root/Super Root.
- **Navegación:** dos entradas nuevas en el menú lateral (mismo patrón ya usado por Amasijos, que también comparte una entrada entre varios roles): "Recetario" (administrar — Root/Super Root) y "Recetas" (ver — Root, Super Root, Cocina).

## 4. Flujo y manejo de errores

- **Crear/editar (admin):** título e instrucciones obligatorios; categoría opcional, con la opción de crear una nueva ahí mismo (igual que al crear un producto). Un selector "Imagen / Video" para el medio principal — elegir uno limpia el valor del otro, nunca coexisten. Las dos imágenes (principal y de emplatado) usan el componente de subida ya existente en la app, sin cambios.
- **Eliminar (admin):** borrado directo — nada más en el sistema depende de una receta, así que no hace falta un "borrado suave" como en otros módulos de este sistema.
- **Navegar (cocina y Root/Super Root en modo vista):** buscador de texto + filtro por categoría, aplicados sobre la lista ya cargada en el navegador — no se vuelve a pedir al backend por cada letra escrita ni por cada filtro. Tocar una tarjeta abre el detalle completo de esa receta.
- **Receta sin medio principal:** el detalle no muestra esa sección — ni una imagen rota ni un espacio vacío raro.
- **Receta sin recetas todavía (lista vacía):** un mensaje claro en vez de una grilla vacía sin explicación, en las dos pantallas.
- **Validación del link de video:** se exige que sea una URL con forma válida (protocolo http/https) antes de guardar — no se valida de qué plataforma viene ni que el video exista.

## 5. UI

**Pantalla de administración** (`/recetario`, Root/Super Root): lista tipo tabla (mismo patrón visual que la pantalla de Vales de este sistema) — columnas título, categoría, un badge indicando si tiene video o imagen como medio principal, y botones de editar/eliminar por fila. Botón "+ Nueva receta" arriba de la tabla. Crear/editar abre un modal con: título, categoría (select + opción de crear una nueva), textarea de instrucciones, el selector Imagen/Video con su campo correspondiente debajo, y una sección aparte más abajo, "Ejemplo de emplatado", con su propia imagen y descripción corta.

**Pantalla de navegación** (`/recetario/ver`, Cocina + Root/Super Root): arriba, un buscador de texto y chips de categoría (tocar uno activa/desactiva ese filtro). Debajo, una grilla de tarjetas grandes pensada para tocarse fácil desde una tableta de cocina (pocas tarjetas por fila, tamaño grande) — cada tarjeta muestra la imagen principal si la tiene, o un fondo genérico con un ícono grande de "▶" si el medio es un video (no se genera una vista previa real del video — los links pueden venir de distintas plataformas y no hay una forma simple de sacar una miniatura real de todas), o un ícono genérico si la receta no tiene ningún medio. Debajo, el título en letra grande y la categoría como badge pequeño.

Tocar una tarjeta lleva al detalle de esa receta (ruta `/recetario/ver/:id`, para que el botón "atrás" del navegador funcione de forma natural): título grande arriba, el video incrustado o la imagen principal en grande, instrucciones abajo en letra notablemente más grande que el resto de la app (pensada para leerse cocinando, no de cerca), y si existe, una sección final "Ejemplo de emplatado" con su imagen y descripción.

## Decisiones explícitas (para que el plan no las reabra)

- Video = siempre un link, nunca un archivo subido.
- El medio principal de una receta es imagen O video, nunca los dos a la vez; puede no tener ninguno.
- Dos pantallas separadas (administración y navegación), no una pantalla adaptada por rol.
- Categorías creables sobre la marcha, sin pantalla de administración propia.
- Nombrado `recetario_*`/`recetario.*` en todo, para no chocar con las recetas de amasijos ya existentes en Migao.
- Borrado directo de una receta, sin borrado suave.
- Filtrado/búsqueda en el navegador sobre la lista ya cargada, sin paginación en el backend.
- El detalle de una receta vive en su propia ruta (`/recetario/ver/:id`), no en un modal.
