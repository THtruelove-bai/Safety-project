# Wazuh Integration For Safety Auth

This guide wires Safety Auth authentication audit logs into Wazuh for dev/lab detection.

## Architecture

```text
safety-auth stdout JSON logs
        ↓
Docker json-file logs
        ↓
wazuh.safety-auth-log-tailer mirror
        ↓
Wazuh Agent / Wazuh Manager
        ↓
Wazuh Indexer
        ↓
Wazuh Dashboard
```

Safety Auth continues to log audit events to stdout. The `wazuh.safety-auth-log-tailer` service reads Docker `json-file` logs from the host path `/var/lib/docker/containers` and writes them into one stable mirror file. The Wazuh agent reads only that mirror file, forwards matching events to the Wazuh manager, and custom Wazuh decoders/rules parse and alert on logs where:

```json
{"source":"safety-auth","category":"authentication"}
```

OTP hardening events are included in the same authentication audit stream. OTP TTL is 60 seconds (`OTP_TTL_SECONDS=60`), resend is limited by Redis cooldown/count keys, and locked OTP sessions produce `auth.otp.locked` alerts.

## Files Added

- `docker-compose.wazuh.yml`: overlay for Wazuh single-node that mounts Safety Auth custom decoder/rules and starts a Wazuh agent for Docker logs.
- `wazuh-config/agent/ossec.conf`: Wazuh agent config that enrolls to `wazuh.manager` and reads the Safety Auth Docker log mirror.
- `wazuh-config/decoders/0510-safety-auth_decoders.xml`: custom decoder for raw Safety Auth JSON and Docker-wrapped JSON logs.
- `wazuh-config/rules/1010-safety-auth_rules.xml`: custom alert and correlation rules for Safety Auth auth events.

No real application secrets are added by these files.

## Start Safety Auth

From the project root:

```bash
cd /home/de180538_vutruonghuy/Project
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs -f safety-auth
```

Do not run destructive cleanup commands such as `docker compose down -v`, `docker system prune -a`, or deletion of `/var/lib/docker` unless you intentionally want to remove data.

## Start Wazuh

Use the existing Wazuh single-node deployment plus the Safety Auth overlay:

```bash
cd /home/de180538_vutruonghuy/Project
docker compose   -f wazuh-docker/single-node/docker-compose.yml   -f docker-compose.wazuh.yml   config

docker compose   -f wazuh-docker/single-node/docker-compose.yml   -f docker-compose.wazuh.yml   up -d
```

The upstream Wazuh compose exposes the dashboard on host port `443`. If that port is already used, change the dashboard host port in `wazuh-docker/single-node/docker-compose.yml` before starting Wazuh.

Check containers:

```bash
docker compose   -f wazuh-docker/single-node/docker-compose.yml   -f docker-compose.wazuh.yml   ps
```

Check Wazuh manager and agent logs:

```bash
docker compose   -f wazuh-docker/single-node/docker-compose.yml   -f docker-compose.wazuh.yml   logs -f wazuh.manager wazuh.agent.safety-auth
```

## How Logs Are Collected

The overlay uses one log source for alerting. `wazuh.safety-auth-log-tailer` reads host Docker logs and writes a stable mirror file into the `safety-auth-docker-logs` volume. `wazuh.agent.safety-auth` mounts only that mirror volume for log collection:

```yaml
wazuh.safety-auth-log-tailer:
  volumes:
    - /var/lib/docker/containers:/docker/containers:ro
    - safety-auth-docker-logs:/logs

wazuh.agent.safety-auth:
  volumes:
    - ../../wazuh-config/agent/ossec.conf:/wazuh-config-mount/etc/ossec.conf:ro
    - safety-auth-docker-logs:/var/log/safety-auth-docker:ro
```

The agent reads Docker `json-file` lines from the mirror as raw text so the custom fallback decoder can parse the escaped Safety Auth JSON inside the Docker `log` field:

```xml
<localfile>
  <log_format>syslog</log_format>
  <location>/var/log/safety-auth-docker/docker-containers.log</location>
</localfile>
```

