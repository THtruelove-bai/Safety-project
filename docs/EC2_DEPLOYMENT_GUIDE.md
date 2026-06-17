# Safety Auth EC2 Deployment Guide

## Scope

This guide deploys the current Safety Auth application stack to a new EC2 Ubuntu Server:

- `safety-auth`
- `safety-web`
- `nginx`
- `postgres`
- `redis`

Wazuh Manager, Indexer, and Dashboard stay on Kali. EC2 runs only Wazuh Agent and sends logs to Kali over Tailscale.

Do not delete Docker volumes. Do not reset the database. Do not change JWT, OTP, auth flow, or Wazuh rules during this deployment.

## Current Project Analysis

### Docker Services

Current `docker-compose.yml` services:

| Service | Container | Role | Host Ports |
| --- | --- | --- | --- |
| `safety-auth` | `safety-auth` | NestJS API/auth service | `3000:3000` |
| `safety-web` | `safety-web` | Vite React frontend dev server | `5173:5173` |
| `nginx` | `safety-nginx` | Reverse proxy to backend | `8080:80`, `8443:443` |
| `postgres` | `safety-postgres` | App database | internal `5432` only |
| `redis` | `safety-redis` | OTP/session cache | internal `6379` only |

### Docker Volumes

Named volumes from the active compose file:

| Volume | Mounted In | Purpose |
| --- | --- | --- |
| `project_postgres_data` | `/var/lib/postgresql/data` | PostgreSQL data |
| `project_redis_data` | `/data` | Redis persistence |

Other Wazuh-related volumes exist locally but must not be deployed to EC2 for this target architecture.

### Config And Environment Files

Must carry to EC2:

- `.env`
- `docker-compose.yml`
- `nginx/nginx.conf`
- `certs/` if TLS certs are used by the compose mount
- `safety-auth/`
- `safety-web/`
- `package-lock.json` files inside both app directories

Reference examples:

- `.env.example`
- `safety-web/.env.example`

Important `.env` keys:

- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- `DB_HOST=postgres`, `DB_PORT=5432`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `REDIS_HOST=redis`, `REDIS_PORT=6379`, `REDIS_PASSWORD`
- `JWT_SECRET`, `JWT_EXPIRES_IN`
- `OTP_TTL_SECONDS`, `OTP_SECRET`
- `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM_*`
- `FRONTEND_URL`, `APP_URL`, `DOMAIN`
- `WAZUH_API_URL`, `WAZUH_API_USERNAME`, `WAZUH_API_PASSWORD`, `WAZUH_API_TLS_REJECT_UNAUTHORIZED`

For EC2 with Kali Wazuh over Tailscale, `WAZUH_API_URL` should point to Kali's Tailscale address if the backend needs Wazuh API access, for example `https://100.x.y.z:55000`.

### System Dependencies On EC2

Install on EC2 Ubuntu:

- Docker Engine
- Docker Compose plugin
- Git
- Curl, CA certificates, GnuPG
- Tailscale
- Wazuh Agent

Node.js is not required on the host because app builds run inside Docker, but having it installed can help with manual diagnostics.

## Deployability Review

### Compose

The compose file starts only the five required app services. It does not include Wazuh Manager, Indexer, or Dashboard.

Deployment concerns:

- `safety-web` is currently a Vite dev server (`npm install && npm run dev -- --host 0.0.0.0`). This can run on EC2, but it is not a production static frontend setup.
- `safety-web` uses `VITE_API_BASE_URL=http://localhost:3000`. This works only when the browser is on the same machine as the API. On a real EC2 URL, browser-side `localhost` points to the user's computer, so this must be planned before public access.
- `safety-auth` exposes host port `3000`. If nginx is the public entrypoint, keep `3000` closed in the Security Group.
- Postgres and Redis are internal-only in Docker networking, which is correct.

### Nginx

`nginx/nginx.conf`:

- listens on container port `80`
- uses `server_name auth.safety.vn`
- proxies all requests to `http://safety-auth:3000`

Current nginx proxies only backend API. It does not serve the React frontend.

### Backend CORS

`safety-auth/src/main.ts` allows:

- `process.env.FRONTEND_URL`
- `http://localhost:5173`
- `http://127.0.0.1:5173`

For EC2, set `FRONTEND_URL` to the actual frontend origin, for example `http://EC2_PUBLIC_IP:5173` or `https://your-domain`.

### Hardcoded Local Values

Observed local-oriented values:

- `docker-compose.yml`: `VITE_API_BASE_URL=http://localhost:3000`
- `safety-web/src/api.js`: fallback `http://localhost:3000`
- `safety-web/.env.example`: `VITE_API_BASE_URL=http://localhost:3000`
- `.env.example`: `WAZUH_API_URL=https://host.docker.internal:55000`
- `nginx/nginx.conf`: `server_name auth.safety.vn`

No application code changes are included in this deployment plan. Treat these as deployment configuration risks to resolve by environment and DNS planning.

### Build Check

Verified locally:

- `safety-auth`: `npm run build` passes.
- `safety-web`: `npm run build` passes.

## EC2 Checklist

### 1. Create EC2 Ubuntu

Recommended starting point:

- AMI: Ubuntu Server 24.04 LTS or 22.04 LTS
- Instance: at least `t3.small`; use `t3.medium` if build memory is tight
- Disk: at least 30 GB gp3
- Key pair: create or select SSH key
- IAM: no special role required for this basic deployment

### 2. Security Group

Open inbound:

| Port | Source | Purpose |
| --- | --- | --- |
| `22/tcp` | your IP only | SSH |
| `8080/tcp` | your IP or public | current nginx HTTP mapping |
| `8443/tcp` | your IP or public | current nginx HTTPS mapping if TLS is configured |
| `5173/tcp` | your IP or public | current Vite frontend |
| `3000/tcp` | your IP only, or closed | direct API debug only |

