# Módulo Vales — extensión "Deudas" (empleados/clientes le deben al negocio)

**Fecha:** 2026-10-08
**Estado:** Aprobado en brainstorming, pendiente de plan de implementación.
**Depende de:** `docs/superpowers/specs/2026-10-05-vales-design.md` (módulo Vales ya implementado y en producción).

## 1. Qué es una "deuda"

Un vale, hasta ahora, siempre documentaba dinero que **ya salió** del negocio. Esta extensión agrega un segundo **tipo** de vale, "deuda", para el caso contrario: dinero que **un empleado o cliente le debe al negocio** — nunca un dueño (los dueños ya tienen su propio mecanismo de reposición, que no cambia).

Una deuda tiene dos variantes según si hubo o no un desembolso real al crearla:

- **Con préstamo inicial**: sí sale dinero real de Caja al crearla (turno abierto, acumulado, o bolsillo de un dueño — las mismas 3 fuentes que un vale normal). Ejemplo: "le presté $100.000 a Juan".
- **Sin préstamo inicial**: no toca Caja para nada al crearla, solo queda registrado cuánto debe. Ejemplo: "Juan dañó una herramienta, debe $50.000".

En ambos casos, cuando la persona paga, se registra como un **ingreso real** en Caja (siempre contra el turno abierto — no existe "ingreso acumulado" en este sistema para ningún módulo), de una sola vez (sin abonos parciales), y la deuda queda saldada ("cobrada"). Se puede anular en cualquier momento, revirtiendo lo que corresponda.

**Si la deuda la financió un dueño de su bolsillo** (variante "con préstamo", fuente="dueño"): son dos obligaciones independientes que se resuelven por separado, en cualquier orden —
1. El negocio le debe reponer esa plata al dueño (mecanismo ya existente, sin cambios).
2. El empleado/cliente le debe esa plata al negocio (mecanismo nuevo de esta extensión: "cobrar").

**Fuera de alcance:** abonos parciales (la deuda se cobra completa, de una sola vez); deudas que generan "ingreso acumulado" (no existe esa infraestructura en Caja General — cobrar siempre exige turno abierto, igual que cualquier otro ingreso).

## 2. Modelo de datos

La tabla `vales` existente se amplía (no se crea una tabla nueva):

```sql
ALTER TABLE vales
  MODIFY COLUMN fuente VARCHAR(20) NULL,  -- antes NOT NULL; NULL = deuda sin préstamo inicial
  ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'pago' AFTER numero,
  ADD COLUMN monto_adeudado DECIMAL(12,2) NULL AFTER monto_banco,
  ADD COLUMN cobrado_en DATETIME(6) NULL AFTER fuente_reposicion,
  ADD COLUMN monto_cobrado_efectivo DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER cobrado_en,
  ADD COLUMN monto_cobrado_banco DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER monto_cobrado_efectivo;
```

Las filas existentes (todas creadas antes de esta extensión) quedan automáticamente `tipo='pago'` por el `DEFAULT`, sin ningún otro cambio — retrocompatible.

**Restricciones (CHECK) a reemplazar.** La tabla original tiene estas dos restricciones sin nombre explícito, que MySQL nombra automáticamente como `vales_chk_1` y `vales_chk_2` (por orden de aparición en el `CREATE TABLE` original — convención documentada de MySQL 8, no específica de este proyecto):

```sql
-- vales_chk_1: CHECK (fuente IN ('turno', 'acumulado', 'dueno'))
-- vales_chk_2: CHECK (monto_efectivo + monto_banco > 0)
```

Ambas deben reemplazarse porque `fuente` ahora puede ser NULL (deuda sin préstamo) y en ese caso `monto_efectivo`/`monto_banco` siguen en 0 legítimamente. La tercera restricción original (`fuente != 'dueno' OR dueno_id IS NOT NULL`, sin nombre fijo tampoco pero no listada acá) **no necesita tocarse**: con `fuente` en NULL, esa expresión evalúa a NULL (no a falso), que en SQL no viola el CHECK — sigue funcionando igual para los casos que ya cubría.

