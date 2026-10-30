# Área económica por producto (insumos vs. Con Sentido) — Diseño

## Contexto y caso de uso

Hoy, cuando se registra un ingreso en Caja General (o se factura una cotización, o se abona un pedido), toda la venta completa queda anotada en **una sola área** (`movimientos_caja.modulo_origen_id`), elegida una vez para toda la transacción. En la práctica, un mismo cliente compra en una sola visita tanto insumos (moldes, ceras, herramientas) como productos de tienda (velas, jabones, decorativos) — y hoy esa plata se va entera a una sola área, perdiendo la separación real entre cuánto entró por insumos y cuánto por tienda.

El objetivo es que cada **producto**, no cada venta, sepa hacia qué área va su parte del dinero — con una categoría por defecto (heredada de su categoría de producto, la misma que ya trae del e-commerce) y la posibilidad de corregirla a mano en el momento de la venta. Esto debe aplicar en todos los puntos donde se registra el movimiento económico de un producto: Caja General ("Registrar ingreso"), Cotizaciones al pasarlas a factura, y Pedidos al registrar sus abonos.

## Decisiones de diseño (aprobadas en la conversación de brainstorming)

1. **El área es por línea de producto, no por venta.** Cada ítem de una venta (ya sea elegido del catálogo o anotado a mano) lleva su propia área. El selector único de área que hoy existe a nivel de todo el ingreso ("Viene de") desaparece.
2. **Resolución automática por categoría, con un nuevo vínculo categoría → área.** `categorias_producto` gana un campo de área (igual al que ya tienen `categorias_gasto` para gastos) — insumos o Con Sentido/tienda, con Con Sentido como valor por defecto para cualquier categoría que no se marque explícitamente como insumos. Esto es nuevo: hoy `categorias_producto` no tiene ningún vínculo con un área.
3. **Siempre editable al momento de la venta.** El área resuelta automáticamente es solo el valor inicial del selector de esa línea — el cajero la puede cambiar ahí mismo, sin tocar la categoría del producto.
4. **Productos anotados a mano también eligen área, y es obligatorio.** Como no tienen categoría de la que heredar, su selector de área no trae ningún valor por defecto — el cajero la elige directamente, y guardar queda bloqueado hasta que la elija (igual que hoy se bloquea si falta nombre o precio). A diferencia de un producto de catálogo (que siempre tiene al menos el valor por defecto de su categoría), un ítem a mano sin categoría no tiene ningún valor sensato que asumir en silencio — el espíritu del pedido es justamente saber con certeza hacia dónde va cada peso.
5. **Una venta mixta se descompone, no se trunca a una sola área.** Cuando una misma venta tiene productos de varias áreas, se generan varios movimientos de caja (uno por área, con su monto proporcional) en vez de uno solo — el mismo mecanismo que ya existe hoy para un pago "mixto" (efectivo + banco), que se descompone en registros puros antes de guardarse. La factura/recibo que ve el cliente no cambia: sigue siendo una sola venta con todos los productos juntos; la separación es solo contable, por dentro.
6. **Aplica también a Pedidos.** Hoy todo abono de un pedido se anota en el área fija "Pedidos", sin importar qué productos trae. Con este cambio, esa plata se reparte entre insumos/Con Sentido según la categoría de cada producto del pedido, igual que en Caja General — "Pedidos" deja de usarse como área de destino del dinero (puede seguir existiendo como módulo/reporte de actividad si se necesita, pero no como bucket de plata).
7. **Alcance de "producto": el catálogo de Con Sentido.** Los productos de Migao (platos del menú del restaurante) no vienen del e-commerce, no tienen esta ambigüedad insumos/tienda, y siguen yendo a su área `migao` como siempre — esta función no les aplica.
8. **La mesa de Migao combinada con tienda queda fuera de este proyecto.** Ese flujo (`docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md`) ya reparte un abono entre mesa/tienda y entre métodos de pago con un algoritmo delicado (tiene bugs de redondeo ya corregidos, documentados en el propio código como "hallazgo C3"/"hallazgo I9"). Agregarle el área como una tercera dimensión de reparto, sobre abonos parciales que llegan en momentos distintos, es el caso más riesgoso de todos — se decidió explícitamente no tocarlo ahora. Mientras tanto, ese carrito de tienda vinculado a una mesa sigue yendo 100% a `con_sentido`, como hoy (sin selector de área por línea ahí).
9. **En Pedidos, la proporción se fija al crear el pedido, no en cada abono.** Un pedido puede pagarse en varios abonos a lo largo del tiempo. Para que el reparto por área cuadre exacto sin quedar centavos sueltos, el % que le corresponde a cada área se calcula UNA VEZ, con los productos del pedido al crearlo, y cada abono posterior reparte su monto según esa misma proporción fija — el último abono (el que deja el pedido en $0 pendiente) ajusta el centavo que sobre por redondeo hacia la última área con saldo, mismo criterio que ya usa `distribuirIgual` en otras partes del sistema.

