# Fase 4 - Arquitectura Técnica

## Objetivo
Definir cómo se construye el sistema sobre el modelo de datos de la Fase 3: organización del código, capas, autenticación, convenciones de API, y la estrategia técnica para que la plataforma sea instalable como PWA y responsive por rol. Esta fase prepara el terreno para que la Fase 5 (Desarrollo) empiece a escribir código sin decisiones estructurales pendientes.

## Estilo general
- **Monorepo** con dos paquetes: `backend/` y `frontend/`, más `database/` (ya existente con `schema.sql`).
- Backend: Node.js + Express + TypeScript, arquitectura en capas por módulo de negocio.
- Frontend: React + TypeScript + Vite, PWA instalable, responsive y con navegación adaptada por rol.
- Comunicación exclusivamente vía API REST versionada (`/api/v1/...`); no server-side rendering en esta fase.

## Backend

### Estructura de carpetas
```
backend/
  src/
    modules/
      insumos/
        insumos.routes.ts
        insumos.controller.ts
        insumos.service.ts
        insumos.repository.ts
        insumos.schema.ts       (validación con zod)
      talleres/
      con-sentido/
      migao/
      pedidos/
      general/                  (usuarios, roles, permisos, auditoría, alertas)
    shared/
      middlewares/
        auth.middleware.ts       (verifica JWT)
        rbac.middleware.ts       (verifica permiso por módulo/acción)
        audit.middleware.ts      (escribe en auditoria)
        error-handler.ts
      db/
        pool.ts                  (pg Pool)
        transaction.ts
      utils/
    app.ts
    server.ts
  package.json
  tsconfig.json
```

### Capas por módulo
`routes → controller → service → repository → PostgreSQL`
- **routes**: define endpoints y aplica `auth.middleware` + `rbac.middleware`.
- **controller**: valida input (zod) y traduce HTTP ↔ dominio.
- **service**: reglas de negocio (ej. descontar stock, calcular rentabilidad de un cierre de taller).
- **repository**: única capa que toca SQL directo (queries parametrizadas contra `pg`), un repository por tabla o agregado (ej. `pedidos.repository.ts` cubre `pedidos` + `pedido_items` + `pedido_abonos`).

Ningún módulo accede a las tablas de otro módulo directamente por SQL: si Migao necesita descontar insumos, llama al `service` de Insumos (`registrarMovimiento(...)`), reflejando en código la misma tabla puente (`movimientos_insumo`) que ya conecta los módulos en el esquema.

### Autenticación y autorización
- Login: `POST /api/v1/auth/login` → valida credenciales, devuelve `access_token` (JWT, 15 min) + `refresh_token` (httpOnly cookie). La sesión tiene un **tope absoluto de 10 horas desde el login** (`REFRESH_TOKEN_TTL_HOURS`): el refresh token guarda el timestamp del login original (`loginAt`) y cada renovación preserva ese valor en vez de reiniciarlo, así que la sesión se cierra a las 10 horas exactas sin importar cuánta actividad haya. Revocación por dispositivo antes de ese plazo queda pendiente para una tabla `refresh_tokens` si se requiere en el futuro.
- `POST /api/v1/auth/refresh` → rota el refresh token y emite un nuevo access token.
- `POST /api/v1/auth/logout` → invalida el refresh token activo.
- `auth.middleware` decodifica el JWT y adjunta `usuario_id`, `rol_id`, y módulos permitidos (`usuarios_modulos`) al `request`.
- `rbac.middleware` compara la acción solicitada contra `permisos`/`roles_permisos` ya definidos en el esquema — no hay lista de permisos hardcodeada en el backend, se consulta la tabla.

### Convenciones API REST
- Prefijo `/api/v1/{modulo}` (ej. `/api/v1/insumos`, `/api/v1/migao/ordenes`, `/api/v1/pedidos`).
- Respuesta estándar: `{ data, error, meta }` (meta para paginación).
- Errores: código HTTP correcto + `{ error: { code, message } }`, capturados centralmente en `error-handler.ts`.
- Paginación por cursor en listados de alto volumen (`movimientos_insumo`, `auditoria`, `ventas`).
- Cada escritura relevante dispara un registro en `auditoria` vía `audit.middleware` (acción, entidad, entidad_id, usuario_id).

## Frontend

### Estructura de carpetas
```
frontend/
  src/
    modules/
      insumos/  talleres/  con-sentido/  migao/  pedidos/  general/
        pages/
        components/
        hooks/
        api.ts                 (llamadas al backend del módulo)
    shared/
      layout/
        AppShell.tsx            (navegación adaptada por rol)
        RoleNav.tsx
      components/                (design system: botones, tablas, cards, stat tiles)
      auth/
        AuthProvider.tsx
        useAuth.ts
      pwa/
        registerSW.ts
    App.tsx
    main.tsx
  public/
    manifest.webmanifest
    icons/
  vite.config.ts
  package.json
```

