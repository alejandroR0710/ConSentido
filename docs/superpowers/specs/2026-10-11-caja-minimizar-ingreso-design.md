# Minimizar "Registrar ingreso" en Caja General — diseño

**Fecha:** 2026-10-11
**Estado:** Aprobado en brainstorming, pendiente de plan de implementación.

## 1. Qué es esto

Hoy, al abrir "Registrar ingreso" en Caja General (botón "+ Ingreso" en `CajaPage`, o "Pasar a factura" desde una cotización en `CotizacionesPage`), el formulario (`IngresoModal`) vive como estado local de React — cerrarlo con la ✕, el fondo oscuro, o navegar a otra pantalla lo destruye sin aviso, perdiendo las líneas de productos, el método de pago, el descuento, el motivo, todo.

Esta funcionalidad aplica la misma idea de "minimizar" que ya existe en el cobro de Migao: la ✕, el click al fondo oscuro, y un botón explícito "Minimizar" dejan de ser destructivos — guardan el formulario y lo cierran, nunca lo pierden. El cajero puede retomarlo después desde la misma barra combinada que ya muestra las cuentas minimizadas de Migao, sin importar en qué pantalla esté.

**Decisión central de diseño (distinta a Migao):** "Registrar ingreso" no depende de ninguna entidad de backend que se pueda volver a pedir — todo (líneas de productos, método de pago, descuento, motivo) es estado de React puro hasta el único POST atómico final (`registrarIngresoManual`, que crea venta+ítems+factura+pagos+movimientos de una sola vez). No hay nada que "repedir fresco" al restaurar. Por eso lo que se guarda al minimizar es el **formulario completo y literal**, no un subconjunto de "decisiones layereadas sobre algo fresco" como en Migao.

**Fuera de alcance:** "Registrar egreso" (`EgresoModal`) y "Egreso acumulado" (`EgresoAcumuladoModal`) — formularios separados, no se tocan en esta versión; minimizar la pantalla de "¿Deseas imprimir la factura?" que aparece después de registrar exitosamente (ya no hay nada que perder en ese punto, el ingreso ya se registró); un límite de cuántos ingresos se pueden tener minimizados a la vez.

## 2. Qué se guarda por formulario minimizado

Identificado por un `id` generado en el navegador (`crypto.randomUUID()` al montar el modal) — no hay id de backend hasta el submit. Tres grupos:

**Identidad y origen** (determina a dónde navega restaurar y qué pasa después de registrar, ver sección 4):
- `id`: el uuid generado al abrir el modal.
- `origen`: `{ tipo: "caja" }` (abierto desde el botón "+ Ingreso" de `CajaPage`) o `{ tipo: "cotizacion"; cotizacionId: string }` (abierto desde "Pasar a factura" en `CotizacionesPage`).

**Para el chip de la barra (foto del momento, puede quedar desactualizada — no hay nada "fresco" que repedir):**
- `etiqueta`: "Ingreso" para origen `"caja"`; el número de la cotización para origen `"cotizacion"`.
- `montoAproximado`: el monto del formulario en el momento de minimizar.
- `minimizadoEn`: timestamp.

**El formulario completo, literal — se restaura exactamente así, sin derivarlo de ningún fetch:**
- `modulo` (`ModuloOrigenSlug` — de dónde sale el dinero).
- `modoMonto` (`"unico" | "productos"`).
- `monto`.
- `lineas` (el arreglo `LineaIngreso[]` completo: `nombre`, `cantidad`, `precioUnitario`, `precioManual?`, `productoId?`, `observacionInventario?`).
- `descuentoPorcentaje`.
- `pago` (`MetodoPagoValor`).
- `montoRecibido`.
- `motivo`.

**Nunca se guarda:** el catálogo de productos (`productos: ProductoConSentido[]`) — es información de referencia, se vuelve a cargar sola igual que hoy, vía el `useEffect` de montaje que `IngresoModal` ya tiene.

## 3. Arquitectura