## Alcance

Aplica a: Caja General ("Registrar ingreso", incluyendo el modo "Monto único"), facturar una cotización desde Migao (mismo modal), el registro de abonos de Pedidos, y la pantalla "Ventas" de Con Sentido (`/con-sentido/ventas`, venta directa de un solo golpe — `NuevaVentaModal`/`con_sentido_venta_items` — descubierta al escribir el plan de implementación, no estaba en la conversación de brainstorming original pero es del mismo bajo riesgo que Caja General: una venta de un solo golpe, no por abonos).

**No aplica** a (por ahora, ver decisión 8 sobre un posible proyecto aparte):

- El carrito de tienda de Con Sentido vinculado a una mesa de Migao (venta combinada) — sigue yendo 100% a `con_sentido`.
- El cobro normal de una mesa de Migao (platos del menú) — sigue yendo a `migao` como hoy.
- Egresos — ya tienen su propio mecanismo de área por categoría (`categorias_gasto.modulo_id`), sin cambios.

## Modelo de datos

### `categorias_producto` (ALTER)

```sql
ALTER TABLE categorias_producto
  ADD COLUMN modulo_id SMALLINT NULL,
  ADD CONSTRAINT fk_categorias_producto_modulo FOREIGN KEY (modulo_id) REFERENCES modulos(id);
```

- `NULL` (sin marcar) o `modulo_id` apuntando a cualquier cosa distinta de `insumos` → la categoría se comporta como Con Sentido/tienda (el valor por defecto es "todo lo que no sea insumos es tienda").
- `modulo_id` apuntando al módulo `insumos` → cualquier producto con esa categoría resuelve su área por defecto a insumos.
- No se restringe a solo estos dos valores a nivel de base de datos (la columna acepta cualquier módulo, igual que `categorias_gasto.modulo_id`), pero la pantalla de administración de categorías de producto (nueva, ver abajo) solo ofrece elegir entre Insumos y Con Sentido — las demás áreas (migao, talleres, pedidos, general, vales) no tienen sentido en una categoría de producto de este catálogo.

### Ítems de venta: nueva columna de área resuelta

Cada tabla de línea de producto donde hoy se registra una venta de Con Sentido gana una columna con el área **ya resuelta** para esa línea (la que el cajero vio y, si quiso, cambió) — se guarda el valor final, no se recalcula después a partir de la categoría (si la categoría cambia después, las ventas ya hechas no deben moverse de área retroactivamente):

```sql
ALTER TABLE caja_ingreso_items
  ADD COLUMN modulo_origen_id SMALLINT NULL,
  ADD CONSTRAINT fk_caja_ingreso_items_modulo FOREIGN KEY (modulo_origen_id) REFERENCES modulos(id);

ALTER TABLE con_sentido_venta_items
  ADD COLUMN modulo_origen_id SMALLINT NULL,
  ADD CONSTRAINT fk_con_sentido_venta_items_modulo FOREIGN KEY (modulo_origen_id) REFERENCES modulos(id);

ALTER TABLE pedido_items
  ADD COLUMN modulo_origen_id SMALLINT NULL,
  ADD CONSTRAINT fk_pedido_items_modulo FOREIGN KEY (modulo_origen_id) REFERENCES modulos(id);
```

(El plan de implementación debe confirmar primero si `IngresoModal` escribe sobre `caja_ingreso_items`, `con_sentido_venta_items`, o ambas según el flujo — ver Alcance arriba — y aplicar la columna donde realmente corresponda; puede que no las tres tablas la necesiten.)

### `movimientos_caja`: sin cambio de esquema

