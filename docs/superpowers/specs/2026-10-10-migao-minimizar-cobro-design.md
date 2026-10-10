# Minimizar cobro en Migao — diseño

**Fecha:** 2026-10-10
**Estado:** Aprobado en brainstorming, pendiente de plan de implementación.

## 1. Qué es esto

Hoy, cuando un cajero abre la vista de "cobrar" una cuenta de Migao (elegir propina, método de pago, o pagar un abono dividido / ítems sueltos), ese estado vive únicamente en `MigaoPage.tsx` — si navega a otra pantalla (ej. a Caja General a registrar un movimiento, o a pagar otra cuenta), todo ese progreso se pierde.

Esta funcionalidad convierte esa vista de cobro en una ventana flotante real (con fondo oscuro detrás, como el resto de los modales de la app — hoy es contenido normal de la página, sin esa presentación). Minimizarla — ya sea con un botón explícito, con la ✕, o haciéndole click al fondo oscuro — nunca pierde el progreso: lo guarda a un lado y vuelve a la lista de órdenes (que queda visible detrás en todo momento). El cajero puede entonces navegar libremente por toda la plataforma (pagar otra cuenta, ir a Caja General, etc.), y retomar cualquier cuenta minimizada después desde una barra persistente visible en toda la app. Se pueden tener varias cuentas minimizadas al mismo tiempo, y sobreviven un refresh de página.

**Decisión central de diseño:** lo que se guarda al minimizar son las **decisiones del cajero** (propina, método de pago, montos, selecciones de abono/ítems) — nunca el detalle de la cuenta ni sus ítems. Al restaurar, la cuenta se vuelve a pedir fresca al backend y las decisiones guardadas se le aplican encima. Esto evita el riesgo de cobrar con datos desactualizados si alguien más modificó la cuenta mientras estaba minimizada.

**Fuera de alcance:** minimizar cualquier otra cosa que no sea la vista de cobro de Migao (ej. no aplica a Caja General, Con Sentido, etc. en esta versión); un límite de cuántas cuentas se pueden tener minimizadas a la vez; expiración automática de una cuenta minimizada por tiempo.

## 2. Qué se guarda por cuenta minimizada

Identificado por `ordenId`. Dos grupos de datos:

**Para mostrar en el chip de la barra (foto del momento, puede quedar desactualizada):**
- `etiqueta`: nombre de la mesa o del cliente.
- `montoAproximado`: lo que se le debía al momento de minimizar.
- `minimizadoEn`: timestamp.

**Las decisiones del cajero (se reaplican tal cual al restaurar, después de pedir la cuenta fresca):** exactamente el subconjunto de estado de `MigaoPage.tsx` que representa una elección ya hecha, no un dato pedido al servidor ni un control puramente transitorio de la UI:

- `pago` (método de pago elegido para el cobro completo).
- `montoRecibido`, `esAdministrativo`, `descuentoPorcentaje`.
- `propinaPorcentaje`, `propinaMontoCustom`, `propinaDecidida`, `propinaMetodoPago`.
- `abonoForms` (si estaba a mitad de un abono dividido).
- `cantidadesSeleccionadas`, `modalPagarItemsAbierto`, `pagoItems`, `propinaItemsPorcentaje`, `propinaItemsMontoCustom`, `montoRecibidoItems` (si estaba a mitad de pagar ítems sueltos).

No se modela un campo "modo" — se guarda y se restaura el paquete completo de decisiones tal cual estaba, sin importar cuál de los sub-flujos estuviera activo; la propia combinación de valores ya determina qué se ve al restaurar.

**Nunca se guarda:** `ordenes`, `mesasLayout`, `detalle`, `cuenta`, `itemsActivos` — todo esto se vuelve a pedir fresco al backend al restaurar.

## 3. Arquitectura

- **La vista de cobro pasa a ser un `<Modal>` real.** Hoy `MigaoPage.tsx` reemplaza el contenido de la página con la vista de cobro cuando `ordenSeleccionadaId !== null` (`mostrarCobro`). Pasa a ser: la lista de órdenes se renderiza SIEMPRE, y la vista de cobro se monta como un `<Modal>` flotante por encima cuando hay una orden seleccionada — usando el `Modal` genérico (`shared/components/Modal.tsx`), que ya tiene fondo oscuro + ✕ + "click afuera cierra" (hoy los tres llaman a `onCerrar`).
- **`onCerrar` del Modal de cobro es, literalmente, la función de minimizar.** No hay una acción de "cerrar y perder todo" separada — la ✕ del Modal, hacerle click al fondo oscuro, y un botón explícito "Minimizar" dentro del contenido llaman los tres a la misma función. Minimizar nunca es una acción destructiva.
- Nuevo `CuentasMinimizadasProvider` (Context de React), montado en `AppShell.tsx` como hermano de `<Outlet />` — mismo patrón ya usado por `RefrescoProvider` — para que el estado sobreviva la navegación entre páginas.
- Estado interno: un mapa `Record<ordenId, CuentaMinimizada>`, sincronizado a `localStorage` (clave `"migao-cuentas-minimizadas"`) en cada cambio vía `useEffect`, y leído de ahí una vez al montar el Provider (sobrevive un refresh de página).
- Expone un hook `useCuentasMinimizadas()` con:
  - `minimizadas: CuentaMinimizada[]` — para que la barra las liste.
  - `minimizar(ordenId, decisiones)` — guarda la entrada y la quita de "activa".
  - `restaurar(ordenId)` — marca esa orden como "pendiente de restaurar" (ver sección 4) y la quita del mapa de minimizadas.
  - `descartar(ordenId)` — la quita del mapa sin restaurar (botón ✕ del chip).
  - `pendienteDeRestaurar: string | null` — la orden que `MigaoPage` debe abrir y a la que debe aplicarle las decisiones guardadas en su próximo render.
