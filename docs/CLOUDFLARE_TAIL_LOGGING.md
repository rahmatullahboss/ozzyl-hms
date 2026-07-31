# Cloudflare Tail Logging — Ozzyl HMS

This project already emits structured server errors via `console.error('[SERVER_ERROR]', ...)` from `src/lib/server-error-logging.ts` and has Workers Observability enabled in `wrangler.toml`. Cloudflare dashboard observability is useful, but for hard-to-reproduce production bugs a live tail session can capture the exact console logs and uncaught exceptions seen at runtime.

## Quick live tail to a local file

Run from the project root:

```bash
pnpm tail:production
```

By default this tails the production worker with:

```bash
pnpm wrangler tail hms-saas-production --env production --format json --status error
```

The helper script writes newline-delimited JSON to:

```text
.tmp/cloudflare-tail/hms-saas-production-error-<timestamp>.ndjson
```

`.tmp/` is already ignored by git, so production logs will not be committed accidentally.

## Capture all invocations, not only error invocations

```bash
pnpm tail:production:all
```

Use this only for short investigations. It can become noisy and may enter Wrangler tail sampling mode on high traffic.

## Filter by HMS structured errors

```bash
TAIL_SEARCH='[SERVER_ERROR]' pnpm tail:production
```

This is useful when you only want the structured payload from `src/lib/server-error-logging.ts`.

## Keep it running after closing the terminal

For short debugging sessions, use `tmux` or `screen`:

```bash
tmux new -s hms-tail
pnpm tail:production
```

Detach with `Ctrl+B`, then `D`. Reattach later:

```bash
tmux attach -t hms-tail
```

For a Linux VPS/server, use a systemd service so the tail restarts if it exits:

```ini
[Unit]
Description=Ozzyl HMS Cloudflare production tail logger
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/hms
Environment=CLOUDFLARE_API_TOKEN=replace_with_token
Environment=TAIL_LOG_DIR=/var/log/ozzyl-hms/cloudflare-tail
ExecStart=/usr/bin/pnpm tail:production
Restart=always
RestartSec=10
User=hms

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now hms-cloudflare-tail.service
sudo journalctl -u hms-cloudflare-tail.service -f
```

## Authentication

For a laptop session, `wrangler login` is enough. For a server/systemd session, set `CLOUDFLARE_API_TOKEN` in the environment. Keep the token out of git and avoid storing it in any tracked file.

## Security rules

These logs may include request URLs, headers, user IDs, tenant IDs, stack snippets, and error messages. Treat them as sensitive production data.

- Keep local files under `.tmp/` or another ignored/private directory.
- Do not paste full logs publicly if they contain patient/hospital/user details.
- Rotate or delete old logs after debugging.
- Prefer `--status error` for always-on capture to reduce noise and sampling risk.

## Production-grade alternative

`wrangler tail` is a live session. It only records while the process is running. For permanent production logging, use one of these:

1. **Tail Worker** — attach a separate Worker as `tail_consumers` and send `events` to R2, D1, Sentry, Grafana, Axiom, or another endpoint.
2. **Workers Logpush / Workers Logs export** — configure Cloudflare to ship logs to a durable external destination.
3. **OpenTelemetry export** — if using an observability tool that supports OTEL, export logs/traces in batches instead of invoking a Tail Worker after every request.

Recommended path for HMS:

- Immediate debugging: `pnpm tail:production`.
- Always-on lightweight fallback: systemd running `pnpm tail:production` to a private VPS log folder.
- Proper production setup: Tail Worker or Logpush to R2/Sentry/Loki with retention and alerting.
