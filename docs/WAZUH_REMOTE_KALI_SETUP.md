# Triển Khai Wazuh Remote Cho Safety Auth

Tài liệu này dùng cho kiến trúc tách Wazuh khỏi máy chạy app:

```text
Ubuntu local hoặc EC2
├─ safety-auth
├─ safety-web
├─ postgres
├─ redis
├─ nginx
└─ Wazuh Agent

        -> VMware network hoặc Tailscale

Kali
├─ Wazuh Manager
├─ Wazuh Indexer
└─ Wazuh Dashboard
```

Không chạy full Wazuh trên EC2 yếu. EC2 chỉ chạy app chính và Wazuh Agent nhẹ.

## 1. Wazuh Agent Là Gì

Wazuh Agent là thành phần nhẹ cài trên máy cần giám sát. Trong project này, Agent chạy trên Ubuntu/EC2, đọc log Docker của `safety-auth`, rồi gửi event về Wazuh Manager trên Kali.

Agent không có dashboard, không chạy Wazuh Indexer, và không làm phần phân tích nặng. Phần parse decoder, rule, correlation, index và hiển thị dashboard nằm ở Kali Wazuh Manager/Indexer/Dashboard.

## 2. Flow Log

```text
Safety Auth stdout JSON
-> Docker json-file log
-> Wazuh Agent trên Ubuntu/EC2
-> VMware network hoặc Tailscale
-> Kali Wazuh Manager
-> Safety Auth decoder/rules
-> Wazuh Indexer
-> Wazuh Dashboard
```

Safety Auth đang ghi audit log JSON ra stdout. Docker lưu stdout của container theo dạng json-file tại:

```text
/var/lib/docker/containers/<container-id>/<container-id>-json.log
```

Agent config remote đọc:

```text
/var/lib/docker/containers/*/*-json.log
```

Custom decoder/rule hiện có dùng lại trên Kali Manager:

```text
wazuh-config/decoders/0510-safety-auth_decoders.xml
wazuh-config/rules/1010-safety-auth_rules.xml
```

## 3. Không Chạy Full Wazuh Trên EC2

Trên EC2 hoặc Ubuntu app server chỉ chạy app chính:

```bash
docker compose up -d --build
```

Không chạy lệnh Wazuh single-node cũ trên EC2:

```bash
docker compose -f wazuh-docker/single-node/docker-compose.yml -f docker-compose.wazuh.yml up -d
```

Lý do: Wazuh Manager/Indexer/Dashboard nặng, đặc biệt Wazuh Indexer cần RAM/disk/kernel setting nhiều hơn EC2 nhỏ thường có.

## 4. Local Test Ubuntu + Kali

Trên Ubuntu VM, chạy app chính:

```bash
cd /home/de180538_vutruonghuy/Project
docker compose config
docker compose up -d --build
docker compose ps
```

Trên Kali VM, chạy Wazuh:

```bash
cd /home/de180538_vutruonghuy/Project
docker compose -f docker-compose.kali-wazuh.yml config
docker compose -f docker-compose.kali-wazuh.yml up -d
docker compose -f docker-compose.kali-wazuh.yml ps
```

Nếu muốn đổi password lab mặc định, đặt biến môi trường local trên Kali hoặc dùng file `.env` không commit:

```text
KALI_WAZUH_INDEXER_USERNAME
KALI_WAZUH_INDEXER_PASSWORD
KALI_WAZUH_API_USERNAME
KALI_WAZUH_API_PASSWORD
KALI_WAZUH_DASHBOARD_USERNAME
KALI_WAZUH_DASHBOARD_PASSWORD
```

Ubuntu Agent trỏ tới IP Kali LAN, ví dụ:

```text
192.168.x.x
```

Kiểm tra Ubuntu ping được Kali:

```bash
ping <KALI_IP>
```

Sau đó thay placeholder trong agent config:

```text
KALI_WAZUH_MANAGER_IP_OR_TAILSCALE_DNS
```

bằng IP Kali LAN.

## 5. EC2 + Kali Qua Tailscale

Cài Tailscale trên EC2 và Kali theo hướng dẫn chính thức của Tailscale cho từng OS.

Trên Kali, lấy Tailscale IP:

```bash
tailscale ip -4
```

Trên EC2, kiểm tra thấy Kali trong tailnet:

```bash
tailscale status
ping <KALI_TAILSCALE_IP>
```

Thay `KALI_WAZUH_MANAGER_IP_OR_TAILSCALE_DNS` trong:

```text
wazuh-config/agent/ossec.remote-agent.conf
```

bằng Tailscale IP hoặc Tailscale DNS của Kali.

Không cần mở Wazuh Manager ra Internet public nếu dùng Tailscale. Kali có thể đổi WiFi/location nhưng Tailscale IP vẫn ổn định trong tailnet.

## 6. Cài Wazuh Agent Native Trên Ubuntu/EC2

