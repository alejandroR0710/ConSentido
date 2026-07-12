# Fase 5 - Desarrollo (en curso)

## Objetivo
Construir el código real sobre la arquitectura de la Fase 4: backend y frontend funcionando end-to-end, autenticación completa, y el primer módulo de negocio (Insumos) operativo como referencia para los módulos restantes.

## Identidad visual
- Colores de marca: **verde oscuro** (`#1F4A34` primario, `#14291F` para fondos oscuros/nav) y **blanco vainilla** (`#FBF3E1`), evocando naturaleza. Definidos como tokens Tailwind v4 en `frontend/src/index.css` (`--color-brand-green-*`, `--color-brand-vanilla*`) y reutilizados en el `theme_color`/`background_color` del manifest PWA (`frontend/vite.config.ts`).
- Aplican tanto en modo claro (fondo vainilla) como oscuro (fondo verde oscuro), respetando `prefers-color-scheme`.

## Qué se construyó

### Backend (`backend/`)
- Express + TypeScript, arquitectura en capas (`routes → controller → service → repository`) tal como define `FASE4_ARQUITECTURA_TECNICA.md`.
- `shared/`: pool de PostgreSQL (`pg`), manejador central de errores (`AppError` + Zod), `asyncHandler` para propagar errores async en Express 4.
- **Auth** (`modules/general/auth`): `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`. Access token JWT (15 min) devuelto en el body; refresh token en cookie httpOnly (`sameSite: strict`, scoped a `/api/v1/auth`). La sesión se cierra a un **tope absoluto de 10 horas desde el login** (no una ventana deslizante): el refresh token lleva el timestamp del login original y cada renovación lo preserva, así que refrescar seguido no extiende la sesión más allá de esas 10 horas.
- **RBAC** (`shared/middlewares/rbac.middleware.ts`): `requirePermission(codigo)` consulta `roles_permisos`/`permisos` en cada request — revocar un permiso a un rol aplica de inmediato sin reemitir tokens.
- **Insumos** (`modules/insumos`): CRUD de insumos, listado de almacenes, y `POST /insumos/movimientos` — el endpoint puente que ajusta `inventario_insumos` dentro de una transacción (`BEGIN/COMMIT/ROLLBACK` con `SELECT ... FOR UPDATE` para evitar carreras), valida stock suficiente en salidas/transferencias, y genera una alerta automática si el stock resultante queda por debajo del mínimo.
- **Caja General** (`modules/general/caja`): implementa el rol transversal de Cajero, con **dos cuentas independientes por método de pago** (efectivo y banco) más el total general.
  - `POST /caja/turnos` abre el turno del día — **los montos iniciales (efectivo y banco) se heredan automáticamente** de los montos finales del último turno cerrado (el ingreso es diario, no arranca en cero cada vez). Un índice único parcial en `turnos_caja` garantiza un solo turno abierto para todo el negocio a la vez.
  - `POST /caja/ingresos` registra un pago que viene de cualquier módulo (el cajero elige `moduloOrigenSlug`: insumos, talleres, con_sentido, migao, pedidos o general) y el `metodoPago` (`efectivo` o `banco`).
  - `POST /caja/egresos` registra un retiro de la caja para gasto interno (categoría, monto, método de pago, motivo); queda con fecha/hora y el usuario que lo hizo — sin flujo de aprobación en esta primera versión.
  - `PATCH /caja/turnos/:id/cerrar` recibe solo el conteo físico de efectivo (`montoFinalDeclaradoEfectivo`) y calcula, por separado, `calculado_efectivo` (con su diferencia contra lo declarado) y `calculado_banco` (sin conteo físico, es electrónico).
  - `GET /caja/turno-actual`, `GET /caja/turnos/:id/resumen` (incluye saldos efectivo/banco/general), `GET/POST /caja/categorias-gasto` completan el CRUD de apoyo.
- **Migao** (`modules/migao`) — slice mínimo para conectar el cobro con Caja General y la cola de cocina; el mapa visual de mesas y la toma de pedidos completa quedan pendientes:
  - `GET /migao/ordenes/:id` — pantalla de cobro: devuelve cada línea de la orden con su valor independiente (`cantidad × precio_unitario`) y el `total` general.
  - `POST /migao/ordenes/:id/cerrar` — **el permiso `migao.ordenes.cerrar` se asigna únicamente al rol Cajero**; ningún otro rol (mesero, cocina, supervisor) puede cerrar una mesa/orden. En una sola transacción: crea la `venta` + `venta_items`, registra el `pago`, llama a `cajaService.registrarIngreso(...)` con el mismo `PoolClient` (para que quede atado a la misma transacción — si no hay un turno de caja abierto, todo se revierte y la orden no se cierra), y finalmente marca la orden como `cerrada`.
  - **Cocina** (permisos propios `migao.cocina.ver`/`migao.cocina.actualizar_estado`, separados de `migao.ordenes.*`): el estado "preparando" es **de toda la orden, no por producto** — `POST /ordenes/:id/empezar-preparar` mueve de una vez todos los ítems `pendiente` de esa orden a `preparando`. Cada producto tiene un check individual (`orden_items.listo_cocina`, `PATCH /items/:id/check`) que cocina marca a medida que termina cada uno. `POST /ordenes/:id/marcar-listo` pone toda la orden en `listo` pero el backend lo **rechaza** si queda algún producto sin empezar o algún check sin marcar (409 con el conteo de faltantes). Editar la cantidad de un ítem (mesero) le resetea el check a `false` además de devolverlo a `pendiente`.
  - `POST /migao/ordenes`, `POST /migao/ordenes/:id/items`, `GET /migao/mesas` son endpoints de apoyo mínimos para poder probar el flujo de cobro de punta a punta.

