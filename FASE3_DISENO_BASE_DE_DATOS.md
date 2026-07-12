# Fase 3 - Diseño de Base de Datos

## Objetivo
Transformar los módulos, casos de uso y flujos de la Fase 2 en un modelo entidad-relación normalizado, escalable y con los módulos interconectados a través de un núcleo transversal común.

## Motor y convenciones
- Motor: PostgreSQL 14+.
- Identificadores: `UUID` (`gen_random_uuid()`) para entidades de negocio expuestas a la API o referenciadas entre módulos (usuarios, clientes, insumos, productos, órdenes, pedidos...). `SERIAL`/`BIGSERIAL` para catálogos internos y tablas de alto volumen append-only (movimientos, auditoría, items).
- Toda tabla con ciclo de vida editable tiene `created_at` / `updated_at`, con trigger `set_updated_at()` para el segundo.
- Estados (`estado`) se validan con `CHECK` en vez de tipos ENUM nativos, para poder agregar nuevos estados sin migraciones de tipo.
- Trazabilidad: cantidades y montos nunca se recalculan a mano donde se pueda derivar (`GENERATED ALWAYS AS ... STORED`), ej. subtotales y rentabilidad.

## El núcleo transversal (lo que conecta todo)
Tres entidades compartidas evitan que cada módulo duplique datos y permiten reportes y auditoría cruzados:

1. **`usuarios`** — todo módulo referencia `usuarios.id` para saber quién hizo qué (mesero, cajero, responsable de taller, encargado de pedido). Los `permisos` se agrupan por `modulo_id`, así el Super Root asigna acceso módulo por módulo.
2. **`clientes`** — una sola tabla de clientes es usada por `reservas` (Talleres), `ventas` (Con Sentido/Migao), `ordenes` (Migao) y `pedidos` (Encargos). Un mismo cliente frecuente se reconoce en todas las áreas.
3. **`insumos` + `movimientos_insumo`** — el inventario de materias primas es único. `movimientos_insumo` es la tabla puente: cualquier módulo que consuma insumos (Talleres vía `actividad_materiales`, Migao vía `orden_items`, Pedidos vía `pedido_items`) genera un movimiento con `modulo_origen_id` + `referencia_entidad` + `referencia_id`, lo que da trazabilidad completa sin acoplar `movimientos_insumo` a cada módulo con FKs rígidas.

Esto resuelve el "Flujo 1: Gestión de inventario transversal" de la Fase 2 (un insumo se registra una vez, se consume desde cualquier área, se audita desde un solo lugar).

## Mapa de tablas por módulo

### Módulo general transversal
`modulos`, `roles`, `permisos`, `roles_permisos`, `usuarios`, `usuarios_modulos`, `auditoria`, `alertas`, `categorias_gasto`, `turnos_caja`, `movimientos_caja`

### Insumos
`categorias_insumo`, `proveedores`, `almacenes`, `insumos`, `inventario_insumos` (stock por almacén), `movimientos_insumo`

### Talleres / Experiencias
`actividades`, `reservas`, `asistentes`, `actividad_materiales` (consumo de insumos planeado vs. real), `actividad_cierres` (rentabilidad calculada)

### Con Sentido
`categorias_producto`, `productos`, `inventario_productos`, `promociones`, `ventas`, `venta_items`

### Migao (POS)
`zonas`, `mesas`, `ordenes`, `orden_items`, `pagos`, `facturas`

### Pedidos / Encargos
`pedidos`, `pedido_items`, `pedido_abonos`, `pedido_historial`