Do not configure the agent to read both `/var/lib/docker/containers/*/*-json.log` and `/var/log/safety-auth-docker/docker-containers.log`. Those paths contain the same Docker event, so Wazuh will create duplicate alerts with different `location` values.

## Decoders

`wazuh-config/decoders/0510-safety-auth_decoders.xml` includes:

- `safety-auth-json`: parses raw stdout JSON with Wazuh `JSON_Decoder`.
- `safety-auth-docker-json`: fallback parent decoder for Docker `json-file` lines where the Safety Auth JSON is escaped inside the Docker `log` field.
- Child decoders extract `source`, `category`, `event`, `status`, `severity`, `username`, `email`, `ip`, `userAgent`, and `reason` where available.

## Rules

Rule IDs `100500-100599` are reserved for Safety Auth.

| Rule ID | Event | Level | Purpose |
| ---: | --- | ---: | --- |
| `100500` | any Safety Auth auth audit | 0 | Base matcher |
| `100510` | `auth.login.password.failed` | 7 | Password login failed |
| `100511` | repeated password failures same IP | 10 | Correlation/bruteforce |
| `100520` | `auth.otp.verify.failed` | 8 | OTP verification failed |
| `100521` | repeated OTP failures same IP | 11 | Correlation/bruteforce |
| `100522` | repeated OTP failures same username | 11 | Correlation/bruteforce |
| `100530` | `auth.rate_limit.exceeded` | 10 | Rate limit exceeded |
| `100531` | repeated rate limits same IP | 12 | Correlation/abuse |
| `100540` | `auth.legacy_login.blocked` | 9 | Legacy endpoint attempt |
| `100550` | `auth.me.failed` | 6 | JWT/session validation failed |
| `100560` | `auth.login.password.success` | 3 | Password step success |
| `100570` | `auth.otp.verify.success` | 3 | OTP success |
| `100590`/`100595` | `auth.otp.resend.success` | 3 | OTP resend succeeded |
| `100591`/`100596` | `auth.otp.resend.failed` | 6 | OTP resend failed |
| `100592`/`100597` | `auth.otp.resend.blocked` | 9 | OTP resend blocked by cooldown/limit |
| `100593`/`100598` | `auth.otp.attempt.failed` | 7 | Wrong OTP attempt |
| `100594`/`100599` | `auth.otp.locked` | 10 | OTP session locked after too many wrong attempts |

Correlation rules use `same_field` on `ip` or `username` over short time windows.

## Generate Test Logs

Run these from the project root after Safety Auth is up.

Legacy login blocked:

```bash
curl -i -X POST http://localhost:3000/auth/login   -H "Content-Type: application/json"   -d '{"email":"test@gmail.com","password":"password"}'
```

Password login failed:

```bash
curl -i -X POST http://localhost:3000/auth/login/request-otp   -H "Content-Type: application/json"   -d '{"username":"huy","password":"wrong-password"}'
```

OTP failed:

```bash
curl -i -X POST http://localhost:3000/auth/verify-otp   -H "Content-Type: application/json"   -d '{"email":"test@gmail.com","otp":"000000"}'
```

`/auth/me` without token:

```bash
curl -i http://localhost:3000/auth/me
```

`/auth/me` invalid token:

```bash
curl -i http://localhost:3000/auth/me   -H "Authorization: Bearer invalid.token.value"
```

Rate limit exceeded:

```bash
for i in 1 2 3 4; do
  curl -i -X POST http://localhost:3000/auth/register     -H "Content-Type: application/json"     -d "{"username":"rl$i","email":"rl$i@gmail.com","password":"password123"}"
done
```

Confirm Docker logs first:

```bash
docker compose logs --tail=80 safety-auth
```

Then check Wazuh alerts:

```bash
docker compose   -f wazuh-docker/single-node/docker-compose.yml   -f docker-compose.wazuh.yml   logs --tail=100 wazuh.manager
```

## Check Decoder And Rules

Inside the Wazuh manager container, use `wazuh-logtest`:

