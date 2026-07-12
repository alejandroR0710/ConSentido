# Fase 1 - Levantamiento de requisitos

## Resumen ejecutivo
Se define un MVP inicial compuesto por cinco módulos operativos más uno general, con un rol de control total y subusuarios por área.

## Alcance aprobado del MVP
### Módulos principales
1. Insumos
2. Talleres / Experiencias
3. Con Sentido
4. Migao (POS / Cafetería)
5. Pedidos / Encargos
6. Módulo general transversal

### Módulo general transversal
Incluye:
- autenticación y usuarios
- roles y permisos
- dashboard general
- reportes generales
- auditoría
- alertas
- exportación PDF y Excel

## Roles definidos
### Super Root
- acceso total al sistema
- administración de usuarios y permisos
- configuración general
- supervisión global de módulos
- administración de catálogos, inventario y reportes

### Subusuarios por área
- Insumos: administrador de insumos, encargado de inventario
- Talleres: administrador de talleres, coordinador de reservas
- Con Sentido: administrador de catálogo y ventas, operador de inventario
- Migao: administrador de POS, supervisor, cajero, cocina, mesero
- Pedidos: administrador de encargos, seguimiento de pedidos

## Requisitos funcionales base
### 1. Insumos
- manejo de inventario
- entradas y salidas
- stock mínimo y alertas
- historial de movimientos
- consumo por otras áreas

### 2. Talleres / Experiencias
- calendario
- reservas y agendamiento
- formulario de inicio y cierre
- control de asistentes
- control de materiales consumidos
- costos y rentabilidad por actividad

### 3. Con Sentido
- catálogo de productos
- inventario
- ventas
- reportes de producto y rentabilidad

### 4. Migao (POS)
- toma de pedidos
- cobro y facturación
- mapa visual de mesas
- estados de mesa
- historial de pedidos
- ventas por mesero, día y producto

### 5. Pedidos / Encargos
- clientes
- pedidos
- abonos y pagos
- seguimiento de estado y fecha de entrega
- historial

### 6. Módulo general
- dashboard general
- reportes y exportaciones
- seguridad y auditoría
- alertas y trazabilidad

## Reglas de negocio iniciales
- el sistema debe ser multiusuario
- cada acción debe quedar registrada
- los permisos deben ser por rol y por módulo
- el inventario debe ser unificado y trazable
- los pedidos y ventas deben tener estado y seguimiento
- se deben generar reportes por área, periodo y producto

## Entregables de esta fase
- alcance del MVP documentado
- roles y permisos iniciales definidos
- módulos principales identificados
- lineamientos para avanzar a la Fase 2

## Próximo paso recomendado
Diseñar la arquitectura funcional de cada módulo y los flujos principales de usuario para pasar a la Fase 2.

### CHECKPOINT
Versión: 0.2
Fecha: 2026-07-07

#### Proyecto
MVP inicial definido con cinco módulos operativos más uno general, roles jerárquicos y alcance orientado a negocio real.

#### Arquitectura definida

- Frontend: React + TypeScript
- Backend: Node.js + Express
- Base de datos: PostgreSQL
- Autenticación: JWT + Refresh Tokens
- Infraestructura:
  - Frontend: Vercel
  - Backend: Render o Railway
  - Base de Datos: PostgreSQL (Supabase)
  - Almacenamiento de archivos: Supabase Storage
  - CDN: Cloudflare
  - DNS: Cloudflare
  - Control de versiones: Git + GitHub
  - CI/CD: GitHub Actions
  - Monitoreo: UptimeRobot
  - Backups: Automáticos diarios PostgreSQL
  - SSL: Certificados automáticos Let's Encrypt


#### Módulos terminados
- [x] Levantamiento de requisitos inicial
- [x] Definición del MVP

#### Módulos en proceso
- [ ] Diseño funcional
- [ ] Diseño de base de datos

#### Módulos pendientes
- [ ] Arquitectura técnica
- [ ] Desarrollo

#### Tablas diseñadas
- ninguna aún

#### Relaciones definidas
- ninguna aún

#### APIs definidas
- ninguna aún

#### Decisiones importantes
- el MVP incluirá 5 módulos operativos + 1 módulo general
- se define un rol Super Root y subusuarios por área
- las etapas del proyecto quedan establecidas para continuidad

#### Próxima tarea
La siguiente IA debe avanzar a la Fase 2 y documentar los módulos, submódulos, casos de uso y flujos principales para cada área.
