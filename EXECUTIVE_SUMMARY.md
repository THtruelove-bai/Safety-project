# EXECUTIVE SUMMARY - Safety Auth

**Du an:** Safety Auth  
**Ngay cap nhat:** 2026-06-03  
**Muc dich tai lieu:** Bao cao tien do ngan gon cho giang vien/quan ly du an.

---

## 1. Tong quan

Safety Auth la mot he thong xac thuc nguoi dung duoc xay dung theo kien truc web hien dai, gom frontend React/Vite, backend NestJS, database PostgreSQL, Redis cho OTP, Gmail SMTP de gui ma xac thuc, Nginx reverse proxy va moi truong Docker Compose de van hanh dong bo. Muc tieu chinh cua du an la tao mot luong dang ky/dang nhap an toan hon dang nhap mat khau truyen thong, bang cach bat buoc xac thuc OTP qua email trong ca qua trinh dang ky va dang nhap.

He thong hien tai da hoan thanh duoc cac flow nghiep vu cot loi:

- Nguoi dung dang ky bang username, email va password.
- Backend luu user vao PostgreSQL, password duoc hash bang scrypt, khong luu plaintext.
- Backend tao OTP 6 chu so, hash OTP bang HMAC va luu tam trong Redis voi TTL.
- OTP duoc gui toi email nguoi dung bang Gmail SMTP.
- Sau khi verify OTP dang ky thanh cong, nguoi dung duoc cap JWT va vao thang dashboard.
- Dang nhap su dung username/password, sau do gui OTP ve email da dang ky cua username do.
- Sau khi verify OTP dang nhap thanh cong, frontend luu token va chuyen toi dashboard.
- Docker Compose co the khoi dong toan bo he thong bang mot lenh `docker compose up -d`.

Ngoai Safety Auth, project con chua source `wazuh-docker` de phuc vu giai doan tich hop giam sat bao mat/SIEM sau nay. Wazuh hien chua duoc noi vao compose chinh va chua tac dong den luong xac thuc hien tai.

---

## 2. Kien truc hien tai

He thong duoc chia thanh cac thanh phan chinh:

1. **Safety Web**: frontend React/Vite, chay o port 5173. Day la noi nguoi dung thao tac register, verify OTP, login va dashboard.
2. **Safety Auth**: backend NestJS, chay o port 3000. Day la API xu ly authentication, OTP, JWT, database va email.
3. **PostgreSQL**: luu bang `users`, gom id, username, email, passwordHash, isEmailVerified, createdAt, updatedAt.
4. **Redis**: luu OTP tam thoi bang key `otp:register:<email>` va `otp:login:<email>`. OTP duoc hash, khong luu plaintext.
5. **Gmail SMTP**: gui ma OTP cho nguoi dung.
6. **Nginx**: reverse proxy den backend, phuc vu muc tieu domain `auth.safety.vn` trong giai doan sau.
7. **Wazuh Docker source**: stack Wazuh Manager, Indexer, Dashboard de tich hop monitoring/log security trong giai doan tiep theo.

Kien truc nay tach ro frontend/backend/database/cache, phu hop cho giai doan prototype va co kha nang mo rong thanh production neu bo sung hardening.

---

## 3. Ket qua da hoan thanh

### Backend

Backend `safety-auth` da co cac endpoint:

- `POST /auth/register`: tao user va gui OTP dang ky.
- `POST /auth/verify-otp`: xac thuc OTP dang ky, mark email verified va tra JWT.
- `POST /auth/login/request-otp`: nhan username/password, kiem tra user va gui OTP dang nhap ve email da dang ky.
- `POST /auth/login/verify-otp`: xac thuc OTP dang nhap va tra JWT.
- `POST /auth/login`: endpoint cu dang con ton tai, login bang email/password va tra token ngay.

Password duoc hash bang scrypt voi random salt. OTP duoc tao bang random integer 6 chu so, hash bang HMAC-SHA256 voi secret tu env va luu Redis theo TTL mac dinh 300 giay. JWT access token duoc tao tu `JWT_SECRET`, payload gom `sub` va `email`, expiration mac dinh `1d`.

### Frontend

Frontend `safety-web` da co cac man hinh:

- `/register`: dang ky account Safety.
- `/verify-otp`: xac thuc OTP sau dang ky.
- `/login`: dang nhap bang username/password.
- `/login-otp`: xac thuc OTP dang nhap.
- `/dashboard`: man hinh dang nhap thanh cong, co nut logout.