Cài Wazuh Agent theo phiên bản tương thích với Wazuh server đang chạy trên Kali. Project đang dùng image Wazuh `4.14.0`, nên nên dùng agent cùng major/minor version.

Copy config remote vào agent:

```bash
sudo cp wazuh-config/agent/ossec.remote-agent.conf /var/ossec/etc/ossec.conf
```

Sửa IP/DNS Kali trong file thật:

```bash
sudo sed -i 's/KALI_WAZUH_MANAGER_IP_OR_TAILSCALE_DNS/<KALI_IP_OR_TAILSCALE_DNS>/g' /var/ossec/etc/ossec.conf
```

Start agent:

```bash
sudo systemctl enable --now wazuh-agent
sudo systemctl status wazuh-agent
```

Kiểm tra agent log:

```bash
sudo tail -f /var/ossec/logs/ossec.log
```

Nếu agent không đọc được Docker logs, kiểm tra quyền đọc:

```bash
sudo find /var/lib/docker/containers -name '*-json.log' -print | head
```

Không mount Docker socket cho agent. Agent chỉ cần đọc log Docker.

## 7. Kiểm Tra Kali Nhận Agent

Trên Kali, tìm tên container Manager:

```bash
docker compose -f docker-compose.kali-wazuh.yml ps
```

Kiểm tra agent:

```bash
docker exec -it <wazuh-manager-container> /var/ossec/bin/agent_control -l
```

Nếu agent bị duplicate name, chỉ xóa registration cũ bằng `manage_agents`, không xóa Docker volume.

## 8. Test End-To-End

Sinh log từ Safety Auth trên Ubuntu/EC2.

Login sai password:

```bash
curl -i -X POST http://localhost:3000/auth/login/request-otp \
  -H "Content-Type: application/json" \
  -d '{"username":"huy","password":"wrong-password"}'
```

Verify OTP sai:

```bash
curl -i -X POST http://localhost:3000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"test@gmail.com","otp":"000000"}'
```

Gọi `/auth/me` với token giả:

```bash
curl -i http://localhost:3000/auth/me \
  -H "Authorization: Bearer fake.token.value"
```

Spam request để trigger rate limit:

```bash
for i in 1 2 3 4; do
  curl -i -X POST http://localhost:3000/auth/register \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"rl$i\",\"email\":\"rl$i@gmail.com\",\"password\":\"password123\"}"
done
```

Kiểm tra app có log JSON:

```bash
docker compose logs --tail=80 safety-auth
```

Trên Kali, kiểm tra alert:

```bash
docker exec -it <wazuh-manager-container> sh -c \
  "grep 'auth.login.password.failed\|auth.otp.verify.failed\|auth.me.failed\|auth.rate_limit.exceeded' /var/ossec/logs/alerts/alerts.json | tail -20"
```

Trong Wazuh Dashboard, lọc:

```text
rule.groups:safety_auth
```

hoặc các event:

```text
auth.login.password.failed
auth.otp.verify.failed
auth.me.failed
auth.rate_limit.exceeded
```

## 9. Port Cần Dùng

Kali Wazuh Manager cần nhận từ Ubuntu/EC2:

```text
1514/tcp  agent events
1515/tcp  agent enrollment
```

Port quản trị:

```text
55000/tcp Wazuh API
443/tcp   Wazuh Dashboard
```

Không public các port này ra Internet nếu không cần. Ưu tiên chỉ cho phép qua VMware host-only/NAT lab network hoặc Tailscale.

## 10. Bảo Mật

- Không mở `1514`, `1515`, `55000`, `443` ra Internet public nếu không cần.
- Ưu tiên Tailscale cho EC2 -> Kali.
- Không commit `.env`.
- Không commit Wazuh password/API password thật.
- Không dùng chung secret app Safety Auth làm Wazuh password. Compose Kali dùng namespace `KALI_WAZUH_*` để tránh lẫn với `.env` của app.
- Không log password, OTP, JWT, SMTP secret, Redis password, `JWT_SECRET`, hoặc `OTP_SECRET`.
- Không mount Docker socket cho agent.
- Agent chỉ cần đọc Docker logs, không cần quyền cao hơn mức cần thiết.
- Không chạy `docker compose down -v`.
- Không xóa volume Wazuh/Postgres/Redis khi debug.

## 11. File Liên Quan

App chính trên Ubuntu/EC2:

```text
docker-compose.yml
```

Kali Wazuh server:

```text
docker-compose.kali-wazuh.yml
```

Remote native agent config:

```text
wazuh-config/agent/ossec.remote-agent.conf
```

Custom decoder/rule trên Kali Manager:

```text
wazuh-config/decoders/0510-safety-auth_decoders.xml
wazuh-config/rules/1010-safety-auth_rules.xml
```

Compose Wazuh lab cũ vẫn tồn tại nhưng không dùng trên EC2:

```text
wazuh-docker/single-node/docker-compose.yml
docker-compose.wazuh.yml
```
