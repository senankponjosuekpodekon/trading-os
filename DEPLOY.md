# Trading-OS deployment guide

## Prerequisites

- VPS with Ubuntu 22.04+
- Docker Engine + Docker Compose plugin
- GitHub repository with `ghcr.io` image registry enabled
- Domain name pointed to the VPS (A/AAAA records)

## 1. Provision the VPS

Run the setup script as root or a sudo user:

```bash
curl -fsSL https://raw.githubusercontent.com/your-org/trading-os/main/scripts/setup-vps.sh | bash
```

Or manually:

```bash
cd /opt
git clone https://github.com/your-org/trading-os.git
cd trading-os
chmod +x scripts/*.sh
```

## 2. Configure environment

```bash
cp .env.production.example .env
nano .env
```

Required values:

- `DATABASE_URL` — must point to the Postgres container (`postgres:5432`) or an external managed DB.
- `JWT_SECRET` — generate with `openssl rand -base64 32`.
- `NEXT_PUBLIC_API_URL` — public URL of the API.
- `FRONTEND_ORIGIN` — public URL of the web app.

## 3. Start the stack

```bash
./scripts/deploy.sh latest
```

This will:

1. Pull the latest code.
2. Pull or build Docker images.
3. Start Postgres, Redis, API, Web, Engine.
4. Run Prisma migrations.
5. Restart dependent services.

## 4. SSL / reverse proxy (optional)

The compose file exposes ports `80` and `443`. For production, place a reverse proxy in front:

```bash
# Example with Caddy
docker run -d -p 80:80 -p 443:443 \
  -v /opt/trading-os/Caddyfile:/etc/caddy/Caddyfile \
  -v caddy_data:/data -v caddy_config:/config \
  --name caddy --network trading-os_default \
  caddy:2
```

## 5. CI/CD

The repository includes `.github/workflows/deploy.yml`:

- On every push to `main`, images are built and pushed to `ghcr.io`.
- `deploy-staging` then `deploy-production` jobs run after the build.
- Required GitHub secrets:
  - `PROD_HOST`
  - `PROD_USER`
  - `PROD_SSH_KEY`

## 6. Backups

Create a cron job for Postgres backups:

```bash
0 2 * * * docker compose -f /opt/trading-os/docker-compose.prod.yml exec -T postgres pg_dump -U postgres trading_os > /opt/backups/trading-os-$(date +\%Y\%m\%d).sql
```

## 7. Monitoring

View logs:

```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f web
```

Scale horizontally by adding more engine replicas in `docker-compose.prod.yml`.