```bash
docker compose   -f wazuh-docker/single-node/docker-compose.yml   -f docker-compose.wazuh.yml   exec wazuh.manager /var/ossec/bin/wazuh-logtest
```

Paste a sample Safety Auth log line:

```json
{"timestamp":"2026-06-08T04:00:00.000Z","source":"safety-auth","category":"authentication","event":"auth.login.password.failed","status":"failed","severity":"medium","username":"huy","ip":"172.19.0.1","userAgent":"curl/8.5.0","reason":"invalid_credentials"}
```

Expected result: decoder should identify the Safety Auth log and rule `100510` should fire for `auth.login.password.failed`.

You can also inspect the mounted files inside the manager:

```bash
docker compose   -f wazuh-docker/single-node/docker-compose.yml   -f docker-compose.wazuh.yml   exec wazuh.manager ls -l /var/ossec/etc/decoders /var/ossec/etc/rules
```

## Test OTP Hardening Alerts

Generate a wrong login OTP attempt:

```bash
curl -i -X POST http://localhost:3000/auth/login/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"username":"huy","otp":"000000"}'
```

Generate a resend event:

```bash
curl -i -X POST http://localhost:3000/auth/resend-otp \
  -H "Content-Type: application/json" \
  -d '{"purpose":"login","username":"huy"}'
```

Repeat wrong OTP 5 times to trigger `auth.otp.locked`. Repeat resend requests past cooldown/limit to trigger `auth.otp.resend.blocked`.

Check Wazuh alerts:

```bash
docker exec single-node-wazuh.manager-1 \
  sh -c "grep 'auth.otp.resend\|auth.otp.attempt.failed\|auth.otp.locked' /var/ossec/logs/alerts/alerts.json | tail -20"
```

Expected rule IDs for Docker mirror ingestion are `100595` through `100599`.

## Wazuh Dashboard

Open the dashboard in a browser:

```text
https://localhost/
```

Use the credentials configured for your local Wazuh deployment. Do not commit real Wazuh admin/API passwords to this repository. The upstream lab compose contains example values; replace them locally for a real environment.

In the dashboard:

1. Go to Security events.
2. Filter for `rule.groups:safety_auth` or `data.source:safety-auth`.
3. Filter event names such as `data.event:auth.rate_limit.exceeded`.
4. Confirm alert levels match the rules above.

## Troubleshooting

### No Safety Auth logs in Docker

Check the app first:

```bash
docker compose logs -f safety-auth
```

Generate a curl event and confirm a JSON line contains `"source":"safety-auth"` and `"category":"authentication"`.

### Agent cannot read Docker logs

On Linux, Docker json-file logs usually live under:

```text
/var/lib/docker/containers/<container-id>/<container-id>-json.log
```

On WSL, Docker Desktop, rootless Docker, or VM-based Docker, the path may differ or may not be visible from the Linux distro. Adjust the tailer host bind mount in `docker-compose.wazuh.yml`; keep the agent `<location>` pointed at the mirror file unless you intentionally replace the mirror design.

Permission issues are common. The tailer container may need a host path that is readable by the container. Keep the mount read-only.

### Wazuh Dashboard does not start

Check available memory and kernel settings. Wazuh Indexer commonly requires:

```bash
sudo sysctl -w vm.max_map_count=262144
```

Also check for port conflicts on host ports `443`, `9200`, `1514`, `1515`, and `55000`.

### Decoder or rule does not fire

Use `wazuh-logtest` with a raw Safety Auth JSON line. If raw JSON works but Docker-collected logs do not, inspect the exact Docker log line:

```bash
sudo find /var/lib/docker/containers -name '*-json.log' -print | head
```

If your Docker runtime stores escaped JSON differently, update the fallback decoder regex in `wazuh-config/decoders/0510-safety-auth_decoders.xml`.

### Duplicate Safety Auth alerts

Each Safety Auth audit event should appear once in `/var/ossec/logs/alerts/alerts.json`, with `location` set to the mirror file:

