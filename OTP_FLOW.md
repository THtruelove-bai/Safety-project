# OTP Flow

Safety Auth uses Redis-backed OTP for both registration and login. `OTP_TTL_SECONDS=60`, so each OTP is valid for 60 seconds.

## Register OTP

1. `POST /auth/register` validates username, email, and password.
2. The backend stores pending registration data in Redis for the OTP session window so the user can resend after a 60 second OTP expires.
3. The backend sends a 6 digit OTP by email.
4. `POST /auth/verify-otp` verifies the email OTP and creates the verified user.

If the OTP expires, the user can request a new code while the registration session is still active. If the pending registration session expires, the user must restart registration.

## Login OTP

1. `POST /auth/login/request-otp` validates username/password.
2. The backend sends a 6 digit OTP to the registered email.
3. `POST /auth/login/verify-otp` verifies the OTP and returns a JWT.

JWT Guard behavior is unchanged for `/auth/me` and protected flows.

## Resend OTP

`POST /auth/resend-otp` accepts:

```json
{
  "purpose": "register",
  "email": "user@gmail.com"
}
```

or:

```json
{
  "purpose": "login",
  "username": "huy"
}
```

For login, the backend looks up the user and sends OTP to the registered email. For register, the backend uses the pending registration email. The response does not include OTP or any secret.

Resend creates a new OTP, overwrites the old OTP hash in Redis, resets the OTP TTL to 60 seconds, and resets the current OTP attempt counter to 0.

## Resend Limits

Redis keys:

```text
otp:resend:register:<email>
otp:resend:login:<email>
otp:resend:cooldown:<purpose>:<email>
```

A user/email can resend at most 5 times per OTP session. Cooldown increases by resend count:

| Resend | Cooldown |
| ---: | ---: |
| 1 | 60 seconds |
| 2 | 60 seconds |
| 3 | 180 seconds |
| 4 | 300 seconds |
| 5 | 600 seconds |

After the fifth resend, further resend requests are blocked with:

```json
{
  "message": "Bạn đã yêu cầu gửi lại mã quá nhiều lần. Vui lòng thử lại sau."
}
```

If cooldown is active, the API returns HTTP 429 with `retryAfterSeconds`.

## OTP Attempts And Lock

Redis keys:

```text
otp:attempts:register:<email>
otp:attempts:login:<email>
otp:locked:register:<email>
otp:locked:login:<email>
```

Wrong OTP attempts 1 through 4 return a friendly invalid OTP message. On the fifth wrong OTP, the backend deletes the current OTP and locks that OTP session. The user must start registration again or log in again.

Lock response:

```json
{
  "message": "Bạn nhập sai quá nhiều lần, vui lòng đăng nhập lại."
}
```

## Redis Checks

Inside Redis, inspect keys with a scoped pattern only:

```bash
docker exec -it safety-redis redis-cli KEYS 'otp:*:<email>'
docker exec -it safety-redis redis-cli TTL 'otp:login:<email>'
docker exec -it safety-redis redis-cli TTL 'otp:resend:cooldown:login:<email>'
```

Do not log or expose OTP values. OTP is stored hashed.
