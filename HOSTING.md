# Despliegue en hosting con cPanel + MySQL (rama `hosting-mysql`)

Esta rama corre el sistema con **MySQL 8** en vez de PostgreSQL/Supabase, y con
**un solo proceso Node** que sirve la API y la página en el mismo dominio.

Requisitos del hosting:

- cPanel con **Setup Node.js App** (Node **18 o superior**; mejor 20).
- **MySQL 8.0.14 o superior**. En phpMyAdmin → inicio → "Servidor de base de
  datos" → "Versión del servidor". Tiene que decir `8.0.x` u `8.4.x`; si dice
  **MariaDB**, avísame antes de seguir.
- SSL activo en el dominio (AutoSSL de cPanel). El inicio de sesión exige HTTPS.

---

## 1. Crear la base de datos (cPanel → "MySQL® Databases")

1. **Create New Database**: por ejemplo `sistemapos` (cPanel le antepone tu
   usuario: `miusuario_sistemapos`).
2. **Add New User**: por ejemplo `sistemapos`, con una contraseña fuerte. Anota la
   contraseña.
3. **Add User To Database**: ese usuario → esa base → **ALL PRIVILEGES**.

## 2. Crear las tablas (phpMyAdmin)

phpMyAdmin → selecciona la base (panel izquierdo) → pestaña **Importar** →
archivo `database/mysql/schema.sql` → **Importar**.

## 3. Pasar tus datos desde Supabase

Hazlo **justo antes del cambio**, con el sistema viejo sin uso (lo que se
registre en Supabase después de este paso no pasa a MySQL).

1. En Supabase: **Project Settings → Database → Connection string**, modo
   **Session** (puerto 5432). Copia la URL y reemplaza `[YOUR-PASSWORD]`.
2. En tu PC, en PowerShell, desde la carpeta `backend`:

   ```powershell
   npm install
   $env:SUPABASE_URL="postgresql://postgres.xxxx:TU_CLAVE@aws-0-xx.pooler.supabase.com:5432/postgres"
   npm run migrar:supabase-mysql
   ```

   El script **solo lee** Supabase y genera `database/mysql/datos.sql`. Ese
   archivo tiene tus datos reales, así que **no lo compartas** (git ya lo ignora).
3. phpMyAdmin → misma base → **Importar** → `database/mysql/datos.sql`.

El script también continúa los contadores: número de comensal, número de
factura (`F-000123`) y número de cotización siguen donde iban.

## 4. Armar el paquete

En tu PC, desde `backend`:

```powershell
npm run hosting:paquete
```

Genera `hosting/sistemapos-hosting.zip`, que incluye el backend compilado y la
página.

## 5. Subir el paquete

cPanel → **File Manager** → en tu carpeta de inicio (`/home/miusuario`), **fuera
de `public_html`**, crea la carpeta `sistemapos` → entra → **Upload** del zip →
clic derecho → **Extract**. Debe quedar así:

```
/home/miusuario/sistemapos/
  dist/          public/          uploads/
  package.json   package-lock.json   .env.example
```

## 6. Crear la aplicación Node (cPanel → "Setup Node.js App" → **Create Application**)

| Campo | Valor |
|---|---|
| **Node.js version** | 20.x (o la más alta disponible, mínimo 18) |
| **Application mode** | `Production` |
| **Application root** | `sistemapos` |
| **Application URL** | tu dominio (o subdominio), ruta vacía |
| **Application startup file** | `dist/server.js` |
| **Passenger log file** | `/home/miusuario/logs/sistemapos.log` (opcional, útil para ver errores) |

En **Environment variables** agrega (**Add Variable**) una por una:

| Nombre | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DB_HOST` | `localhost` |
| `DB_PORT` | `3306` |
| `DB_NAME` | `miusuario_sistemapos` (el nombre completo del paso 1) |
| `DB_USER` | `miusuario_sistemapos` (el usuario completo del paso 1) |
| `DB_PASSWORD` | la contraseña del paso 1, tal cual |
| `JWT_ACCESS_SECRET` | un texto largo y aleatorio (40+ caracteres) |
| `JWT_REFRESH_SECRET` | **otro** texto largo y aleatorio, distinto al anterior |
| `ACCESS_TOKEN_TTL` | `15m` |
| `REFRESH_TOKEN_TTL_HOURS` | `10` |
| `CORS_ORIGIN` | `https://tudominio.com` |
| `VAPID_PUBLIC_KEY` | la misma que ya usas en Render |
| `VAPID_PRIVATE_KEY` | la misma que ya usas en Render |
| `VAPID_SUBJECT` | la misma que ya usas en Render |

- **No pongas `PORT`**: el hosting asigna el puerto solo.
- Usa las **mismas** claves VAPID de Render. Si cambian, los celulares ya
  suscritos dejan de recibir las notificaciones de Cocina/Mesero.

Luego:

1. **Create**.
2. **Run NPM Install**. Instala solo lo necesario para producción.
3. **Restart**.

## 7. Verificar

- `https://tudominio.com/health` debe responder `{"status":"ok"}`.
- `https://tudominio.com` → iniciar sesión con tu usuario de siempre.
- Si algo falla, revisa el **Passenger log file** del paso 6.

## Fotos de productos

Las fotos viven en la carpeta `uploads/` de la app. Si tienes fotos en el
servidor anterior, copia su carpeta `uploads/` dentro de
`/home/miusuario/sistemapos/uploads/`. En Render (plan gratis) el disco se borra
en cada reinicio, así que puede que no quede ninguna.

## Actualizar después de un cambio

1. `npm run hosting:paquete`.
2. Sube el zip y extráelo encima: reemplaza `dist/` y `public/`, y **no borres
   `uploads/`**.
3. Si cambió `package.json`: **Run NPM Install**.
4. **Restart**.

## Despliegue automático (GitHub Actions)

Cada `git push` a la rama `hosting-mysql` compila el sistema, lo sube por FTP a
`/home/consenti/sistemapos` y la app se reinicia sola. El archivo que lo hace
es `.github/workflows/desplegar-hosting.yml`.

**Configuración (una sola vez):**

1. cPanel → **FTP Accounts** → crea una cuenta, por ejemplo `deploy`, con
   **Directory** = `sistemapos` (la carpeta de la app, no `public_html`).
2. GitHub → repositorio → **Settings → Secrets and variables → Actions → New
   repository secret**. Crea estos cuatro:

   | Secreto | Valor |
   |---|---|
   | `FTP_SERVER` | `ftp.consentidovelas.com` (o el que diga cPanel en "Configure FTP Client") |
   | `FTP_USERNAME` | el usuario completo, ej. `deploy@consentidovelas.com` |
   | `FTP_PASSWORD` | la clave de esa cuenta FTP |
   | `VITE_EXTERNAL_LEAD_API_KEY` | el mismo valor que tienes en `frontend/.env` |

**Qué no se hace solo:**

- **Dependencias nuevas:** si un cambio agrega o actualiza paquetes en
  `backend/package.json`, entra a cPanel → Setup Node.js App → **Run NPM
  Install** → **Restart**.
- **Cambios de base de datos:** si un cambio agrega tablas o columnas, hay que
  correr ese SQL en phpMyAdmin.
- **Seguimiento del despliegue:** en GitHub → pestaña **Actions** ves cada
  despliegue (verde = subió bien). Desde ahí también puedes lanzarlo a mano
  con **Run workflow**.