### PWA (instalable en mobile)
- Plugin: `vite-plugin-pwa` (genera service worker con Workbox, sin mantener SW a mano).
- `manifest.webmanifest`: `name`, `short_name`, `theme_color`, `background_color`, `display: "standalone"`, `start_url: "/"`, set de íconos 192/512 (+ maskable).
- Estrategia de cache:
  - App shell (JS/CSS/HTML): `precache` (Workbox `generateSW`).
  - Datos de solo lectura frecuentes (catálogo de productos, insumos, mesas): `stale-while-revalidate`.
  - Escrituras (ventas, pedidos, movimientos): siempre `network-only`; sin cola offline en el MVP para no arriesgar inconsistencias de inventario — se documenta como mejora futura si el negocio lo requiere.
- Instalable en Android/iOS desde el navegador (`Agregar a pantalla de inicio`), sin pasar por App Store/Play Store.

### Responsive y UI por rol
- **Mobile-first**: breakpoints base (`sm 480px`, `md 768px`, `lg 1024px`, `xl 1280px`) con Tailwind CSS (o CSS modules + tokens si se prefiere evitar una dependencia más; a decidir al iniciar Fase 5).
- **Navegación condicionada por rol**, no solo por permiso de acceso: el layout prioriza lo que cada rol usa más.
  - Mesero / Cajero (Migao): layout mobile/tablet primero — mapa de mesas y toma de pedidos optimizados para pantalla táctil, dashboard general oculto.
  - Cocina (Migao): vista de cola de pedidos en tablet, tipografía grande, sin navegación a otros módulos.
  - Coordinador de reservas (Talleres): calendario adaptado a mobile (vista agenda) y a desktop (vista mensual).
  - Encargado de inventario (Insumos): tablas densas, pensadas primero para desktop/tablet, con vista simplificada mobile para registrar una salida rápida.
  - Super Root: dashboard general y reportes, layout desktop-first con vista mobile de solo lectura (KPIs) para consulta rápida.
- Un mismo componente de `AppShell` lee el rol activo y decide: qué items de menú mostrar, qué vista por defecto abrir al iniciar sesión, y si el layout prioriza tablas (desktop) o tarjetas/acciones grandes (mobile).

## Despliegue y entornos
- Variables de entorno separadas por entorno (`.env.development`, `.env.production`), nunca commiteadas.
- Backend en Render/Railway con build a partir de `backend/`; frontend en Vercel con build de `frontend/` (Vite build ya genera el service worker y manifest).
- CI (GitHub Actions): lint + typecheck + tests en cada PR; deploy automático a producción solo desde `main`.
- Base de datos: Supabase Postgres, migraciones versionadas (herramienta a elegir en Fase 5, ej. `node-pg-migrate` o `drizzle-kit`, partiendo de `database/schema.sql` como línea base).

## Criterios cumplidos para avanzar a Fase 5
- Estructura de carpetas backend/frontend definida y alineada a los módulos de la Fase 2/3.
- Flujo de autenticación JWT + refresh token especificado.
- Convenciones de API REST y capa de acceso a datos definidas.
- Estrategia PWA (manifest + service worker + cache) definida.
- Estrategia responsive y de navegación diferenciada por rol definida.

## Próxima tarea
Iniciar Fase 5 (Desarrollo): scaffolding real de `backend/` y `frontend/`, elegir librería de estilos (Tailwind vs. CSS modules), implementar auth end-to-end, y construir el primer módulo completo (recomendado: Insumos, por ser la base del inventario que todos los demás consumen).

### CHECKPOINT
Versión: 0.5
Fecha: 2026-07-09

#### Proyecto
Plataforma ERP/POS/inventario para microempresa con cinco áreas de negocio; diseño funcional, modelo de datos y arquitectura técnica completos. Sin código de aplicación todavía (solo `database/schema.sql`).

#### Módulos terminados
- [x] Levantamiento de requisitos inicial
- [x] Definición del MVP
- [x] Diseño funcional
- [x] Diseño de base de datos
- [x] Arquitectura técnica

#### Módulos en proceso
- [ ] Desarrollo

#### Módulos pendientes
- [ ] Testing
- [ ] Despliegue

#### Decisiones importantes
- Monorepo con `backend/` (Express en capas por módulo) y `frontend/` (React + Vite).
- JWT de acceso corto + refresh token en cookie httpOnly.
- RBAC consultado en runtime contra `permisos`/`roles_permisos`, no hardcodeado.
- PWA vía `vite-plugin-pwa`, cache stale-while-revalidate para lecturas, network-only para escrituras.
- UI mobile-first con navegación y layout por defecto distintos según el rol activo (mesero/cajero mobile, Super Root desktop-first).

#### Próxima tarea
La siguiente IA debe iniciar la Fase 5 (Desarrollo): crear el scaffolding de `backend/` y `frontend/` según esta arquitectura, implementar autenticación end-to-end, y construir el módulo de Insumos como primer módulo completo.
