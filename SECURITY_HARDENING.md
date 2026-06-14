# Security Hardening

## Friendly Error Boundary

The frontend sanitizes API errors before rendering them. UI must not show exception classes, stack traces, raw backend errors, `ThrottlerException`, JWT contents, Redis errors, SMTP errors, or internal messages.

Rate limit responses shown to users use:

```text
Bạn thao tác quá nhiều lần. Vui lòng chờ một chút rồi thử lại.
```

OTP lock responses use:

```text
Bạn nhập sai quá nhiều lần, vui lòng đăng nhập lại.
```

## OTP Controls

- OTP TTL is 60 seconds (`OTP_TTL_SECONDS=60`).
- Resend OTP is capped at 5 resends per user/email and purpose.
- Resend cooldown increases: 60s, 60s, 180s, 300s, 600s.
- Wrong OTP attempts are capped at 5.
- On the fifth wrong OTP, the current OTP is deleted and the OTP session is locked.
- Login OTP lock clears `sessionStorage.safety_login_username` and sends the user back to login.
- Register OTP lock clears `sessionStorage.safety_register_email` and sends the user back to register.

## Rate Limits

Existing throttling remains enabled. `/auth/resend-otp` also has a framework rate limit of 5 requests per 15 minutes. Redis cooldown and resend counters are the primary OTP abuse controls; throttling is an additional safety layer.

## Secrets

Never log OTP, password, JWT, SMTP credentials, Redis password, `JWT_SECRET`, or `OTP_SECRET`. Security audit logs include event names, status, severity, username/email where appropriate, IP, user agent, and normalized reason only.

## Test Checklist

1. Register a new user and wait 60 seconds; old OTP fails.
2. Resend OTP once; a new OTP is generated and attempt counter resets.
3. Resend immediately again; UI shows cooldown.
4. Continue resends until the third resend; cooldown is 180 seconds.
5. Exceed 5 resends; API returns the friendly blocked message.
6. Enter wrong OTP 5 times; UI shows the lock message and redirects.
7. Verify that the old OTP no longer works after lock.
8. Spam verify/resend; UI never renders `ThrottlerException`.
