# Fase 2 - Diseño funcional

## Objetivo
Definir la estructura funcional del sistema para cada módulo del MVP, incluyendo módulos, submódulos, casos de uso y flujos operativos. Esta fase prepara el diseño antes de tocar la base de datos o el código.

## Alcance
- Documentar los cinco módulos operativos del MVP.
- Definir el módulo general transversal.
- Identificar submódulos, pantallas y procesos clave.
- Establecer flujos de usuario y relaciones entre módulos.
- Preparar insumos para el diseño de base de datos en la Fase 3.

## Módulos y submódulos

### 1. Insumos
Submódulos:
- Catálogo de materias primas
- Inventario y ubicaciones
- Movimientos (entradas/salidas)
- Alertas de stock mínimo
- Consumo interno y transferencias
- Historial y auditoría

### 2. Talleres / Experiencias
Submódulos:
- Gestión de actividades
- Calendario y agenda
- Reservas y asistentes
- Formularios de inicio y cierre
- Control de materiales y costos
- Reportes de rentabilidad

### 3. Con Sentido
Submódulos:
- Catálogo de productos
- Gestión de inventario de productos
- Ventas y pedidos
- Precios y promociones
- Reportes de producto y rentabilidad

### 4. Migao (POS / Cafetería)
Submódulos:
- Gestión de mesas y salones
- Toma de pedidos
- Cocina y preparación
- Cobro y facturación
- Historial de pedidos
- Analítica de ventas por mesero/producto/periodo

### 5. Pedidos / Encargos
Submódulos:
- Registro de clientes
- Creación de pedidos personalizados
- Gestión de abonos y pagos
- Seguimiento de estado y fechas de entrega
- Historial de pedidos y entregas

### 6. Módulo general transversal
Submódulos:
- Autenticación y gestión de usuarios
- Roles y permisos
- Dashboard general
- Dashboards por módulo
- Reportes generales
- Alertas y notificaciones
- Exportaciones PDF/Excel
- Auditoría y trazabilidad

## Casos de uso principales

### Usuarios y seguridad
- Iniciar sesión con rol asignado.
- Super Root gestiona usuarios, roles y permisos.
- Cada usuario accede solo a los módulos permitidos.
- Registro de acciones importantes para auditoría.

### Insumos
- Crear y actualizar materias primas.
- Registrar entrada de insumo con proveedor y cantidad.
- Registrar salida de insumo por consumo interno o venta.
- Generar alerta cuando un insumo está por debajo del mínimo.
- Consultar historial de movimientos por producto, fecha y área.
- Transferir stock entre áreas o almacenes.

### Talleres / Experiencias
- Crear una nueva actividad con fecha, capacidad, materiales y costo.
- Registrar reserva de plaza y datos del asistente.
- Abrir un formulario de inicio para una experiencia programada.
- Cerrar la actividad con soporte de materiales consumidos y cierre de ingresos.
- Consultar rentabilidad por actividad, costos y asistentes.

### Con Sentido
- Registrar productos en el catálogo con detalles y precios.
- Administrar el inventario de productos terminados.
- Generar ventas desde catálogo con control de stock.
- Consultar reportes de ventas y productos más rentables.
- Actualizar precios y promociones por producto.

### Migao (POS)
- Configurar mapa de mesas y zonas.
- Asignar mesa a cliente y cambiar estado de mesa.
- Tomar pedidos por mesa y enviar a cocina.
- Actualizar estado de pedido: orden tomada, preparando, servido, pagando, finalizada.
- Generar cobro y emitir factura o ticket.
- Consultar tiempos de preparación y desempeño del mesero.

### Pedidos / Encargos
- Registrar cliente para pedido personalizado.
- Crear pedido con descripción, fecha de entrega y costo estimado.
- Registrar abonos y pagos parciales.
- Actualizar estado del pedido: pendiente, en producción, listo, entregado.
- Mantener historial de entregas y pagos.

### Módulo general
- Ver dashboard con indicadores clave de todas las áreas.
- Consultar reportes por periodo, área y producto.
- Exportar reportes a PDF o Excel.
- Recibir alertas de stock, tareas y eventos próximos.
- Auditar acciones de usuarios y cambios en inventario.

## Flujos de trabajo clave

### Flujo 1: Gestión de inventario transversal
1. Un insumo se registra en el catálogo de Insumos.
2. Se ingresa stock por recepción.
3. El stock se consume desde Talleres, Con Sentido, Migao o Pedidos.
4. El sistema decrementa inventario y registra movimiento.
5. Si el stock baja del mínimo, se genera alerta.
6. Los reportes muestran consumo por área y saldo disponible.

### Flujo 2: Venta POS en Migao
1. Mesero asigna mesa y crea una orden.
2. Se capturan productos y se envía pedido a cocina.
3. Cocina actualiza estado del pedido.
4. Se cierra la orden en caja y se emite factura/ticket.
5. El inventario se ajusta automáticamente.
6. Se registra la venta en reportes de ventas y tiempos.

### Flujo 3: Reserva y cierre de taller
1. Se crea una actividad en Talleres.
2. El cliente reserva plaza y se confirma asistencia.
3. Al iniciar el taller, se abre formulario de control.
4. Se consumen materiales y se registra en inventario.
5. Al finalizar, se cierra la actividad y se genera reporte de costos.

### Flujo 4: Pedido / encargo personalizado
1. Se registra cliente y pedido con fecha de entrega.
2. Se planifica producción/recogida de materiales.
3. Se aplican abonos o pagos parciales.
4. Se actualiza estado hasta entregado.
5. Se cierra con historial de pagos y satisfacción.

## Relación entre módulos
- El inventario de Insumos alimenta a Talleres, Con Sentido, Migao y Pedidos.
- El módulo general centraliza reportes, dashboards y auditoría de todos los módulos.
- Migao y Con Sentido comparten el catálogo de productos cuando corresponda.
- Pedidos y Talleres pueden requerir el mismo inventario de materiales.

## Diagramas lógicos (conceptuales)
1. Usuario -> Autenticación -> Permisos -> Módulos.
2. Insumos -> Inventario -> Movimientos -> Alertas.
3. Migao / Con Sentido / Pedidos / Talleres -> Consumo de insumos.
4. Módulo general -> Dashboards / Reportes / Auditoría.

## Criterios para avanzar a Fase 3
- Módulos y submódulos claramente definidos.
- Casos de uso principales y flujos clave validados.
- Relación entre módulos establecida.
- Requisitos funcionales suficientes para derivar entidades y relaciones.

## Próxima tarea
- Transformar estos módulos y flujos en un modelo entidad-relación de Base de Datos.
- Identificar tablas, relaciones y catálogos necesarios.
