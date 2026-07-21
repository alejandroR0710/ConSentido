# Despliegue: Render (backend) + Vercel (frontend)

Requiere que el repo ya esté en GitHub (`alejandroR0710/ConSentido`, rama `main`) y cuentas en [render.com](https://render.com) y [vercel.com](https://vercel.com) — ambas se pueden crear gratis conectando tu cuenta de GitHub, y son pasos que tienes que hacer tú desde el navegador (no puedo crear cuentas ni hacer clic por ti).

## 1. Base de datos PostgreSQL

Usa **Supabase** (plan gratis, es el que ya estaba planeado en `FASE4_ARQUITECTURA_TECNICA.md`) o **Render Postgres**. Con cualquiera de los dos, al final tienes una `DATABASE_URL` tipo:
```
postgresql://usuario:password@host:5432/nombre_basedatos
```

Aplica el esquema y el seed **en ese orden**, conectado a esa base (con `psql` o el editor SQL de Supabase):
```
psql "TU_DATABASE_URL" -f database/schema.sql
psql "TU_DATABASE_URL" -f database/seed.sql
```

Esto crea las tablas, los roles/permisos, y los usuarios de prueba (ver tabla en `FASE5_DESARROLLO.md`).

## 2. Backend en Render

1. En Render: **New → Web Service** → conecta el repo `ConSentido`.
2. **Root Directory**: `backend`
3. **Build Command**: `npm install && npm run build`
4. **Start Command**: `npm run start`
5. Variables de entorno (Environment):
   - `DATABASE_URL` → la de tu Postgres (paso 1)
   - `JWT_ACCESS_SECRET` → genera un valor random largo (Render puede generarlo solo con "Generate")
   - `JWT_REFRESH_SECRET` → otro valor random distinto
   - `ACCESS_TOKEN_TTL` → `15m`
   - `REFRESH_TOKEN_TTL_HOURS` → `10`
   - `NODE_ENV` → `production`
   - `CORS_ORIGIN` → de momento pon `http://localhost:5173` (lo actualizas en el paso 4, cuando ya tengas la URL real del frontend)
6. Deploy. Cuando termine, copia la URL pública (algo como `https://consentido-backend.onrender.com`).

`render.yaml` en la raíz del repo ya describe este mismo servicio — si prefieres, en vez de configurarlo a mano puedes usar **New → Blueprint** en Render y apuntarlo al repo, y va a leer `render.yaml` solo (igual vas a tener que completar `DATABASE_URL` y `CORS_ORIGIN` a mano porque son secretos/variables por entorno).

## 3. Frontend en Vercel

1. En Vercel: **Add New → Project** → conecta el repo `ConSentido`.
2. **Root Directory**: `frontend`
3. Framework: Vercel detecta Vite solo.
4. Variables de entorno:
   - `VITE_API_URL` → `/api/v1` (ruta **relativa**, no la URL completa de Render — ver nota abajo)
5. Deploy. Copia la URL pública (algo como `https://consentido.vercel.app`).

`frontend/vercel.json` ya tiene las reglas de rewrite necesarias para que las rutas de React Router (`/mesero`, `/cocina`, etc.) no den 404 al refrescar la página, **y también** un rewrite de `/api/*` y `/uploads/*` hacia el backend de Render — por eso `VITE_API_URL` debe ser una ruta relativa (`/api/v1`), no la URL completa de Render: así todas las peticiones del navegador van al mismo dominio de Vercel (que las reenvía por dentro a Render), en vez de ser "cross-site". Esto es necesario para que la sesión (cookie de refresh) sobreviva en Safari/iOS — WebKit borra agresivamente las cookies `SameSite=None` de dominios distintos, sobre todo en una PWA agregada a la pantalla de inicio; con la petición viendose del mismo origen, ese problema desaparece.

## 4. Cerrar el círculo: CORS

Vuelve a Render, edita la variable `CORS_ORIGIN` del backend y ponle la URL real de Vercel del paso 3:
```
CORS_ORIGIN=https://consentido.vercel.app
```
Redeploy del backend. (El frontend en producción ya no depende de la detección automática por IP que usa en la red local — `VITE_API_URL` explícita manda siempre sobre el modo "auto". `CORS_ORIGIN` sigue haciendo falta como defensa adicional, aunque con el rewrite del paso 3 casi todo el tráfico real ya llega a Render como si fuera del propio servidor de Vercel, no del navegador directamente.)

## 5. Llevar tus usuarios y tu menú reales

`database/seed.sql` ya crea los roles/permisos y usuarios *de prueba* con las contraseñas de siempre. Si quieres llevar tus usuarios reales (con sus contraseñas actuales) y el menú real que ya armaste en local, en vez de los de prueba:

```
cd backend
npm run export:seed-produccion
```

Esto genera `database/produccion-usuarios-menu.sql` (no se sube a git — mira `.gitignore`). Aplícalo contra la base de producción, **después** de `schema.sql` + `seed.sql`:
```
psql "TU_DATABASE_URL" -f database/produccion-usuarios-menu.sql
```

## Limitaciones conocidas

- **Fotos de productos/insumos**: se guardan en disco local (`backend/uploads/`). En el plan gratis de Render el disco es efímero — las fotos subidas se pierden en cada redeploy o reinicio. Si esto importa, hay que migrar a un storage persistente (Supabase Storage, ya contemplado como paso de producción en `FASE4_ARQUITECTURA_TECNICA.md`) — avísame si quieres que lo arme.
- El plan gratis de Render "duerme" el servicio tras un rato sin tráfico; la primera petición después de dormido tarda unos segundos más (cold start).