Giao dien dung card giua man hinh, responsive, mau sac gon, brand Safety, co error/loading state. Frontend dung `fetch`, khong dung axios. Token duoc luu vao `localStorage`, email/username tam duoc luu vao `sessionStorage`.

### Docker

Compose chinh hien chay duoc:

- `safety-auth`
- `safety-web`
- `postgres`
- `redis`
- `nginx`

Lenh khoi dong:

```bash
cd /home/de180538_vutruonghuy/Project
docker compose up -d
```

Frontend mo tai `http://localhost:5173`, backend tai `http://localhost:3000`.

---

## 4. Trang thai Wazuh

Wazuh hien co source trong `wazuh-docker`, bao gom single-node, multi-node, wazuh-agent, indexer cert creator va docs. Stack nay gom Wazuh Manager, Wazuh Indexer va Wazuh Dashboard. Tuy nhien Wazuh chua duoc gop vao compose chinh va chua thu thap log tu Safety Auth.

Huong tich hop de xuat la: Safety Auth sinh application logs, Docker/Wazuh Agent thu thap logs, gui ve Wazuh Manager, sau do index vao Wazuh Indexer va hien thi tren Wazuh Dashboard. Giai doan nay nen lam sau khi authentication flow on dinh va co audit log co cau truc.

---

## 5. Rui ro va van de ton tai

Cac rui ro chinh can xu ly truoc production:

1. **Secret management**: `.env` dang chua password DB, Redis, Gmail app password, JWT secret. Can khong commit len repo public va nen dung secret manager khi deploy.
2. **TypeORM synchronize**: mac dinh `synchronize=true`, tien loi dev nhung khong an toan production.
3. **Endpoint login cu**: `/auth/login` con ton tai va bypass OTP. Neu yeu cau bat buoc OTP, can disable hoac gioi han endpoint nay.
4. **Chua co rate limit**: register, request OTP va verify OTP chua co gioi han theo IP/email/username.
5. **Chua co refresh token**: access token het han thi user phai login lai.
6. **Dashboard guard moi o frontend**: dashboard chi kiem tra token co trong localStorage, chua validate voi backend.
7. **Frontend dev server trong Docker**: phu hop dev/demo, chua phu hop production. Nen build static va serve bang Nginx.
8. **Chua co audit log**: chua ghi nhan failed login, OTP failures, login success de phuc vu monitoring.
9. **Wazuh chua tich hop that**: source co san nhung chua co pipeline log tu app sang Wazuh.

---

## 6. De xuat giai doan tiep theo

### P1 - Uu tien cao

- Them rate limit cho register/login/request OTP/verify OTP.
- Tat hoac bao ve endpoint `/auth/login` cu de khong bypass OTP.
- Them JWT Guard va endpoint `/auth/me` de frontend validate session that.
- Tao `.env.example` root va khong de secret that trong repo.
- Them `.dockerignore` cho backend de Docker build nhanh va gon hon.

### P2 - Hoan thien ung dung

- Tach frontend thanh `pages`, `components`, `services`.
- Dung React Router cho routing va protected route.
- Them resend OTP co cooldown.
- Them audit log table va service ghi su kien auth.
- Them test e2e cho register/verify/login OTP.
- Tao Dockerfile production cho `safety-web`, serve static bang Nginx.

### P3 - Bao mat va Wazuh

- Tich hop Wazuh Agent hoac Docker log shipping.
- Tao Wazuh rules/dashboard cho failed login, OTP brute force, suspicious activity.
- Them TLS production cho Nginx.
- Them refresh token rotation va revoke token.
- Them CI build/test.

---

## 7. Danh gia muc do hoan thien

Du an hien dat khoang **65% cho muc tieu prototype/demo Safety Auth**. Cac flow cot loi da hoat dong: dang ky, OTP, login OTP, dashboard, Docker Compose. Giao dien va backend deu da co kha nang demo thuc te.

Neu danh gia theo muc tieu production-ready security platform, du an dat khoang **40%**, vi con thieu rate limit, audit log, refresh token, JWT guard, secret hardening, production frontend serving va Wazuh integration that.

Ket luan: Safety Auth hien da du dieu kien de demo flow xac thuc nguoi dung end-to-end. Giai doan tiep theo nen tap trung vao bao mat, logging, monitoring va production hardening.
