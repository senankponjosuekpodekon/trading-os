# Trading-OS deployment guide

## Current setup (this VPS)

- **Server**: single Ubuntu VPS (`169.58.80.46`) running everything via Docker.
- **Postgres 17** and **Redis 7** run as **standalone containers** managed outside this repo
  (network `postgres_default`) — they hold real production data and are **not** started by
  `docker-compose.prod.yml`.
- **`nginx-proxy-manager`**, **netdata**, **uptime-kuma**, **ollama** also run independently on
  this VPS (see `docker ps`).
- **No image registry (ghcr.io) is used.** Images for `api`, `engine`, `web` are built **locally
  on the VPS** by `docker-compose.prod.yml` from the checked-out source.
- **Production branch is `vps`**, not `main`. `main` is currently stale/unmaintained.

## 1. Provision a new VPS (only for a fresh server)

```bash
cd /opt   # or wherever you want the repo
git clone <repo-url> trading-os
cd trading-os
git checkout vps
chmod +x scripts/*.sh
```

Run `scripts/setup-vps.sh` to install Docker/Compose if needed.

## 2. Configure environment

```bash
cp .env.production.example .env
nano .env
```

Required values (see `.env.production.example` for the full list):

- `DATABASE_URL` — points to the external `postgres` container.
- `JWT_SECRET` — generate with `openssl rand -base64 32`.
- `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_ENGINE_URL` / `NEXT_PUBLIC_WS_URL` — public URLs, baked
  into the Next.js build (build ARGs, not just runtime env).
- `SENTRY_DSN_API` / `SENTRY_DSN_ENGINE` / `NEXT_PUBLIC_SENTRY_DSN` — optional, leave empty to
  disable error tracking.

## 3. Deploy / redeploy

```bash
./scripts/deploy.sh
```

This will:

1. `git pull origin vps`.
2. `docker compose -f docker-compose.prod.yml build` (local build, no registry pull).
3. `docker compose -f docker-compose.prod.yml up -d` (api, engine, web — postgres/redis untouched).
4. Run Prisma migrations against the external Postgres.
5. Prune dangling images.

## 4. SSL / reverse proxy

Already handled by the existing `nginx-proxy-manager` container on this VPS — no extra reverse
proxy needs to be started from this repo.

## 5. CI/CD

`.github/workflows/deploy.yml`:

- Triggered on every push to **`vps`**.
- SSHes into the VPS (`PROD_HOST` / `PROD_USER` / `PROD_SSH_KEY` GitHub secrets) and runs
  `scripts/deploy.sh` there — no image build/push happens on GitHub's side.

`.github/workflows/ci.yml`:

- Runs lint/tests/build checks on push/PR to `main`, `develop`, `dev`, `vps`. Does **not** deploy.

## 6. Backups

Already configured via cron on this VPS:

```bash
0 2 * * * /root/projects/trading-os/scripts/backup-db.sh >> /opt/backups/backup.log 2>&1
```

Dumps go to `/opt/backups/trading-os-*.sql.gz`, 7-day retention (see `scripts/backup-db.sh`).

## 7. Monitoring

```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f web
docker compose -f docker-compose.prod.yml logs -f engine
```

`netdata` (port `19999`) and `uptime-kuma` (port `3001` on the host, separate from the `api`
container's internal `3001`) provide additional system/uptime monitoring.
