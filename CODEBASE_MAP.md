# CODEBASE_MAP

Ovaj fajl je brzi indeks projekta za lakse snalazenje i brze izmene.

## 1) Monorepo mapa

- `apps/web` - Next.js frontend
- `apps/api` - Fastify API + DB store
- `packages/contracts` - Zod seme i shared tipovi
- `packages/cutting-core` - BFD algoritam secenja + testovi
- `infra` - deploy konfiguracija (Render)

## 2) Gde menjati sta

### Frontend

- `apps/web/app/page.tsx`
  - Glavna UI logika (inventory, orders, auth, notifications, plan result)
  - Pozivi API-ja (`/inventory`, `/orders`, `/orders/:id/accept`, `/orders/accept-all`)
- `apps/web/app/globals.css`
  - Stilovi UI-ja
- `apps/web/app/layout.tsx`
  - Root layout

### Backend API

- `apps/api/src/server.ts`
  - Entry point, bira store:
    - `PostgresStore` ako postoji `DATABASE_URL`
    - `MemoryStore` za lokalni fallback
- `apps/api/src/app.ts`
  - Registracija CORS + route modula
- `apps/api/src/routes/inventory.ts`
  - `GET /inventory`
  - `POST /inventory/add`
- `apps/api/src/routes/orders.ts`
  - `GET /orders`
  - `POST /orders`
  - `POST /orders/:orderId/accept`
  - `POST /orders/accept-all`
  - `POST /orders/plan`
  - `POST /orders/commit`

### DB sloj

- `apps/api/src/db/postgres-store.ts`
  - Produkcioni persistence sloj
  - Plan commit, inventory update, remnants, order queue status
- `apps/api/src/db/memory-store.ts`
  - In-memory varijanta za lokalni razvoj bez Postgres-a
- `apps/api/src/db/sql.ts`
  - SQL migracije

### Shared ugovori i algoritam

- `packages/contracts/src/index.ts`
  - Zod schema source-of-truth (request/response forme i tipovi)
  - Plan parametri i enum vrednosti (status, class, units)
- `packages/cutting-core/src/index.ts`
  - `buildCutPlanBFD`
  - `buildCutPlanBFDForPieces`
  - Pravila alokacije i shortage logika
- `packages/cutting-core/tests/buildCutPlanBFD.test.ts`
  - Testovi algoritma

## 3) Brza pretraga (ripgrep)

Koristi iz root-a projekta:

```powershell
rg "buildCutPlanBFD|buildCutPlanBFDForPieces" packages/cutting-core/src
rg "orderQueueCreateRequestSchema|orderPlanRequestSchema" packages/contracts/src
rg "registerOrdersRoutes|registerInventoryRoutes" apps/api/src
rg "onAddInventory|onOrderSubmit|onAcceptOrder|onAcceptAll" apps/web/app/page.tsx
rg "DATABASE_URL|NEXT_PUBLIC_API_URL|CORS_ORIGINS" -g "*.ts" -g "*.tsx" -g "*.md"
```

## 4) Najcesci tokovi izmena

- Promena API payload-a:
  1. `packages/contracts/src/index.ts`
  2. `apps/api/src/routes/*.ts`
  3. `apps/web/app/page.tsx`
- Promena algoritma secenja:
  1. `packages/cutting-core/src/index.ts`
  2. `packages/cutting-core/tests/buildCutPlanBFD.test.ts`
  3. `apps/api/src/routes/orders.ts` (ako se menja poziv/oblik rezultata)
- Promena DB ponasanja:
  1. `apps/api/src/db/sql.ts`
  2. `apps/api/src/db/postgres-store.ts`

## 5) Pokretanje i provera

Iz root-a:

```bash
npm ci
npm run build
npm run test
npm run dev:api
npm run dev:web
```

## 6) Env reference

- API primer: `apps/api/.env.example`
- Web primer: `apps/web/.env.example`
- Root overview: `README.md`

## 7) Hotspots (funkcije + linije)

Napomena: linije su tacne u trenutnom stanju i mogu da se pomere nakon izmena.

### Frontend hotspots (`apps/web/app/page.tsx`)

- `resolveApiBaseUrl` - linija 219
- `loadInventory` - linija 337
- `loadOrders` - linija 346
- `onAddInventory` - linija 476
- `onAddOrderRow` - linija 511
- `onRefreshWorkerMessages` - linija 577
- `onOrderSubmit` - linija 650
- `onAcceptOrder` - linija 720
- `onAcceptAll` - linija 767

### API hotspots (`apps/api/src/routes/orders.ts`)

- `registerOrdersRoutes` - linija 25
- `acceptStoredOrder` - linija 242
- `resolveInventoryClass` - linija 303
- `resolveWidthOnly` - linija 314
- `resolveOrderCreatedBy` - linija 321
- `expandOrderWidthsToPieces` - linija 344

### Algoritam hotspots (`packages/cutting-core/src/index.ts`)

- `buildCutPlanBFD` - linija 94
- `buildCutPlanBFDForPieces` - linija 106
- `buildPlanFromPieces` - linija 118
- `expandOrderToPieces` - linija 251
- `expandInventory` - linija 268
- `summarizePieces` - linija 294

### Contracts hotspots (`packages/contracts/src/index.ts`)

- `inventoryAddRequestSchema` - linija 40
- `orderPlanRequestSchema` - linija 54
- `orderCommitRequestSchema` - linija 61
- `orderQueueCreateRequestSchema` - linija 82
- `mergePlanParams` - linija 102

### Brzo osvezavanje linija

```powershell
rg -n "function (onOrderSubmit|onAddInventory|onAcceptOrder|onAcceptAll|onAddOrderRow|onRefreshWorkerMessages|resolveApiBaseUrl)|const (loadInventory|loadOrders) = useCallback" apps/web/app/page.tsx
rg -n "export async function registerOrdersRoutes|async function acceptStoredOrder|function resolveInventoryClass|function resolveWidthOnly|function resolveOrderCreatedBy|function expandOrderWidthsToPieces" apps/api/src/routes/orders.ts
rg -n "export function buildCutPlanBFD|export function buildCutPlanBFDForPieces|function buildPlanFromPieces|function expandOrderToPieces|function expandInventory|function summarizePieces" packages/cutting-core/src/index.ts
rg -n "export const (orderQueueCreateRequestSchema|orderPlanRequestSchema|orderCommitRequestSchema|inventoryAddRequestSchema)|export function mergePlanParams" packages/contracts/src/index.ts
```