### Frontend (`frontend/`)
- Vite + React + TypeScript, PWA vía `vite-plugin-pwa` (manifest instalable + service worker con `StaleWhileRevalidate` para `GET /api/v1/*`).
- Tailwind CSS v4 con la paleta de marca.
- **Auth** (`shared/auth`): `AuthProvider` mantiene el access token en memoria (no en localStorage, para reducir superficie de robo por XSS), intenta una sesión silenciosa vía `/auth/refresh` + `/auth/me` al cargar la app, y expone `login`/`logout`. El cliente HTTP (`shared/api/client.ts`) reintenta automáticamente una vez con refresh token si recibe 401.
- **Layout responsive por rol** (`shared/layout/AppShell.tsx` + `RoleNav.tsx`): un mismo listado de módulos (filtrado por `usuario.modulos`) alimenta un sidebar en desktop (`md:block`) y una barra de navegación inferior en mobile (`md:hidden`), el patrón típico de apps POS para navegación con el pulgar.
- **Dashboard no es para todos** (`modules/general/pages/HomeRoute.tsx`, `shared/layout/modules-meta.ts`): el backend ahora devuelve `usuario.rol` (nombre del rol) en `login`/`me`. Solo los roles listados en `ROLES_CON_DASHBOARD` (hoy: Super Root) ven el link "Dashboard" y aterrizan ahí en "/"; el resto (Cajero, Cocina, Mesero) no tiene ese link en el menú y "/" los redirige directo a su pantalla de trabajo vía `ROLE_HOME` (`Cajero→/migao`, `Cocina→/cocina`, `Mesero→/mesero`), con fallback al primer módulo accesible si un rol nuevo no está en el mapa.
- **Módulo Insumos** (`modules/insumos`): listado de insumos, formulario de alta, y formulario de registro de movimientos que consume `POST /insumos/movimientos` y refleja el nuevo stock devuelto por el backend.
- **Migao — cobro** (`modules/migao/pages/MigaoPage.tsx`): lista de órdenes abiertas, detalle con cada línea y el total al seleccionar una, y cierre/cobro (el backend rechaza el cierre si el usuario no es Cajero). Cada línea muestra también su estado de cocina (pendiente/preparando/listo/servido/cancelado, con el mismo código de color que usa Cocina) y un aviso si todavía hay productos sin terminar — el dato ya venía del backend (`migao.ordenes.ver` lo incluye), solo faltaba mostrarlo.
- **Migao — Cocina** (`modules/migao/pages/CocinaPage.tsx`): agrupado por **mesa → orden** (no por producto suelto). Por cada orden: si hay ítems `pendiente`, un botón único "Empezar a preparar" los mueve todos juntos a `preparando`; cada ítem en `preparando` se muestra como una fila con checkbox grande (toca para marcar/desmarcar `listo_cocina`); el botón "Marcar orden lista" solo se habilita cuando no queda ningún pendiente y todos los checks están marcados (si no, muestra "Falta marcar todos los productos" y queda deshabilitado — el backend también lo valida, así que no se puede saltar tocando la API directo). Mesas ordenadas por la que espera hace más tiempo. Refresco automático cada 8s.
- **Migao — Mesero** (`modules/migao/pages/MeseroPage.tsx`): la orden se arma completa **antes** de crearla. Botón "+ Nueva orden" abre un borrador local (número de mesa + productos agregados vía el mismo buscador) que no toca el backend hasta tocar "Crear orden" — ahí sí se crea la orden y todos sus ítems juntos, en una sola llamada atómica. Tocar el mismo producto varias veces en el borrador suma cantidad en vez de duplicar la línea. Después de creada, se edita con el flujo normal (agregar más, editar cantidad, cancelar). La mesa se resuelve o se crea sola por número (`getOrCreateMesaPorNumero`) y el `comensal_numero` lo asigna la base de datos vía secuencia (`comensal_seq`), sin intervención del mesero. Editar la cantidad de un ítem lo regresa a `pendiente` y le quita el check de cocina. "Entregado" marca como `servido` un ítem que cocina dejó en `listo`. Cada alta/edición/cancelación/entrega queda en `orden_historial`, mostrado con texto legible por acción (íconos y colores, no JSON crudo) vía el componente `HistorialOrden`. Hace polling cada 5s de `GET /migao/items/activos` y, si algún ítem pasa a `preparando` o `listo` desde la última consulta, reproduce un beep (Web Audio API, sin archivo de sonido) y muestra un banner — limitado a mientras la página Mesero esté abierta (no es una notificación global de la app).
- **Buscador de productos** (`modules/migao/components/SelectorProductoModal.tsx`): un único botón "+ Agregar producto" abre un buscador en pantalla completa/bottom-sheet (mobile-first) con barra de búsqueda arriba y la lista completa del menú debajo; tocar un producto lo agrega y el buscador se queda abierto para seguir agregando varios seguidos. Reemplazó el `<select>` + input de cantidad que había antes (incómodo en mobile).
- Navegación de módulos ahora soporta más de una entrada por módulo (`modules-meta.ts`: "Mesero", "Migao (POS)" y "Cocina" comparten el slug `migao`), ya que distintos sub-roles del mismo módulo necesitan pantallas completamente distintas.