```text
/var/log/safety-auth-docker/docker-containers.log
```

Check recent Safety Auth alerts and their locations:

```bash
docker exec single-node-wazuh.manager-1 \
  sh -c "grep '"id":"1005' /var/ossec/logs/alerts/alerts.json | tail -20"
```

If the same event appears once from the mirror and once from a raw Docker path like `/var/lib/docker/containers/.../*-json.log`, the agent is reading two sources for the same log. Remove the raw Docker `<localfile>` and keep only `/var/log/safety-auth-docker/docker-containers.log`.

### Correlation rule does not fire

Generate repeated failures from the same source quickly. Correlation windows are currently:

- 5 password failures from same `ip` in 300 seconds.
- 5 OTP failures from same `ip` in 300 seconds.
- 5 OTP failures for same `username` in 300 seconds.
- 3 rate-limit events from same `ip` in 300 seconds.

If Docker logs do not expose `ip` as a decoded field, verify the decoder output with `wazuh-logtest`.

## Enrollment Fix Notes

The `wazuh.agent.safety-auth` service now persists `/var/ossec/etc` in the named volume `safety-auth-agent-etc`. This keeps `client.keys` across container recreates and prevents repeated enrollment attempts with the same agent name.

If an earlier non-persistent agent already registered and a recreated agent reports:

```text
Duplicate agent name: safety-auth-docker-agent
```

remove only the stale agent registration from the manager, then recreate the agent. This does not delete Wazuh volumes:

```bash
docker exec -it single-node-wazuh.manager-1 /var/ossec/bin/manage_agents -r <AGENT_ID>

docker compose \
  -f wazuh-docker/single-node/docker-compose.yml \
  -f docker-compose.wazuh.yml \
  up -d wazuh.agent.safety-auth
```

Confirm enrollment:

```bash
docker exec single-node-wazuh.manager-1 /var/ossec/bin/agent_control -l
docker exec single-node-wazuh.agent.safety-auth-1 /var/ossec/bin/wazuh-control status
```

Expected:

```text
ID: 002, Name: safety-auth-docker-agent, IP: any, Active
wazuh-agentd is running...
wazuh-logcollector is running...
```

## Docker Log Tailer Fallback

The overlay includes `wazuh.safety-auth-log-tailer`, which reads Docker logs read-only and writes them to the named volume `safety-auth-docker-logs`. The tailer periodically rescans Docker `*-json.log` files so it continues to follow logs after the `safety-auth` container is recreated during local rebuilds. The agent reads this stable file as its only Safety Auth log source:

```xml
<localfile>
  <log_format>syslog</log_format>
  <location>/var/log/safety-auth-docker/docker-containers.log</location>
</localfile>
```

Check it with:

```bash
docker exec single-node-wazuh.agent.safety-auth-1 \
  tail -5 /var/log/safety-auth-docker/docker-containers.log
```

## OTP Redis Keys

Useful scoped checks while testing OTP behavior:

```bash
docker exec -it safety-redis redis-cli KEYS 'otp:*'
docker exec -it safety-redis redis-cli TTL 'otp:login:<email>'
docker exec -it safety-redis redis-cli TTL 'otp:resend:cooldown:login:<email>'
```

Key families:

```text
otp:register:<email>
otp:login:<email>
otp:attempts:register:<email>
otp:attempts:login:<email>
otp:locked:register:<email>
otp:locked:login:<email>
otp:resend:register:<email>
otp:resend:login:<email>
otp:resend:cooldown:<purpose>:<email>
```

OTP values are hashed; do not log OTP, password, JWT, SMTP secret, Redis password, or signing secrets.

## Runtime Notes

If `wazuh.manager` fails with a transient message like:

```text
wazuh-apid did not start correctly
```

restart only the manager and do not remove volumes:

```bash
docker compose \
  -f wazuh-docker/single-node/docker-compose.yml \
  -f docker-compose.wazuh.yml \
  restart wazuh.manager
```

If it repeats, check host memory and Wazuh Docker requirements before retrying. Wazuh single-node is memory-heavy.
