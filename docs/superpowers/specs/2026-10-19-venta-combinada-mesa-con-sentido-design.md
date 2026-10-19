# Venta combinada: mesa de Migao + productos de Con Sentido — Diseño

## Contexto y caso de uso

Un cliente consume en una mesa del salón de Migao (tiene una orden abierta ahí) y, al momento de pagar, también quiere comprar productos de Con Sentido (velas, jabones, etc.). El cajero necesita armar esa compra combinada — vinculando los productos de Con Sentido a la mesa donde consumió ese cliente — y cobrar todo con el proceso normal de una mesa: propina, descuento, pago parcial y pago diferido. Al momento de cobrar debe verse la suma de ambas partes. Al facturar, cada parte sigue generando su propia factura independiente, como hoy.

El orden de los hechos no debe importar: el cliente puede consumir primero y comprar después, o comprar primero y sentarse a consumir después.

## Decisiones de diseño (aprobadas en la conversación de brainstorming)

1. **Dos puertas, un mismo vínculo.** Se puede iniciar desde el cobro de la mesa en Migao (agregando ahí un carrito de Con Sentido) o desde la pantalla de Con Sentido (vinculando una mesa a la venta). Ninguna pantalla nueva — se extienden las dos existentes.
2. **El vínculo vive por *parte*, no por mesa completa.** Si la cuenta de una mesa se divide entre varios comensales (`migao_cuenta_partes`), cada parte puede tener su propio carrito de Con Sentido, independiente de las demás partes de la misma mesa.
3. **Propina:** se calcula solo sobre la porción de mesa de cada abono — nunca sobre los productos de Con Sentido (igual que hoy, donde Con Sentido nunca genera propina).
4. **Descuento:** por separado — un % de descuento para la porción de mesa (como ya existe hoy) y un % de descuento independiente para el carrito de Con Sentido de esa misma parte.
5. **Pago parcial/diferido:** cada abono sobre una parte se reparte proporcionalmente entre lo que falta de mesa y lo que falta de Con Sentido, según la proporción vigente en ese momento. Ambos lados bajan juntos.
6. **Facturación:** al cerrar, cada lado genera su propia factura, exactamente como si nunca hubieran estado vinculados. El vínculo queda como dato de trazabilidad, no aparece en la factura impresa.
7. **Stock de Con Sentido:** se descuenta desde que el producto se agrega al carrito de la parte (igual que Migao ya descuenta ingredientes desde que se agrega un ítem a la orden, no hasta que se paga). Quitar un producto del carrito antes de pagar devuelve el stock.
8. **Cancelación:** si la parte tiene algo ya pagado (de mesa o de tienda), no se puede cancelar — mismo criterio que ya existe hoy para una parte con pagos. Si nada se ha pagado, cancelar la parte también cancela su carrito de tienda pendiente.

## Alcance

Este flujo aplica exclusivamente al motor de cobro con partes/abonos de Migao (`iniciarCobro` + `obtenerCuenta` + `registrarAbono` — el único de los 3 mecanismos de cobro de Migao que soporta pago parcial/diferido). **No** aplica a `cerrarOrden` (cobro de un solo golpe) ni a `pagarItems` (cobrar ítems sueltos sin dividir la cuenta) — esos dos mecanismos quedan exactamente como están hoy, sin vínculo a Con Sentido.

## Modelo de datos

### `con_sentido_ventas` (ALTER)

```sql
ALTER TABLE con_sentido_ventas
  ADD COLUMN parte_id CHAR(36) NULL,
  ADD COLUMN descuento_porcentaje DECIMAL(5,2) NULL DEFAULT 0,
  ADD COLUMN descuento DECIMAL(12,2) NULL DEFAULT 0,
  ADD CONSTRAINT fk_con_sentido_ventas_parte FOREIGN KEY (parte_id) REFERENCES migao_cuenta_partes(id);

-- El CHECK de estado es sin nombre (con_sentido_ventas_chk_2) — hay que soltarlo
-- por su nombre real (confirmar con SHOW CREATE TABLE antes de escribir la
-- migración final, puede diferir entre entornos) y recrearlo con nombre:
ALTER TABLE con_sentido_ventas DROP CHECK con_sentido_ventas_chk_2;
ALTER TABLE con_sentido_ventas
  ADD CONSTRAINT chk_con_sentido_ventas_estado CHECK (estado IN ('pendiente', 'completada', 'anulada'));
```

