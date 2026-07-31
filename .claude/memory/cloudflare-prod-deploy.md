---
name: cloudflare-prod-deploy
description: Cloudflare Workers production deploy workflow - build first, then deploy
type: reference
---

# Cloudflare Workers Production Deploy

## Workflow
1. `npm run build` - Build the web app (updates web/dist)
2. Manually copy extra static files to web/dist (e.g., `cp TESTING_TUTORIAL.html web/dist/`)
3. `wrangler deploy --env production` - Deploy to Cloudflare

## Why
- Worker uses `process.cwd()` which points to web/dist directory
- Static files must be in web/dist to be served
- web/dist is NOT in git (ignored), so must be built/locally managed

## File Paths in Code
Use `join(process.cwd(), 'web', 'dist', 'filename')` to reference static files.