## Addendum (Fase 5): Caja General
Durante el desarrollo se agregó el rol transversal **Cajero**, que centraliza pagos de cualquier módulo y retiros por gasto interno. Tablas agregadas al núcleo transversal:
- **`turnos_caja`**: apertura/cierre diario de la caja, con **dos cuentas independientes por método de pago** (efectivo y banco — tarjeta/transferencia colapsan en "banco" al entrar a caja) más el total general (suma de ambas). `monto_inicial_efectivo`/`monto_inicial_banco` se heredan automáticamente de los montos finales del último turno cerrado (el ingreso es diario, no se reinicia en cero). Un índice único parcial (`uq_turno_abierto_global`) garantiza que solo exista **un turno abierto para todo el negocio a la vez** — no es una caja por cajero, es una caja única que se va turnando entre cajeros/días.
- **`movimientos_caja`**: ingresos (pagos que vienen de cualquier módulo, vía `modulo_origen_id`) y egresos (retiros por gasto interno, vía `categoria_gasto_id`), cada uno con su `metodo_pago` (`efectivo`/`banco`) y ligados a un `turno_id`. Sigue el mismo patrón puente que `movimientos_insumo` (`referencia_entidad` + `referencia_id` para trazar de qué venta/pago/abono viene un ingreso).
- **`categorias_gasto`**: catálogo administrable de motivos de egreso (ej. "servicios", "mantenimiento").
- Al cerrar un turno: `monto_final_calculado_efectivo = inicial_efectivo + Σingresos_efectivo − Σegresos_efectivo` y `diferencia_efectivo = declarado − calculado` (faltante/sobrante físico, el cajero cuenta los billetes). `monto_final_calculado_banco` se calcula igual pero **no tiene conteo físico ni diferencia** — banco es un registro electrónico, no hay billetes que contar. El total general de cualquier momento es `saldo_efectivo + saldo_banco`.

## Decisiones clave de diseño
- **`productos` es compartida entre Con Sentido y Migao** (columna `modulo_id`), evitando dos catálogos duplicados para el mismo negocio de cafetería/tienda, tal como señala la Fase 2 ("Migao y Con Sentido comparten el catálogo de productos cuando corresponda").
- **`ventas` es compartida entre Con Sentido y Migao**: una venta directa de mostrador y el cierre de una orden de mesa usan la misma tabla (`ventas.orden_id` es nulo en el primer caso). Esto simplifica reportes generales de ventas por periodo/producto/mesero sin tener que unir dos tablas distintas.
- **`facturas` acepta tres orígenes** (`venta_id`, `orden_id`, `pedido_id`) con un `CHECK` que exige al menos uno, para que el módulo general emita comprobantes desde cualquier área con una sola tabla.
- **Auditoría desacoplada**: `auditoria` no tiene FKs rígidas a cada entidad de negocio (usa `entidad` + `entidad_id` como texto) para no tener que alterar su esquema cada vez que se agregue una tabla nueva.
- **Alertas de stock mínimo**: se derivan comparando `inventario_insumos.cantidad_actual` / `inventario_productos.cantidad_actual` contra `stock_minimo`; la tabla `alertas` almacena el evento generado, no la regla.

## Escalabilidad
- Tablas de alto volumen (`movimientos_insumo`, `auditoria`, `venta_items`, `orden_items`) usan `BIGSERIAL` e índices sobre las columnas de consulta frecuente (fecha, entidad de referencia).
- `auditoria` está documentada para particionarse por rango mensual de `created_at` cuando el volumen lo justifique, sin cambiar el modelo lógico.
- Separación de `insumos` (materia prima) vs. `productos` (terminado) permite que Insumos crezca de proveedor único a multi-almacén (`almacenes`, `inventario_insumos` ya soportan varios almacenes por insumo) sin romper el resto del sistema.
- El acceso por módulo (`usuarios_modulos`) permite roles compuestos (ej. un supervisor que ve Migao y Pedidos) sin crear un rol nuevo por cada combinación.