### Rediseño de UX: popups + vistas propias (Mesero, Cocina, Caja)
Rediseño puramente de presentación (ninguna llamada a la API cambió) para que las tres pantallas de trabajo se sientan más rápidas, con menos secciones permanentemente visibles:
- **`shared/components/Modal.tsx`** (nuevo): overlay genérico (bottom-sheet en mobile, diálogo centrado en desktop), extraído del patrón que ya tenía `SelectorProductoModal`. Todos los popups nuevos lo usan.
- **`modules/migao/components/EstadoBadge.tsx`** (nuevo): centraliza el color por estado de ítem, antes duplicado en Migao/Mesero/Cocina.
- **Cocina**: se aplanó "mesa → orden → ítems" a un ticket por orden en una cuadrícula (la mesa queda como etiqueta dentro del ticket, no como contenedor). Misma lógica de `empezarPreparar`/`marcarCheckItem`/`marcarOrdenLista`, solo cambió el agrupamiento visual.
- **Mesero**: pasó de dos columnas siempre visibles a un flujo de una pantalla a la vez (`vista: "lista" | "detalle" | "nueva"`). Editar cantidad/cancelar un producto ahora abre `EditarItemModal` en vez de un input+botón permanente por fila; el historial se abre en un `Modal` con un botón "Ver historial" en vez de un `<details>` siempre expandido.
- **Caja**: "Registrar ingreso"/"Registrar egreso" pasaron de formularios siempre visibles a `IngresoModal`/`EgresoModal` abiertos con botones "+ Ingreso"/"− Egreso"; "Cerrar turno" pasó a `CerrarTurnoModal`; los movimientos del turno pasaron de tabla a lista de tarjetas.
- **Cobro (Cajero)**: toque de consistencia — reutiliza `EstadoBadge` y muestra los ítems como tarjetas en vez de tabla.
- Corregido: todos los `<select>` del proyecto usaban `bg-transparent` sin color de texto explícito — el texto heredaba el color del tema pero el desplegable nativo de opciones cae a fondo blanco por defecto, así que en tema oscuro el texto claro quedaba ilegible sobre blanco. Ahora cada `<select>` tiene fondo y texto explícitos para ambos temas.
- Corregido: las cantidades (`NUMERIC` de Postgres) llegaban como texto con ceros ("1.000") y se mostraban así en pantalla; se agregó `modules/migao/format.ts` (`formatCantidad`) y se aplicó en Cocina, Migao y Mesero.
- Corregido: `MODULES_META` (`shared/layout/modules-meta.ts`) ahora soporta un campo `roles?: string[]` por entrada. Antes el nav filtraba solo por módulo, así que un Cajero veía en el menú los links "Mesero" y "Cocina" (comparten el slug `migao`) y al tocarlos el backend le devolvía 403 (`No tiene el permiso requerido: migao.cocina.ver`, etc.) — confuso porque el link estaba ahí pero no funcionaba. Ahora "Mesero"/"Migao (POS)"/"Cocina" declaran `roles: ["Mesero"]`/`["Cajero"]`/`["Cocina"]` y `RoleNav` los filtra también por `usuario.rol` (Super Root sigue viendo todo). `HomeRoute` aplica el mismo filtro en su fallback.

### Mesero: personas y piso al crear la orden
- **`ordenes.numero_personas`** (SMALLINT, nullable): cuántas personas hay en la mesa, dato opcional que el mesero puede dejar en blanco. Se envía junto con el resto del borrador al crear la orden (`crearOrdenSchema.numeroPersonas`, entero positivo opcional).
- **`mesas.piso`** (SMALLINT NOT NULL DEFAULT 1): por ahora el negocio solo tiene piso 1 y 2. El índice único que permite el "get-or-create" de mesas por número pasó de `(numero)` a `(numero, piso)` — el mismo número de mesa ahora puede existir en ambos pisos como mesas físicas distintas (ej. "Mesa 7 piso 1" y "Mesa 7 piso 2" no son la misma mesa). `getOrCreateMesaPorNumero(numero, piso)` y todas las consultas que unen `mesas` (listado de órdenes, cola de cocina, ítems activos) devuelven también `mesa_piso`.
- **Frontend (`MeseroPage.tsx`)**: en "Nueva orden", junto al número de mesa hay un selector tipo segmented-control "Piso 1"/"Piso 2" (por defecto Piso 1, el mesero lo cambia si hace falta) y, debajo, un input opcional "Personas". El piso se muestra junto al número de mesa donde ya se mostraba (lista y detalle de Mesero, ticket de Cocina, tabla de cobro del Cajero) para que no haya ambigüedad entre mesas con el mismo número en pisos distintos.
- Verificado por API: crear una orden para "mesa 99 piso 2" y otra para "mesa 99" (piso 1 por defecto) resuelve a dos `mesa_id` distintos, sin violar la restricción única.