- `MigaoPage.tsx` consume este hook. Un `useEffect` nuevo observa `pendienteDeRestaurar`: si tiene un valor, pide esa orden al backend (`obtenerDetalle`), le aplica las decisiones guardadas sobre el estado local existente (los mismos `useState` que ya tiene la página, solo que ahora también se pueden poblar desde acá en vez de solo desde la interacción del usuario), y limpia `pendienteDeRestaurar`.
- Nuevo componente `BarraCuentasMinimizadas.tsx`, también hermano de `<Outlet />` en `AppShell.tsx` — visible en toda la app, no solo en `/migao`.

## 4. Flujo y manejo de errores

- **Minimizar**: la ✕ del Modal, el click al fondo oscuro, o el botón explícito "Minimizar" dentro del contenido — los tres llaman a `minimizar(ordenSeleccionadaId, { ...snapshot de las decisiones actuales })` → el Modal se cierra y `ordenSeleccionadaId = null` (la lista, que ya estaba visible detrás, queda al frente).
- **Restaurar desde la barra** (desde cualquier pantalla): si no está en `/migao`, navega ahí primero. Llama a `restaurar(ordenId)`. `MigaoPage` lo detecta vía el `useEffect` de la sección 3.
- **Conflicto**: si al restaurar una cuenta ya hay otra activa (sin minimizar) en la página, esa se minimiza automáticamente primero (con sus propias decisiones actuales), y luego se abre la restaurada.
- **Cuenta ya no válida al restaurar** (se cerró, se canceló, o ya no existe): el `obtenerDetalle` falla o devuelve un estado que ya no es "abierta" → se muestra un mensaje claro, esa entrada se descarta de la barra, y la página se queda en la lista. Nunca se muestra como si las decisiones guardadas siguieran aplicando.
- **Ítems/personas que ya no existen** (ej. un ítem de `abonoForms`/`cantidadesSeleccionadas` que ya no está en la cuenta fresca): esas referencias puntuales se descartan en silencio al reaplicar; el resto de las decisiones (propina, método de pago) se aplican igual.
- **Refresh de página**: el Provider rehidrata el mapa desde `localStorage` al montarse — las cuentas minimizadas simplemente reaparecen en la barra, nada especial que hacer en `MigaoPage`.

## 5. UI — la barra de cuentas minimizadas

- Barra angosta fija en la parte inferior de la pantalla — solo se renderiza si `minimizadas.length > 0` (si no hay ninguna, no ocupa espacio ni existe visualmente).
- Cada cuenta: un chip con `etiqueta` + `montoAproximado` formateado, tocar restaura; una ✕ pequeña aparte descarta sin restaurar.
- Si hay varias, la barra se desplaza horizontalmente (`overflow-x-auto`).

## Decisiones explícitas (para que el plan no las reabra)

- La vista de cobro pasa de ser contenido inline de la página a ser un `<Modal>` flotante real, con la lista de órdenes siempre renderizada detrás.
- La ✕, el click al fondo oscuro, y el botón explícito "Minimizar" son sinónimos — los tres minimizan, ninguno descarta el progreso. No existe una acción de "cerrar y perder todo" para esta ventana.
- Lo que se guarda es el paquete de decisiones del cajero, nunca el detalle/ítems de la cuenta — eso siempre se repide fresco al backend al restaurar.
- Varias cuentas pueden estar minimizadas a la vez, cada una independiente.
- Restaurar una cuenta mientras otra está activa (sin minimizar) minimiza esa otra automáticamente primero — nunca se pierde trabajo sin avisar ni se bloquea la acción.
- Debe sobrevivir un refresh de página (persistido en `localStorage`, no solo en memoria).
- Sin límite de cantidad ni expiración por tiempo en esta versión.
- La barra es visible en toda la plataforma, no solo en la pantalla de Migao.
