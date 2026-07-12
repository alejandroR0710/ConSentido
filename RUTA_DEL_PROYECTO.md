# Ruta del Proyecto

Este documento centraliza la hoja de ruta, el avance de fases y los checkpoints del proyecto ERP + POS + Inventario + Producción + Ventas + Facturación.

## Objetivo
Mantener un registro ordenado de:
- fases del proyecto
- actividades realizadas
- decisiones
- riesgos
- próximos pasos
- checkpoints de continuidad

## Fases del proyecto
1. Fase 1 - Levantamiento de requisitos
2. Fase 2 - Diseño funcional
3. Fase 3 - Diseño de Base de Datos
4. Fase 4 - Arquitectura Técnica
5. Fase 5 - Desarrollo
6. Fase 6 - Testing
7. Fase 7 - Despliegue

## Estado actual
- Fecha: 2026-07-12
- Fase activa: Fase 5 - Desarrollo (en curso)
- Workspace: documentación de Fases 1-4, esquema SQL en `database/schema.sql` + `database/seed.sql`, y código funcional en `backend/` (Express+TS) y `frontend/` (React+Vite PWA) verificado contra PostgreSQL 16 real
- Entorno local: backend y frontend están **encendidos** (el usuario los está usando en vivo, incluso desde el celular por la red Wi-Fi local); la base de datos `sistemapos` tiene el esquema al día (incluye `imagen_url`/`descripcion` en `productos`/`insumos`, `numero_personas` en `ordenes`, `piso` en `mesas`, 5 usuarios Mesero). Hay un turno de Caja real abierto con movimientos reales del usuario.

## Documentación de avance
### Fase 1 - Levantamiento de requisitos
- Estado: Consolidado
- Avance: Se definieron el alcance del MVP, los roles iniciales y los módulos prioritarios.
- Objetivo: comprender el negocio, los usuarios, los procesos y las reglas operativas de cada área.

### Fase 2 - Diseño funcional
- Estado: Consolidado
- Avance: Módulos y submódulos definidos, casos de uso y flujos operativos documentados.
- Objetivo: preparar el diseño funcional antes de pasar a la base de datos.

### Fase 3 - Diseño de Base de Datos
- Estado: Consolidado
- Avance: 35 tablas normalizadas y conectadas mediante un núcleo transversal (usuarios, clientes, insumos/movimientos). Esquema ejecutable en `database/schema.sql`. Detalle completo en `FASE3_DISENO_BASE_DE_DATOS.md`.
- Objetivo: modelar entidades, relaciones e índices antes de iniciar la arquitectura técnica y el desarrollo.

### Fase 4 - Arquitectura Técnica
- Estado: Consolidado
- Avance: estructura de carpetas backend/frontend, capas por módulo, autenticación JWT+refresh, convenciones de API REST, estrategia PWA (manifest + service worker) y estrategia responsive/navegación por rol. Detalle completo en `FASE4_ARQUITECTURA_TECNICA.md`.
- Objetivo: dejar todas las decisiones estructurales resueltas antes de escribir código de aplicación.

### Fase 5 - Desarrollo
- Estado: En curso
- Avance: backend (Express+TS) y frontend (React+Vite+PWA) verificados end-to-end contra PostgreSQL 16 real (`database/seed.sql` siembra roles/permisos/usuarios de Super Root, Cajero, Cocina, Mesero y Administrador). Auth completo, módulo Insumos de punta a punta (con UI, edición/desactivación/foto/descripción), Caja General completo full-stack (turnos diarios, cuentas efectivo/banco + total general, ingresos/egresos y cierre en popups, reset a $0 sin perder historial exclusivo de Super Root, historial anual en grilla tipo calendario para Cajero), y Migao completo por rol: **Mesero** arma el pedido entero (mesa + piso + personas opcional + productos) antes de crear nada, edita después, ve historial legible y recibe notificación con sonido; **Cocina** prepara por orden completa con check individual por producto; **Cajero** cobra y cierra la mesa (exclusivo); **Administrador** gestiona el Menú de Migao (con categorías) e Insumos (crear, editar, desactivar/reactivar, foto, descripción opcional) sin acceso a órdenes/cobros/cocina. El menú real del negocio (28 productos, 5 categorías) ya está cargado. Precios formateados con símbolo `$` y separador de miles en toda la app. Todo el frontend de Mesero/Cocina/Caja fue rediseñado a popups y vistas propias para agilizar el trabajo. Colores de marca (verde oscuro + blanco vainilla) aplicados en el tema visual y el manifest PWA. Detalle en `FASE5_DESARROLLO.md`.
- Objetivo: construir un mapa visual de mesas para Migao, y completar los módulos restantes (Talleres, Con Sentido, Pedidos) siguiendo el mismo patrón de capas.