**Riesgo documentado para el plan:** si al correr la migración `ALTER TABLE vales DROP CONSTRAINT vales_chk_1` (o `vales_chk_2`) MySQL responde que esa restricción no existe, el nombre real difiere del esperado — hay que consultar `information_schema.TABLE_CONSTRAINTS` (columna `CONSTRAINT_NAME`, filtrando `TABLE_NAME='vales'` y `CONSTRAINT_TYPE='CHECK'`) para encontrar el nombre real antes de reintentar. Es un fallo ruidoso y recuperable (no silencioso, no destructivo), nunca corre dos veces sin que la persona lo note.

**Restricciones nuevas:**

```sql
ADD CONSTRAINT chk_vales_tipo CHECK (tipo IN ('pago','deuda')),
ADD CONSTRAINT chk_vales_fuente CHECK (fuente IS NULL OR fuente IN ('turno','acumulado','dueno')),
ADD CONSTRAINT chk_vales_fuente_null_solo_deuda CHECK (fuente IS NOT NULL OR tipo = 'deuda'),
ADD CONSTRAINT chk_vales_monto_pago CHECK (fuente IS NULL OR monto_efectivo + monto_banco > 0),
ADD CONSTRAINT chk_vales_monto_adeudado CHECK (fuente IS NOT NULL OR (monto_adeudado IS NOT NULL AND monto_adeudado > 0)),
ADD CONSTRAINT chk_vales_cobro_solo_deuda CHECK (cobrado_en IS NULL OR tipo = 'deuda'),
ADD CONSTRAINT chk_vales_monto_cobrado CHECK (cobrado_en IS NULL OR monto_cobrado_efectivo + monto_cobrado_banco > 0)
```

**Permiso nuevo:** `vales.marcar_cobrado` — exclusivo de Root y Super Root, mismo patrón que `vales.marcar_repuesto` (migración incremental con `WHERE NOT EXISTS`, más las filas correspondientes en `database/mysql/schema.sql`/`seed.sql` para instalaciones nuevas, siguiendo exactamente el mismo mecanismo ya usado para los 4 permisos originales de vales).

Los campos que ya existen (`pagado_a`, `concepto`, `destinatario_usuario_id`, `destinatario_documento`, `dueno_id`, `repuesto_en`, `fuente_reposicion`, `anulado_en`) se reutilizan tal cual para una deuda — sin cambios de significado.

## 3. Backend

### 3.1 Crear una deuda (mismo `POST /vales`, input ampliado)

El input de `crearValeSchema` se amplía con un campo `tipo: "pago" | "deuda"` (por defecto `"pago"` si se omite — así las llamadas existentes, sin este campo, siguen funcionando exactamente igual). Dos formas válidas del body:

- **Con fuente** (tipo="pago" por defecto, o tipo="deuda" explícito): igual que hoy — `fuente` + pago (mismo shape de `pagoValeSchema`). La única diferencia es el valor de `tipo` que se guarda.
- **Sin fuente** (solo válido con tipo="deuda" explícito): en vez de `fuente`+pago, se manda `montoAdeudado: number` (positivo). No se toca Caja.

El service (`vales.service.ts::crearVale`) se ramifica según si el input trae `fuente`:
- Con fuente: idéntica lógica a la actual (genera el egreso correspondiente según `fuente`), solo que ahora también puede ser `tipo="deuda"`.
- Sin fuente: inserta el vale con `fuente=NULL`, `monto_efectivo=0`, `monto_banco=0`, `monto_adeudado=input.montoAdeudado` — sin ninguna llamada a `cajaService`.

### 3.2 Cobrar una deuda (nuevo: `POST /vales/:id/cobrar`)

Permiso `vales.marcar_cobrado` (Root/Super Root). Válido solo si `vale.tipo === "deuda"`, `cobrado_en IS NULL`, `anulado_en IS NULL`.

El monto a cobrar es siempre el monto exacto que se debe — `vale.monto_adeudado` si `fuente IS NULL`, o `vale.monto_efectivo + vale.monto_banco` si hubo préstamo. El input solo trae el método de pago (mismo shape que `pagoValeSchema`); el service valida server-side que la suma de lo que llega coincide (con tolerancia de redondeo) con el monto exacto adeudado — nunca confía en que el formulario mande el total correcto, mismo criterio aplicado tras la revisión del módulo original a `referenciaEntidad`/`referenciaId`.

