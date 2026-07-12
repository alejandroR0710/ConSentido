# Con Sentido / El Rinconcito del Migao

ERP + POS + Inventario para microempresa, con 5 módulos de negocio (Insumos, Talleres, Con Sentido, Migao/POS-cafetería, Pedidos) y un módulo general transversal (auth, Caja General).

## Stack

- **Backend**: Node.js + Express + TypeScript (`backend/`), en capas por módulo (routes → controller → service → repository).
- **Frontend**: React + TypeScript + Vite, PWA instalable (`frontend/`).
- **Base de datos**: PostgreSQL.
- **Auth**: JWT (access token en memoria) + refresh token en cookie httpOnly.

## Documentación del proyecto

El detalle de cada fase (requisitos, diseño funcional, base de datos, arquitectura, desarrollo) está en la raíz del repo:

- `FASE1_REQUISITOS.md` — `FASE5_DESARROLLO.md`
- `RUTA_DEL_PROYECTO.md` — checkpoint general y bitácora de avance

## Cómo correrlo en local

1. **Base de datos**: crea una base PostgreSQL y aplica, en orden:
   ```
   psql -d tu_base -f database/schema.sql
   psql -d tu_base -f database/seed.sql
   ```
2. **Backend**:
   ```
   cd backend
   cp .env.example .env   # completa DATABASE_URL
   npm install
   npm run dev             # http://localhost:4000
   ```
3. **Frontend**:
   ```
   cd frontend
   cp .env.example .env
   npm install
   npm run dev              # http://localhost:5173
   ```

Credenciales de prueba (ver tabla completa en `FASE5_DESARROLLO.md`): `admin@sistemapos.local` / `SuperRoot2026!` (Super Root, acceso total).

## Despliegue

Backend en Render, frontend en Vercel — ver `render.yaml` / `frontend/vercel.json` y la sección de despliegue en `FASE5_DESARROLLO.md`.