#### Decisiones tomadas en esta etapa
- MVP inicial compuesto por 5 módulos operativos + 1 módulo general transversal.
- Roles iniciales definidos con un Super Root y subusuarios por área.
- Se establecen etapas claras para el desarrollo del proyecto.

#### Módulos del MVP
1. Insumos
2. Talleres / Experiencias
3. Con Sentido
4. Migao (POS / Cafetería)
5. Pedidos / Encargos
6. Módulo general transversal

#### Roles definidos
- Super Root: acceso total, administración de usuarios, configuración general y supervisión global.
- Insumos: administrador de insumos y encargado de inventario.
- Talleres: administrador de talleres y coordinador de reservas.
- Con Sentido: administrador de catálogo y ventas y operador de inventario.
- Migao: administrador de POS, supervisor, cajero, cocina y mesero.
- Pedidos: administrador de encargos y responsable de seguimiento.
- **Cajero (transversal)**: no queda limitado a Migao — centraliza los pagos que vienen de cualquier módulo (Migao, Con Sentido, Insumos, etc.) en una Caja General organizada por turnos diarios, y puede registrar retiros de esa caja para gastos internos (categorizados). Además, en Migao es el **único** rol que puede cerrar una mesa/orden y cobrarla (mesero/cocina/supervisor no tienen ese permiso); al cerrar, ve el detalle de la orden con cada línea y el total antes de cobrar. Ver `FASE5_DESARROLLO.md` (módulos `caja` y `migao`) para el detalle de implementación.

#### Requisitos base registrados
- multiusuario
- roles y permisos
- dashboard general y por módulo
- inventario unificado
- facturación y reportes
- alertas, auditoría y trazabilidad
- plataforma instalable como PWA en mobile (Android/iOS) sin pasar por tiendas de apps
- UI responsive, con layout y prioridades de pantalla adaptados a cada rol (ej. mesero/cajero en mobile, Super Root en desktop)

## Checkpoint
### CHECKPOINT
Versión: 0.15
Fecha: 2026-07-12

#### Proyecto
Plataforma ERP/POS/inventario para microempresa con cinco áreas de negocio; diseño, modelo de datos y arquitectura completos. Marca visible renombrada a "Con Sentido / El Rinconcito del Migao" (SIsteMAPOS queda como nombre interno del repo). Backend Express+TS y frontend React+Vite PWA verificados end-to-end contra PostgreSQL 16 real: Auth completo, módulo Insumos de punta a punta (con UI, edición/desactivación/foto/descripción), Caja General full-stack (reset a $0 no-destructivo para Super Root, historial anual en calendario para Cajero, proyección de apertura de turno visible antes de confirmar, base inicial vs saldo en vivo mostrados por separado), y Migao con las cuatro pantallas por rol (Mesero, Cocina, Cajero, Administrador) completas y probadas, con categorías de menú, descripciones opcionales, piso/personas por mesa, precios formateados (inputs de dinero con separador de miles en vez de `<input type="number">`), menú real cargado (28 productos), cancelación de orden completa, registro de órdenes cobradas/canceladas + ingresos manuales de Migao separado de las activas (Cajero), reset destructivo de historial de órdenes (Super Root), historial de pedidos despachados (Cocina), "mi historial" acotado por mesero (Mesero, 5 usuarios ahora), y el mesero que creó cada orden visible en todas las vistas. Ambos servidores están encendidos, en uso real. Detalle en `FASE5_DESARROLLO.md`.