Genera un ingreso real vía `cajaService.registrarIngreso(...)` contra el turno abierto (exige turno abierto — mismo mensaje de error de siempre si no hay uno), con `referenciaEntidad='vales_cobro'`, `referenciaId=vale.id`. Guarda `cobrado_en`, `monto_cobrado_efectivo`, `monto_cobrado_banco`.

### 3.3 Anular (amplía la lógica existente)

Además de lo que ya revierte hoy (egreso original si `fuente` no es NULL, reposición si `repuesto_en` no es NULL), ahora también revierte el cobro si `cobrado_en` no es NULL — vía la misma función genérica `cajaService.anularMovimientosPorReferencia(client, 'vales_cobro', id, nota, usuarioId)` ya existente (opera sobre cualquier fila de `movimientos_caja`, sea ingreso o egreso, por eso no hace falta una función nueva). Los tres reversos son independientes entre sí.

### 3.4 Listar/filtrar

`GET /vales` gana un filtro `tipo` (`"pago"|"deuda"`) además de los que ya tiene (`fuente`, `estado`). El significado de `estado` se generaliza: "activo" (nada resuelto todavía), "resuelto" (repuesto O cobrado, según corresponda), "anulado" — unificando el vocabulario entre pagos y deudas en vez de tener dos juegos de estados distintos.

## 4. Frontend

- **Listado (`ValesPage`)**: columna nueva "Tipo" (Pago/Deuda) + filtro por tipo. El estado de una deuda se muestra como "Pendiente de cobro"/"Cobrada"/"Anulada".
- **`NuevoValeModal`**: selector arriba de todo, "Pago" o "Deuda". Si es "Deuda": la etiqueta "Pagado a" cambia a "¿Quién debe?" (sigue siendo texto libre, funciona igual para alguien externo al sistema — eso ya estaba cubierto por diseño desde el módulo original). Aparece la pregunta "¿Hubo un préstamo inicial?" — si sí, se muestra el mismo selector de fuente + método de pago de siempre; si no, solo un campo "Monto que debe".
- **`DetalleValePage`**: si es una deuda, botón "Marcar como cobrada" (independiente del botón "Marcar como repuesto", que sigue existiendo si además la financió un dueño) — deja elegir el método de pago sobre el monto exacto adeudado, que no es editable.

## 5. Impresión

Una deuda reusa el mismo `tipo: "vale"` de `ReciboImprimible` (no se agrega un tipo nuevo al componente compartido), diferenciándose mediante el campo `variante` ya existente (hoy tipado como `variante?: "ingreso" | "egreso"`, usado solo por `tipo: "movimiento"`). Hay que ampliar ese tipo a `variante?: "ingreso" | "egreso" | "deuda"` y agregar una condición nueva (`esDeuda = esVale && variante === "deuda"`, paralela e independiente de la `esEgreso` que ya existe) para que `variante: "deuda"` también aplique cuando `tipo: "vale"`:

- El encabezado dice "DEUDA" (pendiente de cobro, o ya cobrada) en vez de "VALE".
- La línea de firma cambia de significado: en un vale normal es "firma de quien recibe" (recibió el dinero); en una deuda pendiente es "firma de quien reconoce la deuda" (constancia de que acepta que debe ese valor — útil sobre todo para el caso de un daño, donde nunca hubo entrega de dinero que firmar).

## Decisiones explícitas (para que el plan no las reabra)

- Una deuda nunca es de un dueño (los dueños financian, no deben) — solo empleados o clientes.
- Con préstamo: puede salir de turno, acumulado, o bolsillo de un dueño (mismas 3 fuentes que un pago). Sin préstamo: no toca Caja en absoluto.
- Cobrar siempre exige turno abierto; no existe "ingreso acumulado" en este sistema y esta extensión no lo construye.
- El cobro es siempre completo, de una sola vez — no hay abonos parciales.
- El monto a cobrar no es editable por quien cobra; solo el método de pago.
- Si una deuda la financió un dueño, reponerle al dueño y cobrarle al empleado/cliente son dos acciones independientes, en cualquier orden.
- Anular una deuda revierte hasta 3 cosas (préstamo, reposición, cobro), cada una si llegó a ocurrir.