Do not expose:

- `5432/tcp` Postgres
- `6379/tcp` Redis
- Wazuh Manager ports on EC2, because Manager stays on Kali

If you later remap nginx to standard ports, use:

- `80/tcp`
- `443/tcp`

### 3. Install Docker

The generated `deploy-ec2.sh` installs Docker Engine and the Docker Compose plugin. Manual equivalent:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

### 4. Install Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --hostname safety-ec2
tailscale ip -4
```

Record:

- EC2 Tailscale IP
- Kali Tailscale IP

### 5. Install Wazuh Agent

EC2 installs only Wazuh Agent:

```bash
curl -sO https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/wazuh-agent_4.12.0-1_amd64.deb
sudo WAZUH_MANAGER="<KALI_TAILSCALE_IP>" dpkg -i ./wazuh-agent_4.12.0-1_amd64.deb
sudo systemctl daemon-reload
sudo systemctl enable --now wazuh-agent
```

On Kali Wazuh Manager, confirm the EC2 agent enrolls and is active.

### 6. Copy Source And Env

Options:

```bash
sudo mkdir -p /opt
sudo git clone git@github.com:THtruelove-bai/Safety-project.git /opt/safety-project
cd /opt/safety-project
```

Then copy the real `.env` securely:

```bash
scp .env ubuntu@<EC2_PUBLIC_IP>:/tmp/safety.env
sudo mv /tmp/safety.env /opt/safety-project/.env
sudo chmod 600 /opt/safety-project/.env
```

If certs are required:

```bash
scp -r certs ubuntu@<EC2_PUBLIC_IP>:/tmp/safety-certs
sudo rsync -a /tmp/safety-certs/ /opt/safety-project/certs/
```

## Backup Before Deploy

Run on the current VM before migration:

```bash
cd /home/de180538_vutruonghuy/Project
chmod +x backup-before-deploy.sh
./backup-before-deploy.sh
```

This creates:

- Postgres SQL dump
- Redis RDB copy
- `.env`
- compose config
- nginx and cert files
- volume metadata

Copy the backup archive off the VM before making EC2 changes.

## Deploy Commands

On EC2:

```bash
export SOURCE_REPO_URL="git@github.com:THtruelove-bai/Safety-project.git"
export SOURCE_BRANCH="phu"
export APP_DIR="/opt/safety-project"
export TAILSCALE_AUTHKEY="<optional-auth-key>"
export WAZUH_MANAGER="<KALI_TAILSCALE_IP>"
sudo -E bash deploy-ec2.sh
```

If source is already copied to EC2, run from inside the project:

```bash
docker compose build safety-auth
docker compose up -d postgres redis safety-auth safety-web nginx
docker compose ps
```

## Log Flow

Architecture:

```text
Browser
  |
  | HTTP/HTTPS
  v
EC2 Ubuntu
  |-- Docker: safety-web
  |-- Docker: nginx -> safety-auth
  |-- Docker: safety-auth -> postgres
  |-- Docker: safety-auth -> redis
  |
  | Wazuh Agent
  | tailscale0
  v
Kali over Tailscale
  |-- Wazuh Manager
  |-- Wazuh Indexer/Dashboard if present on Kali side
```

Log flow:

```text
safety-auth container logs
        |
        v
Docker host logs / configured log paths on EC2
        |
        v
Wazuh Agent on EC2
        |
        v
Tailscale encrypted network
        |
        v
Wazuh Manager on Kali
```

## Validation

After deploy:

```bash
docker compose ps
docker logs safety-auth --tail 100
docker logs safety-web --tail 100
docker logs safety-nginx --tail 100
curl -i http://localhost:3000/
curl -i http://localhost:8080/
systemctl status tailscaled --no-pager
systemctl status wazuh-agent --no-pager
```

From your laptop:

```bash
curl -i http://<EC2_PUBLIC_IP>:8080/
curl -i http://<EC2_PUBLIC_IP>:5173/
```

If using domain DNS, point the domain to the EC2 public IP and validate the configured `server_name`.

## Rollback

Rollback principles:

- Keep Docker volumes intact.
- Keep `.env` intact.
- Stop or replace only containers if needed.
- Restore database only from a verified backup and only when explicitly required.

If a new deploy fails but old data is intact:

```bash
cd /opt/safety-project
git log --oneline -5
git checkout <previous-known-good-commit>
docker compose build safety-auth
docker compose up -d postgres redis safety-auth safety-web nginx
docker compose ps
```

If config is wrong:

```bash
cp /path/to/backup/.env /opt/safety-project/.env
cp /path/to/backup/docker-compose.yml /opt/safety-project/docker-compose.yml
docker compose up -d postgres redis safety-auth safety-web nginx
```

If database restore is required, first create a fresh backup of the current EC2 state, then restore from the SQL dump:

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < postgres.dump.sql
```

Redis restore from RDB requires a maintenance window because Redis must load the RDB on start. Do not perform it casually.

## Known Follow-Up Risks

- Public frontend with `VITE_API_BASE_URL=http://localhost:3000` will not work for remote users unless the browser can reach its own localhost API, which it cannot. Plan a config-only deploy adjustment or a production frontend packaging change later.
- Current nginx proxies backend only; it does not serve the React frontend.
- SMTP must resolve and connect from EC2 for OTP delivery.
- `FRONTEND_URL` must match the real EC2 or domain origin for CORS.
- `WAZUH_API_URL=https://host.docker.internal:55000` should be replaced on EC2 with Kali's Tailscale IP if the app needs Wazuh API access.