No necesita columnas nuevas — sigue siendo "un movimiento, un área", igual que hoy. Lo que cambia es que **al guardar una venta con líneas de varias áreas, se insertan varias filas** (una por área, con el monto proporcional de esa área), todas apuntando al mismo `venta_id`. Esto reutiliza tal cual el patrón ya existente de "un pago mixto se descompone en 1-2 entregas puras antes de guardarse" (ver `descomponerPago` en el backend), aplicado ahora sobre la dimensión de área además de la de método de pago — en el peor caso (venta mixta en área Y en método de pago) puede generar hasta 4 filas (insumos-efectivo, insumos-banco, con_sentido-efectivo, con_sentido-banco).

**La referencia bancaria y el monto recibido en efectivo se capturan UNA sola vez, no por fila.** Hoy `referenciaBanco`/`montoRecibidoEfectivo` se piden una vez por venta/abono (son datos de la transacción física real: una sola transferencia, un solo billete entregado), no por línea de producto. Al descomponer por área, si el resultado produce 2 filas "banco" (p. ej. insumos-banco + con_sentido-banco), ambas comparten la MISMA `referenciaBanco` ya capturada (es la misma transferencia, solo repartida contablemente); la validación de "cuánto entregó el cliente en efectivo" / cálculo de vuelta sigue operando sobre el EFECTIVO TOTAL de toda la venta, nunca por fila suelta.

## Backend

### Resolución del área por defecto de un producto

Nueva función (nombre tentativo `resolverAreaProducto(categoriaId)`), reutilizable desde Caja General, Cotizaciones y Pedidos: dado el `categoria_id` de un producto, busca `categorias_producto.modulo_id`; si es el módulo `insumos`, el área por defecto es `insumos`; en cualquier otro caso (incluyendo `categoria_id` nulo o categoría sin `modulo_id` marcado), el área por defecto es `con_sentido`.

### Descomposición al guardar

El punto donde hoy se hace un solo `INSERT INTO movimientos_caja` (a partir de un único `moduloOrigenSlug` para toda la venta) pasa a: agrupar las líneas por su `modulo_origen_id` ya resuelto (y, si aplica, por método de pago dentro de cada grupo), y generar un `INSERT` por cada combinación — mismo criterio que ya usa la descomposición de pagos "mixto".

### Pedidos

`pedidos.service.ts` dejará de mandar `moduloOrigenSlug: "pedidos"` fijo en `crearPedido`/`registrarAbono`. En su lugar:

- **Al crear el pedido**: se calcula, a partir del área resuelta de cada producto (y la de los ítems anotados a mano, que eligen su área ahí mismo — ver decisión 4), qué % del `precio_acordado` total le corresponde a cada área. Ese % queda guardado con el pedido (nuevo campo, p. ej. `pedido_areas` con `{pedidoId, moduloId, porcentaje}`, o el equivalente que el plan de implementación prefiera) — fijo desde ese momento, no se recalcula después.
- **En cada abono** (`registrarAbono`): el monto de ESE abono se reparte según esas proporciones fijas (mismo principio que `distribuirIgual`: todas las áreas excepto la última reciben `round(monto * porcentaje)`, la última se lleva el residuo exacto para que la suma dé exacto).
- **El abono que deja el pedido en $0 pendiente** (el último, sea cual sea su monto) hace un ajuste final: en vez de aplicar la proporción sobre SU propio monto, cierra exactamente el pendiente que le quede a cada área en ese momento — mismo criterio que ya usa Migao para el cierre exacto de la porción de tienda en la mesa combinada (evita que quede un carrito/área pegado 1-2 centavos corto para siempre).

## Frontend

### `IngresoModal.tsx`

- Se elimina por completo el bloque "Viene de" (`MODULOS_ORIGEN`, botones a nivel de todo el ingreso) y el estado `modulo`. **Excepción:** cuando el modal está `embebido` dentro del carrito de tienda vinculado a una mesa de Migao (ver decisión 8), esta pantalla NO lleva selector de área en absoluto — ese flujo sigue fijo a `con_sentido`, sin cambios.
- Cada línea (`lineas`/`ItemIngresoInput`) gana un selector de área junto a sus campos de cantidad/precio — con dos opciones, Insumos y Con Sentido/tienda. Al elegir un producto del catálogo, el selector arranca prellenado con el área resuelta de su categoría (editable). Al escribir un ítem a mano, arranca sin valor — hay que elegirlo, bloquea guardar si falta (ver decisión 4).
- **Modo "Monto único"** (`modoMonto === "unico"`, sin líneas de producto): hoy el backend arma un solo ítem a partir del `motivo` cuando no se mandan líneas. Ese modo gana el mismo selector de área, obligatorio, junto al campo de monto — se trata igual que un ítem anotado a mano.
- Como esta pantalla se reutiliza para facturar cotizaciones, el cambio aplica automáticamente ahí también, sin tocarlo por separado.