- Nuevo `IngresosMinimizadosProvider` (Context de React) + hook `useIngresosMinimizados()`, montado en `AppShell.tsx` igual que `CuentasMinimizadasProvider` de Migao — mismo patrón (mapa sincronizado a `localStorage`, leído una vez al montar), archivo y módulo completamente separados de `CuentasMinimizadasContext`, sin tocar ese código.
- Clave de `localStorage`: `"caja-ingresos-minimizados"`, **por usuario** (`${clave}:${usuario.id}`) desde el inicio — mismo ajuste que se le hizo al Context de Migao tras su revisión final, para que un ingreso minimizado por un cajero no le aparezca a otro en un terminal compartido.
- `IngresoModal.tsx` genera su propio `id` (`useState(() => crypto.randomUUID())`) al montar. Gana un botón "Minimizar" junto al existente flujo, y su `onCerrar` (que hoy recibe como prop y simplemente desmonta) pasa a significar "minimizar" en vez de "descartar" — mismo principio que Migao: ✕, fondo oscuro, y el botón explícito llaman los tres a la misma función de minimizar.
- `IngresoModal` necesita saber su propio `origen` (prop nueva: `{ tipo: "caja" } | { tipo: "cotizacion"; cotizacionId: string }`) para poder guardarlo junto con el snapshot al minimizar — lo recibe de quien lo monta (`CajaPage` siempre pasa `{ tipo: "caja" }`; `CotizacionesPage` pasa `{ tipo: "cotizacion", cotizacionId }`).
- `CajaPage.tsx` y `CotizacionesPage.tsx` (los dos puntos de entrada) consumen `useIngresosMinimizados()` para detectar si hay un "pendiente de restaurar" cuyo `origen` les corresponde (`tipo === "caja"` para `CajaPage`, `tipo === "cotizacion"` para `CotizacionesPage`) y, si lo hay, abrir su `IngresoModal` ya con esos valores iniciales en vez de en blanco. El resto de su lógica (`onRegistrado`, incluyendo que `CotizacionesPage` siga llamando a `marcarCotizacionFacturada` tras un registro exitoso) no cambia — siguen resolviéndolo exactamente como hoy.
- Nueva `BarraMinimizados.tsx` — **reemplaza** a `BarraCuentasMinimizadas` como el único componente fijo al pie de pantalla montado en `AppShell.tsx`: internamente llama a `useCuentasMinimizadas()` (Migao, sin cambios) y a `useIngresosMinimizados()` (nuevo), y mezcla ambas listas de chips en una sola barra visual. El Context de Migao no se modifica en absoluto; solo gana un segundo consumidor del lado de la barra.

## 4. Flujo y manejo de errores

- **Minimizar**: la ✕, el fondo oscuro, o "Minimizar" guardan el formulario completo (más `origen`, `etiqueta`, `montoAproximado`) bajo su `id`, y cierran el modal — la pantalla que lo tenía abierto vuelve a su vista normal, sin perder nada.
- **Restaurar desde la barra**: si `origen.tipo === "caja"`, navega a `/caja` y marca ese `id` como pendiente de restaurar; `CajaPage` lo detecta y abre `IngresoModal` con esos valores. Si `origen.tipo === "cotizacion"`, navega a la pantalla de Cotizaciones y hace lo mismo; `CotizacionesPage` lo detecta y abre el modal igual que ya hace hoy para "Pasar a factura", precargado con los valores guardados en vez de los de la cotización original — y sigue llamando a `marcarCotizacionFacturada(cotizacionId, ventaId)` tras el registro, exactamente como ya hace.
- **Varios minimizados a la vez**: igual que Migao, sin límite — cada uno independiente, identificado por su propio `id`.
- **Al registrar exitosamente un ingreso que estaba minimizado**: se quita del mapa de minimizados — ya cumplió su propósito, no hay "cuenta" que conserve viva.
- **Sobrevive un refresh de página**: persistido en `localStorage` por usuario, igual que Migao.
- **No hay "formulario inválido" que detectar al restaurar** (a diferencia de Migao): como nada se persiste hasta el submit, no existe una versión "fresca" contra la cual el snapshot pueda quedar desactualizada de forma que rompa algo — restaurar nunca falla por ese motivo. Si una línea tiene `productoId` de un producto que ya no existe en el catálogo recién cargado, la línea se restaura igual (ya tiene su `nombre`/`precioUnitario` guardados como valores literales); simplemente el autocompletar no podrá reconfirmar ese vínculo — no bloquea ni corrompe nada.

## 5. UI — la barra combinada

- Mismo lugar y estilo que la barra actual de Migao (fija al pie de pantalla, angosta, `overflow-x-auto` si hay varios) — ahora puede mostrar chips de dos orígenes mezclados: cuentas de Migao e ingresos de Caja General, sin distinción visual de "sección" entre ellos.
- Cada chip de ingreso: `etiqueta` + `montoAproximado` formateado, tocar restaura; una ✕ pequeña aparte descarta sin restaurar — mismo patrón que los chips de Migao.
- Si no hay nada minimizado de ninguno de los dos tipos, la barra no existe visualmente (igual que hoy).

## Decisiones explícitas (para que el plan no las reabra)

- Alcance: solo "Registrar ingreso" (`IngresoModal`), desde sus dos puntos de entrada actuales (`CajaPage` y `CotizacionesPage`). "Registrar egreso" y "Egreso acumulado" quedan fuera.
- Lo que se guarda es el formulario completo y literal (no hay nada "fresco" que repedir al backend, a diferencia de Migao).
- Identidad por `id` generado en el navegador, no por ningún id de backend.
- `origen` (`"caja"` o `"cotizacion"`) viaja con el snapshot y determina a dónde navega restaurar y qué pantalla reabre el modal — cada pantalla sigue resolviendo su propio "qué hacer después de registrar" exactamente como ya lo hace hoy, sin tocar esa lógica.
- Context y Provider completamente separados de los de Migao (`IngresosMinimizadosContext` nuevo, `CuentasMinimizadasContext` de Migao sin modificar).
- Una sola barra combinada al pie de pantalla (`BarraMinimizados`, reemplaza a `BarraCuentasMinimizadas`) que lee de los dos Contexts y mezcla los chips.
- `localStorage` por usuario desde el inicio (clave `"caja-ingresos-minimizados":<usuarioId>`).
- Sin límite de cantidad ni expiración por tiempo.
- El ✕, el fondo oscuro, y un botón explícito "Minimizar" son sinónimos — ninguno pierde el progreso.
