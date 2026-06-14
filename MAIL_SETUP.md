# Safety Auth Mail Setup

Safety Auth sends registration and login OTP emails through generic SMTP using Nodemailer. The current production setup uses Brevo SMTP.

## 1. Create a Brevo sender

1. Sign in to Brevo.
2. Open **Settings** -> **Senders, Domains & Dedicated IPs** -> **Senders**.
3. Add a sender name and sender email address.
4. Verify the sender email by following Brevo's verification email.
5. Use the verified address as `MAIL_FROM_EMAIL`. Brevo may reject mail from unverified senders.

## 2. Get SMTP login and password

1. In Brevo, open **SMTP & API**.
2. Open the **SMTP** tab.
3. Copy the SMTP login into `MAIL_USER`.
4. Create or copy an SMTP key into `MAIL_PASSWORD`.
5. Keep the SMTP key secret. Do not commit real credentials to source control.

## 3. Fill `.env`

Use these variables for Brevo:

```env
MAIL_HOST=smtp-relay.brevo.com
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=your-brevo-smtp-login
MAIL_PASSWORD=your-brevo-smtp-key
MAIL_FROM_NAME=Safety
MAIL_FROM_EMAIL=your-verified-sender@example.com
```

`MAIL_SECURE=false` is correct for port `587` because Nodemailer connects with STARTTLS. The email `from` header is built as `"Safety" <your-verified-sender@example.com>`.

## 4. Restart backend

After changing `.env`, rebuild and restart the backend service:

```bash
docker compose up -d --build safety-auth
```

To restart without rebuilding after only changing `.env`:

```bash
docker compose up -d --force-recreate safety-auth
```

## 5. Test OTP email

Run the registration flow from the frontend or call the API directly with a new username and email:

```bash
curl -i -X POST http://localhost:3000/auth/register   -H 'Content-Type: application/json'   -d '{"username":"mailtest001","email":"your-test-email@example.com","password":"password123"}'
```

Expected result: the API returns a message that the registration OTP was sent, and the inbox receives a 6-digit Safety verification code.

## 6. View SMTP error logs

Use Docker logs while testing:

```bash
docker compose logs -f safety-auth
```

On SMTP failure, Safety Auth logs `mail.otp.send.failed` with only these SMTP fields: `name`, `code`, `command`, `responseCode`, `response`, and `message`. It must not log SMTP passwords, OTP values, JWTs, secrets, or API keys.
