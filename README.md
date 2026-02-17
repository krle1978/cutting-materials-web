# Cutting Materials Monorepo

Monorepo za optimizaciju sečenja letvica za ramove komarnika.

## Stack

- Frontend: Next.js (`apps/web`) deploy na Vercel
- Backend: Fastify + PostgreSQL (`apps/api`) deploy na Render
- Shared:
  - `packages/cutting-core`: BFD algoritam + testovi
  - `packages/contracts`: Zod šeme i shared tipovi

## Quick Start (lokalno)

```bash
npm ci
npm run build
npm run test
```

Pokretanje:

```bash
npm run dev:api
npm run dev:web
```

## Env

API (`apps/api/.env`):

```env
PORT=4000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/cutting_materials
CORS_ORIGINS=http://localhost:3000
```

Web (`apps/web/.env.local`):

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

## Deploy

### Render (backend)

1. Poveži GitHub repo sa Render.
2. Kreiraj PostgreSQL bazu.
3. Kreiraj Web Service sa build/start komandama:
   - Build: `npm ci && npm run build`
   - Start: `npm run start:api`
4. Podesi env:
   - `DATABASE_URL` iz Render Postgres servisa
   - `CORS_ORIGINS` na Vercel URL frontend-a

Alternativa: koristi `infra/render.yaml` kao Blueprint.

### Vercel (frontend)

1. Importuj isti GitHub repo na Vercel.
2. Root Directory: `apps/web`
3. Env var:
   - `NEXT_PUBLIC_API_URL=https://<render-backend-domain>`

## API Endpoints

- `GET /health`
- `GET /inventory`
- `POST /inventory/add`
- `POST /orders/plan`
- `POST /orders/commit`

Detalji ugovora su u `packages/contracts/src/index.ts`.

