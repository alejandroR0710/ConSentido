# Módulo Vales — diseño

**Fecha:** 2026-10-05
**Estado:** Aprobado en brainstorming, pendiente de plan de implementación.

## 1. Qué es un vale

Un vale es el **comprobante de un pago que ya salió del negocio** (no una promesa para cobrar después — el dinero ya se entregó en el momento de crear el vale). Cubre casos como pagar un anticipo a un empleado, entregar dinero a alguien por un motivo puntual, etc. Una vez creado:

- Si la fuente fue el **bolsillo de un dueño**, queda pendiente de reposición hasta que alguien marque "Repuesto", lo cual genera un egreso real en Caja General por ese monto.
- Cualquier vale se puede **anular** (como anular una venta): si ya generó egreso(s) reales en Caja (al crearse, o al reponerse), esos egresos se revierten con el mismo patrón de auditoría ya usado para anular ventas y para cancelar un pedido enviado.

**Fuera de alcance de esta versión:** vales que representan derecho a un producto/servicio (no dinero), y cualquier integración real con el futuro módulo de nóminas — solo se deja un enganche opcional (`destinatario_usuario_id`) para que ese módulo, cuando exista, pueda encontrar los vales de un empleado sin necesitar una migración de datos.

## 2. Modelo de datos

```sql
CREATE TABLE vales (
  id                        CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  numero                    VARCHAR(20) NOT NULL UNIQUE,  -- "V-000123"
  pagado_a                  VARCHAR(150) NOT NULL,
  -- Enganche opcional a futuro (módulo de nóminas): se llena cuando el
  -- destinatario es un usuario existente del sistema (ej. un empleado).
  destinatario_usuario_id   CHAR(36) NULL,
  destinatario_documento    VARCHAR(30) NULL,
  concepto                  TEXT NOT NULL,
  monto_efectivo            DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_banco               DECIMAL(12,2) NOT NULL DEFAULT 0,
  fuente                    VARCHAR(20) NOT NULL
                             CHECK (fuente IN ('turno', 'acumulado', 'dueno')),
  dueno_id                  CHAR(36) NULL,  -- solo si fuente='dueno'
  repuesto_en               DATETIME(6) NULL,
  -- 'turno' | 'acumulado' — con qué se repuso (null hasta reponer). Al
  -- anular hace falta saber esto para revertir en la tabla correcta,
  -- igual que `fuente` lo dice para el movimiento original.
  fuente_reposicion         VARCHAR(20) NULL,
  anulado_en                DATETIME(6) NULL,
  creado_por_id             CHAR(36) NOT NULL,
  created_at                DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (destinatario_usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (dueno_id) REFERENCES usuarios(id),
  FOREIGN KEY (creado_por_id) REFERENCES usuarios(id),
  CHECK (monto_efectivo + monto_banco > 0),
  CHECK (fuente != 'dueno' OR dueno_id IS NOT NULL)
);
CREATE SEQUENCE vales_numero_seq START 1;
```

`monto` total y "método" (efectivo/banco/mixto) para mostrar en pantalla se
derivan siempre de `monto_efectivo`/`monto_banco` — nunca se guardan por
separado, igual criterio que el resto del sistema evita denormalizar un dato
que se puede calcular.

Categoría de gasto fija "Vales" en `categorias_gasto` (se inserta en la
migración si no existe) — es la que usan los egresos que un vale genera en
Caja, para que el campo `categoria_gasto_id` (obligatorio en
`registrarEgreso`/`registrarEgresoAcumulado`) nunca se le pida al usuario en
el formulario de vale.

Permisos nuevos: `vales.ver`, `vales.crear`, `vales.marcar_repuesto`,
`vales.anular` — otorgados únicamente a Root y Super Root (ningún otro rol).

## 3. Backend

### 3.1 Crear un vale (`POST /vales`)

Input: `pagadoA`, `destinatarioUsuarioId?`, `destinatarioDocumento?`, `concepto`,
pago (mismo shape que `PagoInput` de `pago-mixto.ts`: `{metodoPago:"efectivo"|"banco", monto}` o `{metodoPago:"mixto", montoEfectivo, montoBanco}` — **sin `referenciaBanco`**: esa regla es solo para pagos recibidos/ingresos, nunca para egresos; el precedente real, `EgresoModal.tsx`, ya usa `<SelectorMetodoPago pedirReferenciaBanco={false} />` por esto mismo), `fuente: "turno"|"acumulado"|"dueno"`, `duenoId?` (obligatorio si `fuente==="dueno"`).

Según `fuente`:
- **`"turno"`**: `cajaService.registrarEgreso({categoriaGastoId: <id de "Vales">, motivo: concepto, metodoPago, monto|montoEfectivo+montoBanco, moduloOrigenSlug: "vales"}, usuarioId)` — ya exige turno abierto y ya soporta mixto vía `descomponerPago`. Los movimientos quedan con `referencia_entidad='vales'`, `referencia_id=vale.id` — **confirmado**: la columna ya existe en `movimientos_caja` (la usan los ingresos), pero `insertEgreso`/`registrarEgreso` hoy no la reciben ni la insertan; hay que agregarles ese parámetro opcional (igual patrón que ya tiene el lado de ingreso).
- **`"acumulado"`**: `cajaService.registrarEgresoAcumulado(...)` — **requiere ampliar esta función para que soporte pago mixto** (hoy solo acepta un `metodoPago` suelto): debe usar `descomponerPago` igual que `registrarEgreso` e insertar una fila de `caja_egresos_acumulado` por cada parte.
- **`"dueno"`**: no se toca Caja. Solo se guarda el vale.