## Diagrama lógico (texto)
```
usuarios ──┬─< auditoria
           ├─< alertas
           ├─< movimientos_insumo
           └─< (responsable/mesero/cajero en cada módulo)

clientes ──┬─< reservas (Talleres)
           ├─< ventas (Con Sentido / Migao)
           ├─< ordenes (Migao)
           └─< pedidos (Encargos)

insumos ──< inventario_insumos (por almacén)
insumos ──< movimientos_insumo >── modulos (origen) + referencia_entidad/id (Talleres/Migao/Pedidos)

actividades ─< reservas ─< asistentes
actividades ─< actividad_materiales >── insumos
actividades ─< actividad_cierres

productos ─< inventario_productos
productos ─< promociones
productos ─< venta_items >── ventas
productos ─< orden_items >── ordenes ─< pagos / facturas
ventas ─< pagos / facturas

pedidos ─< pedido_items >── insumos / productos
pedidos ─< pedido_abonos
pedidos ─< pedido_historial
pedidos ─< facturas
```

## Archivo de esquema
El DDL completo y ejecutable está en [`database/schema.sql`](database/schema.sql). Incluye extensión `pgcrypto`, función/trigger `set_updated_at()`, todas las tablas con sus índices y constraints, y el seed mínimo de `modulos`.

## Criterios cumplidos para avanzar a Fase 4
- Todas las entidades de la Fase 2 tienen tabla y campos definidos.
- Relaciones entre módulos resueltas mediante entidades compartidas (`usuarios`, `clientes`, `insumos`) en vez de duplicación.
- Reglas de negocio base (multiusuario, roles y permisos por módulo, inventario unificado y trazable, auditoría) reflejadas en el esquema.
- Esquema ejecutable en PostgreSQL sin dependencias externas.

## Próxima tarea
Definir la arquitectura técnica (Fase 4): estructura de carpetas del backend (Node/Express), capa de acceso a datos, autenticación JWT + refresh tokens, convenciones de API REST por módulo, y estrategia de despliegue (Vercel/Render/Supabase) descritas en el checkpoint.

### CHECKPOINT
Versión: 0.4
Fecha: 2026-07-09

#### Proyecto
Plataforma ERP/POS/inventario para microempresa con cinco áreas de negocio; diseño funcional y modelo de base de datos completos, aún sin backend/frontend implementados.

#### Módulos terminados
- [x] Levantamiento de requisitos inicial
- [x] Definición del MVP
- [x] Diseño funcional
- [x] Diseño de base de datos

#### Módulos en proceso
- [ ] Arquitectura técnica

#### Módulos pendientes
- [ ] Desarrollo
- [ ] Testing
- [ ] Despliegue

#### Tablas diseñadas
modulos, roles, permisos, roles_permisos, usuarios, usuarios_modulos, auditoria, alertas, clientes, categorias_insumo, proveedores, almacenes, insumos, inventario_insumos, movimientos_insumo, actividades, reservas, asistentes, actividad_materiales, actividad_cierres, categorias_producto, productos, inventario_productos, promociones, ventas, venta_items, zonas, mesas, ordenes, orden_items, pagos, facturas, pedidos, pedido_items, pedido_abonos, pedido_historial (35 tablas)

#### Relaciones definidas
- usuarios ↔ roles ↔ permisos (RBAC por módulo)
- clientes compartido entre Talleres, Con Sentido, Migao y Pedidos
- insumos ↔ movimientos_insumo como tabla puente de consumo entre todos los módulos
- productos y ventas compartidos entre Con Sentido y Migao
- facturas con origen polimórfico (venta, orden o pedido)

#### APIs definidas
- ninguna aún (corresponde a Fase 4)

#### Decisiones importantes
- Inventario de insumos unificado con trazabilidad vía `movimientos_insumo`.
- Catálogo de productos y tabla de ventas compartidos entre Con Sentido y Migao.
- Estados de negocio validados con CHECK en vez de ENUM nativo, para extensibilidad sin migraciones de tipo.
- Auditoría desacoplada de entidades específicas para no requerir cambios de esquema al añadir módulos.

#### Próxima tarea
La siguiente IA debe avanzar a la Fase 4 y definir la arquitectura técnica: estructura de proyecto backend/frontend, capa de acceso a datos, autenticación JWT + refresh tokens, convenciones de API REST por módulo y detalles de despliegue.