#### Identidad visual
- Colores de marca: verde oscuro (`#1F4A34` primario, `#14291F` fondo oscuro) y blanco vainilla (`#FBF3E1`), ambientación de naturaleza. Aplicados como tokens Tailwind (`frontend/src/index.css`) y en el manifest PWA (`theme_color`/`background_color`).

#### Arquitectura definida
- Frontend: React + TypeScript
- Frontend instalable como PWA (service worker vía `vite-plugin-pwa`, manifest.webmanifest) para uso desde mobile sin tienda de apps
- UI responsive con diseño mobile-first; cada rol tiene su propia vista/prioridad de pantalla (ej. mesero y cajero optimizados para mobile/tablet, Super Root y reportes optimizados para desktop)
- Backend: Node.js + Express, en capas por módulo (routes → controller → service → repository)
- Base de datos: PostgreSQL
- Autenticación: JWT (access 15 min) + Refresh Tokens (cookie httpOnly)
- RBAC consultado en runtime contra `permisos`/`roles_permisos`
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
- [x] Diseño funcional
- [x] Diseño de base de datos
- [x] Arquitectura técnica

#### Módulos en proceso
- [ ] Desarrollo — Auth, Insumos (full-stack + foto), Caja General (full-stack) y Migao (Mesero/Cocina/Cajero/Administrador, full-stack + foto de producto) verificados contra Postgres real; falta mapa visual de mesas, Talleres, Con Sentido y Pedidos.

#### Módulos pendientes
- [ ] Testing
- [ ] Despliegue

#### Tablas diseñadas
41 tablas: 35 del diseño original + `categorias_gasto`, `turnos_caja`, `movimientos_caja` (Caja General) + `orden_historial` (historial de Migao), más columnas nuevas: `ordenes.comensal_numero` (autonumerado por secuencia), `ordenes.numero_personas` (opcional), `mesas.piso` (índice único ahora es `numero+piso`), `orden_items.listo_cocina` (check de cocina), e `imagen_url`/`descripcion` en `productos`/`insumos` (foto vía upload local + descripción opcional colapsable). Detalle completo en `FASE3_DISENO_BASE_DE_DATOS.md` y DDL en `database/schema.sql` + `database/seed.sql`.

#### Relaciones definidas
- usuarios ↔ roles ↔ permisos (RBAC por módulo)
- clientes compartido entre Talleres, Con Sentido, Migao y Pedidos
- insumos ↔ movimientos_insumo como tabla puente de consumo entre todos los módulos
- productos y ventas compartidos entre Con Sentido y Migao
- facturas con origen polimórfico (venta, orden o pedido)
- movimientos_caja ↔ modulos como tabla puente de ingresos desde cualquier módulo hacia Caja General
- orden_historial ↔ orden_items como bitácora de cambios por orden (altas, ediciones, cancelaciones, entregas)

#### APIs definidas
- `POST/GET /api/v1/auth/{login,refresh,logout,me}` (implementados)
- `GET/POST/PATCH /api/v1/insumos`, `GET /api/v1/insumos/admin`, `POST /api/v1/insumos/:id/imagen`, `GET /api/v1/insumos/almacenes`, `POST /api/v1/insumos/movimientos` (implementados)
- `GET/POST/PATCH /api/v1/caja/*` (turnos, ingresos, egresos, categorías de gasto), `GET /caja/historial?anio=` (resumen diario del año), `POST /caja/reset` (exclusivo Super Root, no borra historial) (implementados, con UI)
- Migao completo: `POST /migao/ordenes` (orden+ítems atómico, incluye piso/numeroPersonas), `GET /migao/ordenes`, `GET /migao/ordenes/historial` (cobradas/canceladas con fecha de cierre), `GET /migao/ordenes/:id` (con historial), `PATCH /migao/items/:id` (editar/cancelar), `PATCH /migao/items/:id/entregar`, `POST /migao/ordenes/:id/cerrar` (cajero exclusivo), `POST /migao/ordenes/:id/cancelar` (cajero exclusivo), `POST /migao/ordenes/reset` (exclusivo Super Root, sí borra todo), `POST /migao/ordenes/:id/empezar-preparar`, `PATCH /migao/items/:id/check`, `POST /migao/ordenes/:id/marcar-listo`, `GET /migao/cocina/items`, `GET /migao/items/activos`, `GET /migao/productos`, `GET /migao/productos/admin`, `POST /migao/productos`, `PATCH /migao/productos/:id`, `POST /migao/productos/:id/imagen`, `GET/POST /migao/categorias`, `GET /migao/mesas`
- Archivos estáticos: `express.static("/uploads")` sirve las fotos subidas por multer (`backend/uploads/{productos,insumos}/`)
- Talleres, Con Sentido y Pedidos: convenciones definidas, endpoints aún no implementados