### Menú del Migao con categorías + carga del menú real
- La tabla `categorias_producto` ya existía en el esquema (Fase 3) pero no tenía ni backend ni frontend para el módulo Migao. Se agregó `GET/POST /migao/categorias` (mismos permisos `migao.productos.ver`/`.crear` que ya tenía el resto del catálogo, sin permisos nuevos) y `productos.categoria_id` ahora se puede setear al crear/editar un producto (`crearProductoSchema`/`editarProductoSchema` con `categoriaId` opcional).
- **`MenuPage.tsx`**: la tabla de administración ahora se agrupa por categoría (una sub-tabla con encabezado por categoría; "Sin categoría" siempre al final). **`NuevoProductoModal.tsx`**/**`EditarProductoModal.tsx`**: select de categoría + alta rápida de una categoría nueva sin salir del modal (mismo patrón "+ Agregar" que ya usaba `EgresoModal` de Caja para categorías de gasto). **`SelectorProductoModal.tsx`** (buscador del Mesero): ahora muestra subtítulos de categoría entre los resultados para ubicarse más rápido al armar un pedido — el backend ya devuelve los productos activos ordenados por categoría.
- Se cargó el menú real del negocio ("Con Sentido — El Rinconito del Migao") vía API como Administrador: 5 categorías (Migaos, Para antojarse más, Bebidas calientes, Bebidas frías, Postres) y 28 productos con sus precios reales, incluyendo la descripción real (ver sección de descripciones más abajo) de los 5 productos "Migao"/"Migadito" que la tenían en la carta física.
- Los 3 productos de prueba (Hamburguesa, Limonada, una Torta de chocolate sin categoría) se **eliminaron por completo** a pedido explícito del usuario — no solo desactivado. Como tenían 5 órdenes ya cerradas y cobradas (ventas + pagos + movimientos de Caja reales, ~$198.000), se le explicó al usuario el impacto antes de proceder; confirmó el borrado total y se ejecutó en una transacción en el orden correcto (`pagos` → `movimientos_caja` → `ventas` → `ordenes` [cascada a `orden_items`/`orden_historial`] → `productos`) para no violar ninguna FK.

### Formato de precios: símbolo $ y separador de miles
Todos los montos que se muestran en pantalla (precios de productos/insumos, totales de orden, saldos y movimientos de Caja) pasaron de texto crudo (`"22000.00"`, `.toFixed(2)`) a un formato único: `shared/format/money.ts` → `formatMoney()`, que redondea a entero y usa `Number.toLocaleString("es-CO")` para el separador de miles con punto — ej. `$22.000`. Reemplaza también los dos `formatearMoneda` locales que ya existían en Caja (`CajaPage.tsx`, `CerrarTurnoModal.tsx`), ahora reexportados desde el helper compartido.

### Descripción opcional (colapsable) para productos e insumos
Columna `descripcion TEXT` nueva en `productos` e `insumos`, opcional en ambos schemas de creación/edición. En `MenuPage.tsx`/`InsumosListPage.tsx` cada fila con descripción muestra un `<details>`/`<summary>` nativo ("Descripción") colapsado por defecto — sin JS de estado, con soporte de teclado/accesibilidad gratis. Los formularios de alta/edición (`Nuevo`/`Editar` de producto e insumo) tienen un textarea opcional para cargarla.

### Rol Administrador: Menú (Migao) e Insumos con foto
Nuevo rol `Administrador` (sin acceso a órdenes, cobros ni cocina) para gestionar el catálogo:
- **Backend**: nuevos permisos `migao.productos.{ver,crear,editar}` (además de `insumos.insumos.{ver,crear,editar}` que ya existían). `PATCH /migao/productos/:id` y `PATCH /insumos/:id` editan o "eliminan" (soft-delete vía `activo:false`, nunca se borra físicamente porque puede haber ventas/movimientos ya referenciándolo); `GET /migao/productos/admin` y `GET /insumos/admin` listan todo incluyendo inactivos, para poder reactivar. `/admin` está registrado antes de `/:id` en las rutas Express (si no, `/:id` lo interceptaba primero).
- **Frontend**: "Catálogo" se renombró a "Menú" (`/menu`, solo visible para `Administrador`); "Nuevo producto"/"Nuevo insumo"/"Registrar movimiento" son popups (`Modal`) accionados por botón, ya no formularios siempre visibles; cada fila de Menú/Insumos tiene un botón "Editar" que abre `EditarProductoModal`/`EditarInsumoModal` con guardar cambios + alternar activo/inactivo.
- **Fotos de producto/insumo**: `multer` (disco local, `backend/uploads/{productos,insumos}/<uuid>.<ext>`, servido vía `express.static`, límite 5MB, solo `image/*`) + columna `imagen_url TEXT` en `productos` e `insumos`. Componente compartido `shared/components/SubidaImagen.tsx` (miniatura + botón "Cambiar foto") integrado en ambos modales de edición; miniaturas también visibles en las tablas de listado de Menú e Insumos. Limitación conocida: almacenamiento en disco local, no sobrevive a un redeploy en hosting con disco efímero — migrar a Supabase Storage está contemplado en FASE4 como paso de producción.
- Bug encontrado y corregido durante la verificación por API: tanto el uploader (`upload.middleware.ts`) como el `express.static` de `app.ts` resolvían la carpeta `uploads/` con `path.join(__dirname, ...)`. Como el backend corre con `tsx` directo desde `src/` (sin paso de compilación a `dist/`), ambos `__dirname` apuntaban a carpetas distintas y la imagen subida quedaba en `backend/src/uploads/` mientras el servidor estático buscaba en `backend/uploads/` (404). Se cambiaron ambos a `path.join(process.cwd(), "uploads")`, estable sin importar si el proceso corre desde `src/` o `dist/`.

### Cocina: sonido de pedido nuevo + alerta de 20 minutos sin atender
- **Sonido de pedido nuevo**: `CocinaPage.tsx` guarda en un ref los IDs de ítems ya vistos en el poll anterior (cada 8s); si en el siguiente poll aparece un ID nuevo, suena una notificación. Se ignora el primer *fetch* de la página para no sonar con los pedidos que ya estaban ahí al abrir.
- **Alerta de 20 minutos**: como `GET /migao/cocina/items` solo devuelve ítems en `pendiente`/`preparando` (los `listo`/`servido` ya no aparecen), cualquier ticket que siga en la cola más de `MINUTOS_ALERTA` (20) desde su ítem más viejo está, por definición, sin atender o atascado en preparación. Al cruzar ese umbral: suena una vez `reproducirAlerta()` (3 tonos graves, más urgente que el resto — no se repite en cada poll, se marca la orden en un ref para no volver a sonar) y el ticket queda con **borde naranja intenso + parpadeo** (`animate-pulse`) y una etiqueta "+20 min", visibles hasta que se resuelva (deja de aparecer en la cola).
- Limitación conocida (igual que la notificación de Mesero): es sonido de pestaña abierta, no push del sistema operativo — si la pestaña de Cocina no está abierta/enfocada no suena.

### Sonidos: catálogo de 3 tipos + desbloqueo en móvil
- `modules/migao/beep.ts` quedó con tres sonidos con roles distintos: `reproducirBeep()` (el original, ítem individual cambia de estado), `reproducirNotificacionSuave()` (pedido nuevo en Cocina, orden lista en Mesero — un "tick" corto de 1200Hz con decaimiento exponencial rápido, mucho menos intrusivo que un beep sostenido) y `reproducirAlerta()` (3 tonos graves, solo para la alerta de 20 min de Cocina).
- Bug encontrado tras el reporte del usuario ("no suena en mi celular"): los navegadores móviles (Safari/iOS sobre todo) mantienen el `AudioContext` en `suspended` hasta que el usuario toca la pantalla, y solo se puede reanudar (`resume()`) dentro de un gesto real — nunca desde el `setInterval` del polling. Se resolvió reusando un único `AudioContext` compartido (antes se creaba uno nuevo por sonido) y agregando `desbloquearAudio()`, llamado una sola vez en el primer `pointerdown` de la sesión (`AppShell.tsx`, envuelve toda la app ya logueada).

### Mesero: confirmación visual al agregar producto + buscador que no salta
- `SelectorProductoModal.tsx` (el buscador que usa Mesero para agregar productos, tanto en el borrador de una orden nueva como en una ya existente): al tocar un producto la fila queda en verde con "✓ Agregado" ~0.9s antes de volver al precio normal — antes no había ninguna señal de que el toque hubiera registrado.
- El área de resultados pasó a tener un alto fijo con scroll interno (antes se ajustaba al número de resultados): filtrar hasta dejar 1 solo resultado ya no hace que todo el popup se encoja y "salte" hacia abajo.

### Mesero: color por estado + orden lista en la lista de pedidos
- La lista de órdenes abiertas de Mesero ahora colorea el borde de cada tarjeta según el estado agregado de sus ítems (`modules/migao/estadoOrden.ts`, compartido con Migao/Cajero): gris "En espera" (queda algo pendiente), ámbar "Preparando", verde intenso "✓ Lista" (todo lo que sigue activo ya está listo). Suena `reproducirNotificacionSuave()` una vez cuando una orden completa pasa a "lista" (no por cada ítem individual, y no se repite mientras siga lista).
- Bug de layout corregido: el badge de estado no tenía `whitespace-nowrap`, así que en tarjetas con nombre de mesa/comensal largo el texto se partía ("En" arriba, "espera" abajo). Se agregó `whitespace-nowrap shrink-0` al badge y `flex-wrap` al contenedor, para que si no cabe se baje completo a la siguiente línea en vez de partirse.

### Acceso desde la red Wi-Fi local (sin reconfigurar al cambiar de red)
- Pedido del usuario: que otros dispositivos en la misma red Wi-Fi (la de casa, o la del cliente en otra visita) puedan entrar sin tocar nada.
- `vite.config.ts`: `server: { host: true }` expone el dev server en todas las interfaces, no solo localhost. `server.ts`: `app.listen(port, "0.0.0.0", ...)` explícito.
- **CORS dinámico** (`app.ts`): en vez de una lista fija de orígenes, se acepta automáticamente cualquier origen en el puerto 5173 cuyo host sea una IP de red privada (RFC 1918: `192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`) o `localhost`/`127.x.x.x`. Esto cubre cualquier red Wi-Fi sin mantener una lista de IPs.
- **`VITE_API_URL=auto`** (`shared/api/client.ts`): en vez de una IP fija, la URL del backend se calcula en tiempo de ejecución a partir de `window.location.hostname` — si el frontend se carga por `http://10.0.0.42:5173`, automáticamente le habla al backend en `http://10.0.0.42:4000`, sin importar qué IP asigne el router de turno. Para producción (dominios distintos) se sigue pudiendo fijar una URL explícita.
- Verificado por API: preflight CORS aceptado tanto para la IP de la red de prueba como para una IP simulada de una red completamente distinta, sin cambiar configuración.

### Super Root: reiniciar Caja a $0 sin perder el historial
- Pedido explícito del usuario: un botón para "volver a cero" las cuentas de Caja, pero **conservando el historial** (a diferencia del borrado total de productos de prueba de la sección anterior, este reset es no-destructivo por diseño).
- **Cómo funciona sin borrar nada**: el saldo inicial de un turno nuevo siempre se hereda del último turno *cerrado* (`abrirTurno` → `findUltimoTurnoCerrado`). El reset aprovecha exactamente ese mecanismo: si hay un turno abierto, lo cierra normalmente (con los montos ya calculados, sin pedir conteo físico); después inserta un "turno marcador" que nace y se cierra en el mismo instante con todo en `$0` (`crearTurnoCerradoEnCero`). Ese marcador pasa a ser el "último cierre", así que el próximo turno que abra un Cajero hereda `$0/$0` — pero ningún turno ni movimiento anterior se toca, siguen ahí íntegros para el historial.
- **Backend**: nuevo permiso `general.caja.resetear`, otorgado **solo** a Super Root (Cajero no lo tiene — probado por API, devuelve 403). `POST /caja/reset` exige además un segundo candado: el body debe traer `{ confirmacion: "REINICIAR CAJA" }` (validado con `z.literal(...)`), para que no sea posible dispararlo sin querer.
- **Frontend**: sección "Zona de Super Root" al final de `CajaPage.tsx`, visible solo si `usuario.rol === "Super Root"` (via `useAuth()`). Abre `ResetearCajaModal.tsx`, que exige escribir la frase exacta antes de habilitar el botón de confirmación.
- Verificado por API end-to-end: turno abierto real con 2 movimientos → reset → el turno se cierra con sus montos calculados intactos, se crea el marcador en cero, y un turno nuevo abierto justo después hereda `$0.00`/`$0.00`. `SELECT count(*)` sobre `turnos_caja`/`movimientos_caja` confirmó que ninguna fila se perdió.

### Historial de Caja: resumen día/semana/mes en grilla tipo calendario
- Nueva sección de navegación exclusiva para Cajero (y Super Root, transversal): **"Historial de Caja"** (`/caja/historial`), separada de la pantalla operativa de Caja.
- **Backend**: `GET /caja/historial?anio=YYYY` (mismo permiso `general.caja.ver` que ya tenía Cajero, sin permiso nuevo) agrupa `movimientos_caja` por día (`to_char(created_at, 'YYYY-MM-DD')` — se usa texto en vez de `::date` porque pg parsea `DATE` como `Date` de JS en la zona horaria local del proceso y puede desplazar el día al serializar a JSON) y devuelve `{ fecha, ingresos, egresos, neto, movimientos }` por cada día con actividad en ese año.
- **Frontend (`CajaHistorialPage.tsx`)**: selector de año (← / →, no deja avanzar más allá del año actual); tres tarjetas de resumen ("Hoy", "Esta semana", "Este mes") calculadas en el cliente a partir del arreglo diario; una grilla de 12 mini-calendarios (uno por mes, lunes como inicio de semana) con cada día coloreado por intensidad de neto (verde = ingreso neto, rojo = egreso neto, más oscuro = mayor magnitud relativa al día más fuerte del año) — el patrón "tipo calendario" que pidió el usuario, no un heatmap de barras. Tocar un día con movimientos abre un modal con el detalle (ingresos/egresos/neto/cantidad de movimientos).

### Renombre de la aplicación
- El nombre visible pasó de "SIsteMAPOS" a **"Con Sentido / El Rinconcito del Migao"** en el `<title>` (`index.html`), el manifest PWA (`vite.config.ts`: `name` completo, `short_name: "Con Sentido"` porque el nombre completo es demasiado largo para el ícono de la pantalla de inicio), el encabezado persistente (`AppShell.tsx`, con `truncate` para que no rompa el layout en mobile) y el título de `LoginPage.tsx`. "SIsteMAPOS" se mantiene solo como nombre interno del proyecto/repositorio en la documentación técnica (este archivo, `RUTA_DEL_PROYECTO.md`, etc.), no como marca visible al usuario.

### Cajero: cancelar una orden completa + historial separado de las activas
- **Cancelar orden** (`POST /migao/ordenes/:id/cancelar`, permiso nuevo `migao.ordenes.cancelar`, otorgado solo a Cajero): para cuando el cliente ya no quiere pedir. Cada ítem que seguía activo pasa a `cancelado` (mismo registro en `orden_historial` que una cancelación individual del mesero) y la orden completa pasa a `cancelada`. `CancelarOrdenModal.tsx` pide una confirmación simple (no requiere frase, a diferencia de los resets — es una operación normal del día a día, no un borrado de datos).
- **Historial separado de las activas** (pedido explícito del usuario: "que las que están activas no se vean en la misma tabla de las otras"): `MigaoPage.tsx` ahora tiene dos tablas. La de arriba (activas) agrega color por fila según el estado agregado de cocina (gris=en espera, ámbar=preparando, verde=lista), usando el mismo `estadoAgregadoOrden` que ya tenía Mesero — se extrajo a `modules/migao/estadoOrden.ts` para no duplicar la lógica entre las dos pantallas. La de abajo, nueva, es el **registro de órdenes ya cobradas o canceladas** (`GET /migao/ordenes/historial`, mismo permiso `migao.ordenes.ver`, sin permiso nuevo) con **fecha y hora** de cierre (`closed_at`) y color por fila (verde=cobrada, rojo=cancelada).
- **Reset de historial de órdenes, exclusivo Super Root** (`ResetearOrdenesModal.tsx`, frase de confirmación "REINICIAR ORDENES", permiso `migao.ordenes.resetear` otorgado solo a Super Root): a diferencia del reset de Caja, este **sí borra todo** (órdenes, ítems, historial, ventas y pagos ligados) porque no existe una pantalla de reportes de órdenes que valga la pena conservar — se explica esa diferencia directamente en el modal para que no se confunda con el reset no-destructivo de Caja.
- Verificado por API end-to-end: crear orden → cancelar → desaparece de activas y aparece en historial con `closed_at` poblado; Cajero recibe 403 al intentar `/ordenes/reset`; Super Root con frase incorrecta recibe 400; con la frase correcta borra todo y el historial queda en 0.
- **Nota sobre un incidente durante la verificación de esta misma sesión**: al probar el reset real contra la base en uso (no solo revisar el código), se borraron por accidente 3 órdenes reales del usuario junto con la de prueba — no se contó cuántas órdenes existían antes de ejecutar el reset. Ver la nota de continuidad más abajo.

### 5 usuarios de Mesero + "quién creó la orden" visible en todas las vistas
- Pedido del usuario: varios meseros trabajando a la vez sobre la misma lista de órdenes abiertas necesitan saber quién creó cada una. Se agregaron 4 usuarios de Mesero más (Ana, Carlos, Luisa, Pedro — mismo password `Mesero2026!` que el Mesero original, por simplicidad en desarrollo local), 5 en total.
- **`mesero_nombre`** (JOIN a `usuarios` por `ordenes.mesero_id`) se agregó a todas las consultas que listan órdenes o ítems de cocina: `listOrdenesAbiertas`, `listOrdenesHistorial`, `listItemsCocina`, `listItemsActivos`. Se muestra en la lista y el detalle de Mesero, en cada ticket de Cocina, y en ambas tablas (activas + historial) de Migao/Cajero.

### Historial de pedidos despachados (Cocina) + "mi historial" (Mesero)
- **Cocina** (`GET /migao/cocina/historial`, mismo permiso `migao.cocina.ver`, sin permiso nuevo; nueva pestaña "Historial" en el navbar de Cocina → `CocinaHistorialPage.tsx`): ítems ya despachados (`listo` o `servido`), agrupados en tickets igual que la cola activa. El agrupador (`agruparPorOrden`) se extrajo a `modules/migao/agruparTickets.ts` para compartirlo entre `CocinaPage` y `CocinaHistorialPage`. Como no existe una columna de "cuándo pasó a listo" en el esquema, se ordena por `created_at` del ítem (aproximación razonable; no se justificó una migración solo para esta pantalla de consulta).
- **Mesero** (`GET /migao/ordenes/historial-propio`, mismo permiso `migao.ordenes.ver`, acotado por `req.auth.usuarioId` en vez de devolver todo como el historial del Cajero; nueva pestaña "Mi historial" → `MeseroHistorialPage.tsx`): un mesero solo ve las órdenes que **él mismo** creó, y solo después de que Caja las cerró o canceló (mientras siguen abiertas se ven en la lista normal de Mesero, no acá) — pedido explícito del usuario.
- `listOrdenesHistorial(meseroId?)` ahora acepta un `meseroId` opcional: sin él devuelve todo (Cajero), con él acota a un mesero (reutilizado por ambos endpoints, sin duplicar la consulta SQL).
- Verificado por API: Carlos crea una orden → aparece en la cola de Cocina con `mesero_nombre: "Carlos"` → Cocina la prepara y marca lista → aparece en `/cocina/historial` → Cajero la cobra → aparece en el historial general con `mesero_nombre: "Carlos"` y en `historial-propio` de Carlos, pero **no** en el de Ana (otro mesero).

### Ingresos manuales de Caja con origen Migao también salen en el historial de pedidos
- Pedido del usuario: si el Cajero registra un **ingreso manual** en Caja (no desde cerrar una orden — ej. "venta de mostrador" que no pasó por Mesero) y elige "Viene de: Migao (POS)", ese ingreso también debe verse en el historial de pedidos de Migao, no solo en el listado de movimientos de Caja.
- `listIngresosManualesMigao()` (nuevo, en `migao.repository.ts`) trae los ingresos de `movimientos_caja` con `modulo_origen = migao` y `tipo = ingreso`, **excluyendo** los que ya tienen `referencia_entidad = 'ventas'` — esos ya vienen de un `cerrarOrden` normal y ya aparecen como orden en el historial; sin ese filtro la misma venta saldría duplicada.
- `listarHistorialOrdenes(meseroId?)` ahora devuelve una lista mixta con un campo discriminador `tipo: "orden" | "ingreso_manual"`, ordenada por fecha. Solo se mezcla así para el historial general del Cajero (`meseroId` ausente) — el "mi historial" acotado por mesero no lo incluye, porque un ingreso manual no tiene mesero asociado.
- `MigaoPage.tsx` distingue el renderizado por `tipo`: las filas de ingreso manual muestran el motivo en vez de la mesa, un badge "Ingreso manual · {método de pago}" en vez de Cobrada/Cancelada, y quién lo registró en vez del mesero.
- Verificado por API: se registra un ingreso manual con origen Migao → aparece en `/migao/ordenes/historial` con `tipo: "ingreso_manual"` junto a las órdenes normales, y correctamente **no** aparece en `/ordenes/historial-propio` de ningún mesero.

## Cómo correrlo localmente
1. Backend:
   ```
   cd backend
   cp .env.example .env   # completar DATABASE_URL apuntando a un Postgres con database/schema.sql ya aplicado
   npm install
   npm run dev             # http://localhost:4000
   ```
2. Frontend:
   ```
   cd frontend
   cp .env.example .env    # VITE_API_URL=http://localhost:4000/api/v1
   npm install
   npm run dev              # http://localhost:5173
   ```
3. Aplicar `database/schema.sql` y luego `database/seed.sql` contra la base para tener roles, permisos y usuarios de prueba listos (ver tabla abajo).

## Verificación realizada
- `backend`: `npm run typecheck` (tsc --noEmit) sin errores.
- `frontend`: `npm run build` (tsc -b + vite build) sin errores; el service worker y el manifest se generan correctamente en `dist/`.
- Verificado end-to-end contra un PostgreSQL 16 real local (base `sistemapos`): `schema.sql` + `seed.sql` aplicados sin errores, y probado por API el flujo completo Mesero → Cocina → Mesero: crear orden (solo número de mesa, comensal autonumerado), agregar ítem, cocina lo marca preparando/listo, mesero lo ve en `items/activos`, mesero edita la cantidad (el ítem vuelve a `pendiente` y cocina lo ve de nuevo), cocina lo prepara otra vez, mesero lo marca entregado — y el historial completo de la orden queda registrado y es consultable. La UI en navegador se probó para Insumos y Migao (cobro); Caja General, Cocina y Mesero se probaron por API pero aún no manualmente en navegador con datos reales.

## Seed de datos (`database/seed.sql`)
Roles y usuarios de prueba creados (contraseñas solo para desarrollo local, cambiar antes de producción):

| Rol | Email | Password | Permisos |
|---|---|---|---|
| Super Root | admin@sistemapos.local | SuperRoot2026! | todos los permisos existentes + acceso a los 6 módulos vía `usuarios_modulos` |
| Cajero | cajero@sistemapos.local | Cajero2026! | `general.caja.*`, `migao.ordenes.ver`, `migao.ordenes.cerrar` |
| Cocina | cocina@sistemapos.local | Cocina2026! | únicamente `migao.cocina.ver` y `migao.cocina.actualizar_estado` |
| Mesero (5 usuarios) | mesero@, mesero2@, mesero3@, mesero4@, mesero5@sistemapos.local (Mesero/Ana/Carlos/Luisa/Pedro) | Mesero2026! (misma para los 5) | `migao.ordenes.{ver,crear,agregar_item,editar_item,entregar_item}` — sin `migao.ordenes.cerrar` ni nada de Caja |
| Administrador | administrador@sistemapos.local | Administrador2026! | `migao.productos.{ver,crear,editar}`, `insumos.insumos.{ver,crear,editar}` — sin órdenes, cobros ni cocina |

**Nota importante de continuidad**: el historial de órdenes de Migao (`ordenes`/`orden_items`/`orden_historial`/`ventas`/`pagos` ligados a una orden) está **en cero** — se borró por accidente al verificar por API el nuevo botón de reset de Super Root (`POST /migao/ordenes/reset`), sin revisar antes cuántas órdenes reales tenía el usuario abiertas en ese momento (se perdieron 3 órdenes reales junto con la de prueba). El menú/catálogo, insumos, usuarios y Caja General no se vieron afectados. Lección para la próxima sesión: **nunca ejecutar un endpoint de reset/borrado real contra la base en uso sin antes contar cuántas filas existen y confirmar con el usuario**, incluso durante una verificación "de rutina".

## Pendiente dentro de esta fase
- Completar el resto de Migao (mapa de mesas visual como pantalla, no solo texto) y replicar el patrón de capas para Talleres, Con Sentido y Pedidos.
- La notificación con sonido del Mesero y el refresco de Cocina son por *polling* (cada 5s/8s), no push en tiempo real — funciona pero no es instantáneo; si se necesita menor latencia, considerar WebSockets/SSE más adelante.
- Reemplazar el ícono PWA provisional (SVG generado) por assets de marca reales (PNG 192/512 + maskable) antes de producción.
- Definir estrategia de tests (unitarios de service/repository, e2e de los flujos críticos del checkpoint de Fase 4).
- `zonas`/`mesas` no tienen ninguna UI de administración (CRUD) todavía — se crean sobre la marcha (mesas, vía "get-or-create" por número+piso). `categorias_producto` sí tiene alta rápida (sin edición/borrado) desde los modales de Menú.

## Estado del entorno (al cierre de esta sesión)
- Backend y frontend están **encendidos** (el usuario está probando la app en vivo, incluso desde su celular por la red Wi-Fi). Ojo al apagarlos — `tsx watch` puede dejar procesos hijos vivos si se mata solo el proceso padre; usar `taskkill //F //T` con el PID raíz para matar todo el árbol.
- La base de datos `sistemapos` en PostgreSQL 16 local tiene el esquema al día (incluye `imagen_url`/`descripcion` en `productos`/`insumos`, `numero_personas`/`piso`, categorías de Migao, y las tablas de Caja). Ahora hay 5 usuarios Mesero (ver tabla de seed). Hay un turno de Caja real abierto (base $0, heredada del reset de Caja de esta sesión) con movimientos reales del usuario probando la app, más un ingreso manual de prueba de esta sesión.
- Para retomar si se apagan: `cd backend && npm run dev` y `cd frontend && npm run dev` (ver instrucciones arriba). Las credenciales de la tabla de seed siguen siendo válidas.

### CHECKPOINT
Versión: 0.15
Fecha: 2026-07-12

#### Proyecto
Plataforma ERP/POS/inventario para microempresa. Backend Express+TS y frontend React+Vite PWA verificados end-to-end contra PostgreSQL 16 real (local). Completos: Auth, Insumos (full-stack), Caja General (backend), y Migao con tres pantallas por rol — Mesero (armar pedido completo antes de crear, editar, historial legible, notificación con sonido), Cocina (preparación por orden completa con checks por producto) y cobro/cierre (Cajero). Roles Super Root, Cajero, Cocina y Mesero sembrados con permisos acotados. Sesión cerrada con ambos servidores apagados.

#### Módulos terminados
- [x] Levantamiento de requisitos inicial
- [x] Definición del MVP
- [x] Diseño funcional
- [x] Diseño de base de datos
- [x] Arquitectura técnica

#### Módulos en proceso
- [ ] Desarrollo — Auth, Insumos (full-stack), Caja General (backend) y Migao (Mesero/Cocina/Cajero, full-stack) verificados contra Postgres real; falta UI de Caja, mapa visual de mesas, Talleres, Con Sentido y Pedidos.

#### Módulos pendientes
- [ ] Testing
- [ ] Despliegue

#### Tablas diseñadas
41 tablas: las 35 originales + `categorias_gasto`, `turnos_caja`, `movimientos_caja` (Caja General) + `orden_historial` (historial de Migao). Además `ordenes.comensal_numero` (autonumerado vía secuencia `comensal_seq`) y `orden_items.listo_cocina` (check de cocina) se agregaron como columnas nuevas.

#### Decisiones importantes
- Colores de marca: verde oscuro (#1F4A34 / #14291F) + blanco vainilla (#FBF3E1), aplicados como tokens Tailwind y en el manifest PWA.
- Access token en memoria (no localStorage); refresh token en cookie httpOnly; sesión con tope absoluto de 10h.
- RBAC verificado en cada request contra `roles_permisos`/`permisos`, no cacheado en el JWT.
- `movimientos_insumo` + `inventario_insumos` se actualizan en una única transacción con bloqueo de fila (`FOR UPDATE`) para evitar condiciones de carrera entre módulos que consumen el mismo insumo.
- Navegación del frontend generada dinámicamente desde `usuario.modulos`; un módulo puede tener más de una entrada de menú apuntando a pantallas distintas (Migao tiene "Mesero", "Migao (POS)" y "Cocina").
- Caja General: un único turno abierto para todo el negocio a la vez (no por cajero); cada turno hereda los saldos del cierre anterior en vez de arrancar en cero; egresos sin flujo de aprobación (auditados); dos cuentas independientes por método de pago (efectivo/banco) + total general; el conteo físico de cierre solo aplica a efectivo.
- Migao — cerrar una mesa/orden es exclusivo del rol Cajero; venta + pago + ingreso en Caja + cierre de orden ocurren en una sola transacción.
- Migao — Cocina: el estado "preparando" es de la orden completa, no por producto; cada producto tiene un check individual y "marcar orden lista" queda bloqueado (backend y frontend) hasta que todos los checks estén marcados y no queden productos sin empezar.
- Migao — Mesero: la orden no existe en la base hasta que el mesero termina de armarla (mesa + productos) y confirma — creación atómica de orden + ítems en una sola transacción. Editar la cantidad de un ítem ya existente lo regresa a `pendiente` y le quita el check de cocina, para que se vuelva a preparar con el cambio correcto.
- Historial de orden (`orden_historial`) registra alta/edición/cancelación/entrega de cada ítem, mostrado en el frontend como texto legible (no JSON), y es la fuente de verdad de "quién cambió qué y cuándo" en una orden.

#### Próxima tarea
La siguiente IA debe: (1) construir la UI de Caja General en el frontend (hoy solo tiene backend), (2) construir un mapa visual de mesas para Migao en vez de la lista de texto actual, (3) replicar el patrón de capas de Migao/Insumos para Talleres, Con Sentido y Pedidos, y (4) definir estrategia de tests antes de que el proyecto crezca más.
