# Ozzyl HMS — Hospital Management System

## Project Overview
Ozzyl HMS is a multi-tenant Hospital Management System (SaaS) built on a Cloudflare-native stack. The project is organized as a monorepo-style structure containing the core SaaS application, a marketing landing page, and project documentation/specifications.

### Key Components
- **`hms-saas/`**: The core application.
  - **Backend**: Cloudflare Workers with Hono.
  - **Database**: Cloudflare D1 (SQLite) with Drizzle ORM.
  - **Frontend**: React 18, TypeScript, Vite, and Tailwind CSS.
  - **Authentication**: JWT-based (both slug-free direct login and tenant-slug based).
- **`landing/`**: The marketing landing page built with Astro and Tailwind CSS.
- **Root Files & Docs**: Specifications (`hms-project-specification.md`), PRDs, and OpenSpec configurations (`openspec/`).

## Architecture & Technologies
- **Language**: TypeScript across the stack (strict mode enabled).
- **API**: Hono framework with `@hono/zod-validator` for request validation.
- **Storage/DB**: Cloudflare D1 for relational data, R2 for file storage (reports, attachments), Durable Objects for counters/stock.
- **Testing**: Vitest for unit/integration tests, Playwright for E2E tests (`hms-saas`).

## Building and Running

### Core Application (`hms-saas/`)
Navigate to the `hms-saas` directory:
```bash
cd hms-saas
```
- **Install dependencies**: `pnpm install`
- **Run local development** (API + Web): `pnpm run dev` (Starts worker on :8787)
- **Build frontend**: `pnpm build`
- **Deploy to Cloudflare**: `pnpm run deploy`
- **Run Tests**: `pnpm test` (Vitest), `pnpm test:e2e` (Playwright E2E)
- **Database Migrations (Drizzle)**:
  - Generate: `pnpm db:generate`
  - Migrate: `pnpm db:migrate`

### Landing Page (`landing/`)
Navigate to the `landing` directory:
```bash
cd landing
```
- **Install dependencies**: `npm install` (or `pnpm install` depending on lockfile preference, check `package.json`)
- **Run local development**: `npm run dev` (Astro dev server)
- **Build**: `npm run build`

## Development Conventions

1. **Monetary Values**: All money fields in the database should be stored as **integer poisha** (1 BDT = 100 paisa) to avoid floating-point inaccuracies.
2. **Database Queries**: Always use parameterized queries / prepared statements (or Drizzle ORM methods) to prevent SQL injection.
3. **Error Handling**: Use Hono's `HTTPException` for standardizing API errors.
4. **Validation**: Use `Zod` schemas for validating incoming requests and database inserts.
5. **Security First**: 
   - Never commit secrets. Use `wrangler secret` for environment variables.
   - Enforce tenant isolation in all queries.
6. **Accounting**: Major transactions create journal entries following double-entry bookkeeping via a chart of accounts.