Todo dentro de una transacción (igual que `crearPedido`/`cambiarEstadoPedido`): si el egreso falla (ej. no hay turno abierto), el vale no se crea.

**Corrección tras verificar el código real (no estaba en la versión anterior
de esta spec):** `caja_egresos_acumulado` **no tiene** columnas
`referencia_entidad`/`referencia_id` como sí tiene `movimientos_caja` — hay
que agregárselas en la misma migración de este módulo. Por eso el caso
`"turno"` y el caso `"acumulado"` necesitan mecanismos de reversión
DISTINTOS al anular (ver 3.3): no son la misma tabla.

### 3.2 Marcar como repuesto (`POST /vales/:id/reponer`)

Solo si `fuente==="dueno"` y el vale no está repuesto ni anulado. Body: `fuenteReposicion: "turno"|"acumulado"` (nunca "dueno" — reponerle a un dueño con el dinero del mismo dueño no tiene sentido). Genera el egreso correspondiente por el mismo monto/método del vale original, con `referencia_entidad='vales_reposicion'` (distinta de `'vales'`, para poder diferenciar al anular cuál revertir), y guarda `repuesto_en` + `fuente_reposicion` (para saber en qué tabla buscar al anular).

### 3.3 Anular (`POST /vales/:id/anular`)

Solo si el vale no está anulado ya (si ya está repuesto, SÍ se puede anular — revierte ambos). La reversión depende de en qué tabla vive cada movimiento:

1. Movimiento original (si `fuente==="turno"`): `cajaService.anularMovimientosPorReferencia(client, 'vales', vale.id, nota, usuarioId)` — ya trae su propia auditoría en `movimientos_caja_ediciones` y devuelve los `turnoId` afectados.
2. Movimiento original (si `fuente==="acumulado"`): **nueva función** `cajaService.anularEgresoAcumuladoPorReferencia(client, 'vales', vale.id)` — borra la(s) fila(s) de `caja_egresos_acumulado` con esa referencia. Sin auditoría dedicada (esa tabla no tiene su propia tabla de ediciones, a diferencia de `movimientos_caja`): el propio registro del vale (`anulado_en`, `creado_por_id`) ya documenta qué pasó y cuándo — no se justifica construir una tabla de auditoría paralela solo para este caso. El acumulado total se recalcula siempre en vivo (`obtenerAcumuladoTotal`), así que no hace falta recalcular nada aparte.
3. Si `repuesto_en` no es null, repetir 1 o 2 según `fuente_reposicion` (no `fuente`) para el movimiento de la reposición, con `referencia_entidad='vales_reposicion'`.
4. Marca `anulado_en = NOW()`.
5. Después del COMMIT: si algún paso usó `movimientos_caja` (turno), `cajaService.recalcularCierresSiEstanCerrados(turnoIdsAfectados)` para cualquier turno ya cerrado que haya quedado involucrado (función ya existente). El caso acumulado no lo necesita (punto 2).

### 3.4 Listar/obtener

`GET /vales` (filtros: fuente, estado — activo/repuesto/anulado), `GET /vales/:id`.

## 4. Frontend

- **Botón en el header global** (`AppShell.tsx`, junto a `BotonLeadExterno`): ícono visible solo si `tieneAccesoTotal(usuario.rol)`, navega a `/vales`.
- **`VálesPage` (`/vales`)**: listado con número, fecha, pagado a, monto, fuente, estado, filtros por fuente/estado. Botón "+ Nuevo vale".
- **`NuevoValeModal`**: pagado a (texto libre + selector opcional de usuario existente para el enganche de nóminas), documento, concepto, `SelectorMetodoPago` (reusado), selector de fuente (3 opciones; si "dueño", selector de usuario entre Root/Super Root).
- **`DetalleValePage` (`/vales/:id`)**: todos los datos + historial. Botones condicionales: "Marcar como repuesto" (solo dueño, no repuesto, no anulado — pide elegir turno/acumulado), "Anular vale" (si no anulado, con confirmación), "🖨️ Imprimir vale".

## 5. Impresión

Nuevo `tipo: "vale"` en `ReciboImprimible` (mismo componente compartido de
siempre): número, fecha, "Pagado a" + documento, concepto, monto (desglose
efectivo/banco si es mixto), fuente de los fondos, y una línea en blanco al
final `Firma: ___________________` para firmar de recibido en el papel —
mismo criterio que ya existe en el comprobante de entrega de propina.

## Decisiones explícitas (para que el plan no las reabra)

- Un vale documenta dinero que **ya salió**, no una promesa a futuro — no tiene estado "pendiente de cobro".
- "Pagado a" es siempre texto libre; el usuario vinculado es un dato opcional aparte, nunca un reemplazo del texto.
- Reponer y anular son las únicas transiciones de estado que existe; no hay edición de los demás campos después de creado.
- Anular un vale ya repuesto está permitido (revierte las dos cosas); anular uno ya anulado no.
- Permisos exclusivos de Root/Super Root, sin excepción para Cajero/Administrador.
