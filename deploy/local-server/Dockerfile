FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/package.json
COPY admin-panel/package.json admin-panel/package.json
COPY apps/ozzyl-lifestyle/package.json apps/ozzyl-lifestyle/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=hms-pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm install --frozen-lockfile \
  && if ! node -e "require.resolve('@rolldown/binding-linux-x64-gnu')"; then \
    pnpm add -Dw @rolldown/binding-linux-x64-gnu@1.0.0-rc.15 --config.frozen-lockfile=false; \
  fi

FROM deps AS build
COPY . .
RUN pnpm build

FROM base AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl dumb-init \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

ENV HMS_LOCAL_IP="0.0.0.0"
ENV HMS_LOCAL_PORT="8787"
ENV HMS_LOCAL_STATE_DIR="/data/hms/state"
ENV HMS_LOCAL_VARS_FILE="/data/hms/secrets/.dev.vars.local_server"
ENV HMS_LOCAL_APPLY_VERSIONED_MIGRATIONS="0"

EXPOSE 8787

ENTRYPOINT ["dumb-init", "--"]
CMD ["bash", "scripts/local-server/start.sh"]