- `parte_id IS NULL` → venta de Con Sentido normal, sin vínculo (comportamiento actual, intacto).
- `parte_id IS NOT NULL` → venta vinculada a esa parte de una mesa. Mientras `estado = 'pendiente'`, es un carrito editable (agregar/quitar productos). Pasa a `'completada'` solo cuando el lado de tienda de esa parte queda totalmente pago.
- `descuento_porcentaje`/`descuento`: nuevos, solo se usan cuando `parte_id IS NOT NULL` (una venta de Con Sentido normal nunca tuvo descuento y sigue sin tenerlo).

### Nuevo permiso

```sql
INSERT INTO permisos (modulo_id, accion, codigo) VALUES
  ((SELECT id FROM modulos WHERE slug = 'con_sentido'), 'vincular_mesa', 'con_sentido.ventas.vincular_mesa');
```

Otorgado a Cajero (además de Root/Super Root, que ya tienen todos los permisos por sus reglas existentes). Gatea:
- Crear/editar el carrito de tienda de una parte (ambas puertas llaman al mismo endpoint).
- Ver/reimprimir una venta de Con Sentido que tenga `parte_id IS NOT NULL` (sin necesitar el permiso general `con_sentido.ventas.ver`, que Cajero sigue sin tener para ventas sueltas).

Agregar la migración correspondiente + reflejar en `database/mysql/schema.sql` y `database/mysql/seed.sql` (o el `database/seed.sql` original, según corresponda al patrón ya establecido en este proyecto).

## Backend

### Nuevo endpoint: gestionar el carrito de tienda de una parte

`PUT /con-sentido/partes/:parteId/carrito` (nombre tentativo — el plan de implementación puede ajustarlo si hay un patrón de rutas más consistente con el resto del código).

- Permiso: `con_sentido.ventas.vincular_mesa`.
- Input: `{ items: [{ productoId, cantidad }], descuentoPorcentaje? }` (reemplaza el carrito completo, mismo patrón que `guardarIngredientesSchema` de Migao — "reemplazar todo" es más simple que "agregar/quitar" incremental).
- Si la parte no tiene aún una venta de Con Sentido vinculada (`parte_id`), la crea en `estado='pendiente'`, con sus `con_sentido_venta_items`, descontando stock según la regla de "se descuenta al agregar."
- Si ya existe una venta `pendiente` para esa parte, reemplaza sus items (devolviendo el stock de los que ya no están, descontando el de los nuevos) y recalcula `monto`/`descuento`.
- Si la parte ya está en `'cerrada'`/tiene pagos que cubren la porción de tienda, rechaza el cambio (no se puede editar un carrito ya pagado).
- Valida que la mesa/orden siga abierta o en `'pagando'` (no se puede vincular tienda a una orden ya cerrada/cancelada).

### Puerta 2 (crear el vínculo desde Con Sentido sin una parte existente)

Si el cajero elige una mesa que todavía no tiene ningún cobro iniciado (`iniciarCobro` nunca llamado para esa orden), el mismo endpoint debe, en la misma transacción, llamar internamente al equivalente de `iniciarCobro` con `division: {modo:"igual", numPartes:1}` para crear la parte única, y luego vincular el carrito a esa parte recién creada. Esto es lo que permite "comprar en la tienda primero" sin que el cajero tenga que ir primero a Migao a iniciar el cobro manualmente.

### `obtenerCuenta` (extender la respuesta existente)

Cada parte en la respuesta gana un campo nuevo, p. ej.:

```ts
tienda: {
  ventaId: string;
  items: { productoId, nombre, cantidad, precioUnitario, subtotal }[];
  subtotal: number;
  descuentoPorcentaje: number;
  descuentoMonto: number;
  totalConDescuento: number;
  pagado: number;   // SUM(movimientos_caja.monto WHERE referencia_entidad='con_sentido_ventas' AND referencia_id=ventaId)
  pendiente: number;
} | null
```

El frontend suma `parte.pendiente` (mesa) + `parte.tienda.pendiente` para mostrar el total combinado a cobrar.