#### Decisiones importantes
- el MVP incluirá 5 módulos operativos + 1 módulo general
- se define un rol Super Root y subusuarios por área
- las etapas del proyecto quedan establecidas para continuidad
- inventario de insumos unificado y trazable vía `movimientos_insumo`
- catálogo de productos y ventas compartidos entre Con Sentido y Migao
- estados de negocio validados con CHECK en vez de ENUM nativo para extensibilidad
- monorepo `backend/` + `frontend/`; PWA con cache stale-while-revalidate en lecturas y network-only en escrituras
- navegación y layout del frontend cambian según el rol activo, no solo los permisos
- colores de marca verde oscuro + blanco vainilla aplicados en el tema visual y el manifest PWA
- access token JWT en memoria (no localStorage); refresh token en cookie httpOnly
- movimientos de inventario y su impacto en stock se resuelven en una sola transacción con `FOR UPDATE` para evitar condiciones de carrera entre módulos
- Caja General: un único turno abierto para todo el negocio (no por cajero), saldos heredados del cierre anterior, dos cuentas independientes (efectivo/banco) + total general, egresos sin aprobación previa (auditados)
- Migao — cerrar una mesa/orden es exclusivo del rol Cajero; venta + pago + ingreso en Caja + cierre de orden ocurren en una sola transacción
- Migao — Cocina: "preparando" es de la orden completa, no por producto; check individual por producto; "marcar lista" bloqueado (backend y frontend) hasta que todo esté empezado y checkeado
- Migao — Mesero: la orden no se crea hasta que el mesero termina de armarla (mesa + productos); creación atómica de orden+ítems; editar cantidad resetea el ítem a pendiente y le quita el check de cocina
- Roles seed: Super Root (todo), Cajero, Cocina, Mesero, Administrador — cada uno con permisos acotados exactamente a lo que su rol debe hacer
- Administrador gestiona el catálogo (Menú de Migao + Insumos) vía soft-delete (`activo:false`, nunca borrado físico) y puede subir/cambiar foto de cada producto/insumo
- Fotos de producto/insumo: almacenamiento en disco local vía multer + `express.static`, ambos anclados a `process.cwd()` (no `__dirname`) para que uploader y servidor estático siempre resuelvan la misma carpeta `uploads/` sin importar si el proceso corre desde `src/` (tsx) o `dist/` (build); migrar a Supabase Storage antes de producción (disco efímero en varios hosting)
- Categorías de menú (`categorias_producto`) reutilizadas para Migao: alta rápida desde los modales de producto, igual que las categorías de gasto en Caja
- Precios formateados de forma consistente en toda la app: símbolo `$` + separador de miles con punto (`shared/format/money.ts`), sin decimales
- Descripción opcional y colapsable (`<details>`) para productos e insumos, sin estado de React adicional
- Reset de Caja para Super Root es **no-destructivo por diseño**: reutiliza el mecanismo de herencia de saldo (turno nuevo hereda del último cerrado) insertando un "turno marcador" en cero, en vez de borrar turnos/movimientos — así el historial de Caja queda intacto para los reportes
- Borrado de datos: se distingue entre soft-delete (`activo:false`, el patrón por defecto para catálogo) y borrado físico total (solo cuando el usuario lo pide explícitamente y entiende las consecuencias, ej. los 3 productos de prueba con ventas reales asociadas)

#### Próxima tarea
La siguiente IA debe: (1) construir un mapa visual de mesas para Migao, (2) replicar el patrón de capas de Migao/Insumos para Talleres, Con Sentido y Pedidos, y (3) definir estrategia de tests antes de que el proyecto siga creciendo.