### Nueva pantalla: administrar el área de las categorías de producto

`categorias_producto` es una tabla **compartida** entre Migao (categorías de menú: Entradas, Postres...) y Con Sentido (Velas, Jabones...), distinguidas por `productos.modulo_id`, NO por la categoría en sí — Migao ya tiene su propia pantalla para crear/listar sus categorías (`MenuPage.tsx` y los modales de producto), que no toca esta función. La pantalla nueva de área debe listar **solo las categorías que de verdad usan productos con `productos.modulo_id = con_sentido`** (filtradas, no la tabla completa) — de lo contrario mostraría categorías de menú de Migao con un selector Insumos/Con Sentido que no significa nada para ellas. Cada fila, su selector Insumos/Con Sentido. Ubicación tentativa: una sección dentro de la página de Inventario de Con Sentido (`InventarioPage.tsx`), gateada por el mismo permiso administrativo que ya protege esa pantalla — el plan de implementación puede ajustar la ubicación exacta si hay un lugar más consistente con el resto de la navegación.

### Pedidos (`NuevoPedidoModal.tsx` y donde se gestionen sus ítems)

Gana el mismo selector de área por línea que `IngresoModal`, con la misma regla de resolución automática por categoría.

### `NuevaVentaModal.tsx` (pantalla "Ventas" de Con Sentido, `/con-sentido/ventas`)

Mismo cambio que `IngresoModal`: selector de área por línea con la misma resolución automática por categoría. Esta venta es de un solo golpe (sin abonos parciales), así que no hereda la complejidad de Pedidos — se trata igual que Caja General.

## Reportes

`analytics.repository.ts::getMovimientosPorModulo` ya agrupa por `movimientos_caja.modulo_origen_id` — como la descomposición solo agrega más filas, cada una con su área correcta, este reporte (y cualquier otro que lea `movimientos_caja` de la misma forma) debería seguir funcionando sin cambios.

**Importante — el dashboard de Con Sentido va a mostrar números distintos a partir de este cambio.** Hoy todos los números de ese dashboard coinciden exactamente, porque toda venta de Con Sentido es 100% área `con_sentido`. Después de este cambio, una venta mixta hace que diverjan por primera vez:

- `getIngresosPorMetodoPagoConSentido` ya filtra `movimientos_caja` por `modulo.slug = 'con_sentido'` — sigue siendo correcto tal cual (ahora sí refleja solo la plata que de verdad es de tienda).
- `getIngresosConSentido` (el total de ingresos) hoy suma TODA venta de Con Sentido sin filtrar por área — debe cambiar para filtrar por área `con_sentido` también, igual que el anterior, para que ambos números sigan significando lo mismo entre sí.
- `getVentasPorCategoriaConSentido`/`getProductosTopConSentido` (qué se vendió, no cuánta plata es de qué área) quedan **sin cambios** — siguen sumando todo lo vendido en el catálogo de Con Sentido sin filtrar por área, porque responden una pregunta distinta ("qué productos se mueven"), no "de quién es la plata."

## Dudas para el builder

- Confirmar en qué tabla(s) de ítems escribe realmente cada flujo en alcance (`caja_ingreso_items` vs `con_sentido_venta_items`, y si "Registrar ingreso" de Caja General pasa por una o por otra según el caso) antes de aplicar las columnas nuevas — ver nota en "Ítems de venta" arriba. Aplicar la columna `modulo_origen_id` solo donde de verdad corresponda.
- El nombre exacto y la forma de guardar la proporción fija por pedido (`pedido_areas` u otra forma) queda a criterio del plan de implementación, siempre que cumpla: fija al crear, no se recalcula sola después, y el builder puede nombrarla como mejor encaje con el resto del esquema de Pedidos.
- Decidir si se agrega alguna migración de datos para las ventas/movimientos **ya existentes** (quedarían con área nula a nivel de ítem, pero el movimiento de caja histórico ya tiene su área de siempre y no se toca) — por defecto, este diseño asume que el cambio es solo hacia adelante, sin reclasificar historial.