### `registrarAbono` (extender)

Cuando la parte tiene `tienda` con `pendiente > 0`:

1. Calcular la proporción vigente: `proporcionTienda = tienda.pendiente / (parte.pendienteMesa + tienda.pendiente)`.
2. Repartir el `monto` del abono: `montoTienda = round(monto * proporcionTienda)`, `montoMesa = monto - montoTienda` (la resta, no un segundo `round()`, para que los dos montos siempre sumen exacto el monto original del abono — cualquier centavo de redondeo queda del lado de mesa).
3. Seguir el flujo actual de `registrarAbono` para `montoMesa` (pagos, propina solo sobre esto, `movimientos_caja` tagueado a `referencia_entidad='ventas'` como hoy).
4. Para `montoTienda`: llamar a `cajaService.registrarIngreso` (mismo `client`/transacción) con `modulo_origen_id` de con_sentido, `referencia_entidad='con_sentido_ventas'`, `referencia_id=tienda.ventaId`, descomponiendo efectivo/banco en la misma proporción que ya traiga el abono si es mixto.
5. Si tras esto `tienda.pendiente` (recalculado) llega a ~0: marcar esa `con_sentido_ventas` como `'completada'` y crear su factura (`getOrCrearFactura`, mismo patrón que ya usa Con Sentido hoy) — recién en este momento se asigna el número de factura, no antes.
6. El cierre de la parte (¿la orden pasa a `'cerrada'`?) sigue dependiendo solo de que el lado de MESA quede en 0, como hoy — el lado de tienda no bloquea ni acelera el cierre de la orden en sí, pero sí debe estar en 0 para que esa parte se considere completamente resuelta de cara al cajero (el frontend no debe dejar "sin cobrar" visualmente un carrito de tienda pendiente aunque la mesa ya esté en 0).

### Cancelación

Al cancelar una parte/orden: si existe una `con_sentido_ventas` con `parte_id` apuntando a ella y `estado='pendiente'` y nada se le ha pagado (`SUM(movimientos_caja...) = 0`), se marca `'anulada'` y se devuelve el stock de sus items. Si ya tiene algo pagado, la cancelación de la parte se rechaza (mismo criterio que ya existe para pagos de mesa).

## Frontend

### Puerta 1 — Migao (`MigaoPage.tsx` o un componente extraído de cobro)

Dentro de la vista de cada parte (cuenta dividida o única), un botón **"+ Agregar producto de la tienda"** abre un buscador de productos de Con Sentido (reutilizar el buscador ya existente en `NuevaVentaModal.tsx` de Con Sentido, extraído si hace falta a un componente compartido). Muestra: lista de productos agregados, subtotal, campo de % de descuento propio, y el total de esa parte ya sumado (mesa + tienda) antes de cobrar/abonar.

### Puerta 2 — Con Sentido (`NuevaVentaModal.tsx` o flujo de venta)

Paso opcional **"¿Vincular a una mesa?"**: selector visual de mesas (reutilizar el plano/mapa de mesas ya usado en Migao — número, piso, estado, capacidad visibles). Al elegir una mesa:
- Si ya tiene partes (cuenta dividida), elegir a cuál parte vincular.
- Si no tiene cobro iniciado, se crea automáticamente una parte única (ver Puerta 2 del backend).

### Pantalla de cobro (ambas puertas convergen acá)

El total a cobrar/abonar de cada parte muestra claramente el desglose: subtotal mesa − descuento mesa, subtotal tienda − descuento tienda, total combinado. Al facturar, dos botones/acciones de impresión independientes — una para la factura de Migao, otra para la de Con Sentido — exactamente como salen hoy cada una por separado.

## Fuera de alcance (explícitamente no cubierto por este diseño)

- Vincular Con Sentido a `cerrarOrden` (cobro de un solo golpe) o a `pagarItems` (cobro de ítems sueltos).
- Vincular un cliente (`clientes`) a la venta de Con Sentido — sigue sin existir ese concepto, no se agrega aquí.
- Cualquier cambio al subsistema de liquidación de propinas (`migao_propinas_liquidaciones`) — la propina de este flujo se comporta exactamente igual que hoy, sin tocar esa parte.
