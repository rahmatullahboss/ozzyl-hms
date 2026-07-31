---
description: Where to edit code and deploy — hms-saas project structure guide
---

# hms-saas Project Structure Guide

> **There is ONE source of truth for code. No duplicates.**

## 📁 Project Layout

```
hms-saas/
├── src/                    ← Backend (Hono Workers)
│   ├── index.ts            ← Main app entry, all routes registered here
│   ├── routes/tenant/      ← All tenant API routes
│   ├── schemas/            ← Zod validation schemas
│   ├── lib/                ← Helpers (context-helpers, sequence, etc.)
│   ├── middleware/          ← Auth, tenant, rate-limit middleware
│   └── types.ts            ← TypeScript types
├── web/                    ← Frontend (React + Vite)
│   ├── src/                ← React source
│   └── dist/               ← Built output (auto-generated)
├── migrations/             ← D1 SQL migrations
└── wrangler.toml           ← Cloudflare config
```

## 🚨 Critical Rules

1. **No `apps/` directory** — It was deleted permanently. All code is in root `src/` and `web/`.
2. **Routes use `requireTenantId(c)`** — imported from `../../lib/context-helpers`
3. **Register new routes in `src/index.ts`** — both import AND `.route()` call
4. **New schemas go in `src/schemas/`**

## 🚀 Deploy Commands

| Environment | Command |
|---|---|
| **Dev** | `npm run dev` |
| **Production** | `npx wrangler deploy --env production` |
| **Dry run** | `npx wrangler deploy --dry-run` |

## 📊 Database

| Environment | Command |
|---|---|
| **Local migration** | `npx wrangler d1 execute DB --local --file=migrations/XXXX.sql` |
| **Production migration** | `npx wrangler d1 execute DB --remote --env production --file=migrations/XXXX.sql` |

## ✅ Adding a New Route

```bash
# 1. Create route file
src/routes/tenant/myNewRoute.ts

# 2. Use requireTenantId pattern
import { requireTenantId, requireUserId } from '../../lib/context-helpers';

# 3. Register in src/index.ts
import myNewRoutes from './routes/tenant/myNewRoute';
app.route('/api/my-new-route', myNewRoutes);

# 4. Build + deploy
cd web && npx vite build && cd .. && npx wrangler deploy --env production
```
