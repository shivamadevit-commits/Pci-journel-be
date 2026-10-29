# Authentication, OTP and rate limiting

## Flows (all under `/api/v1`)

### Author registration
1. `POST /auth/register` `{email, password, firstName, lastName, affiliation?, country?}` → **202**, always the same body (no account enumeration). An e-mail with a 6-digit OTP is sent.
2. `POST /auth/verify-email` `{email, otp}` → account becomes `ACTIVE`.
3. `POST /auth/resend-verification` `{email}` (generic response, cooldown applies).

Only Authors self-register. Staff accounts are created by the Chief Editor (`POST /admin/users`) and reviewers via application → approval; both receive a **set-password invitation link** (single-use, `INVITE_EXPIRY_HOURS`) handled by `POST /auth/reset-password`.

### Sign-in (OTP required by default, `LOGIN_OTP_REQUIRED=true`)
1. `POST /auth/login` `{email, password}`
   - success → `200 { otpRequired: true, challengeId, expiresAt, resendAvailableInSeconds }`. **No tokens are issued yet.**
   - wrong password / unknown e-mail / locked account → identical `401 INVALID_CREDENTIALS`. (Lock: `ACCOUNT_LOCK_THRESHOLD` failures → `ACCOUNT_LOCK_MINUTES`.)
   - correct password but unverified e-mail → `403 EMAIL_NOT_VERIFIED` (a new verification OTP is sent); deactivated → `403 ACCOUNT_DISABLED`.
   - if the OTP e-mail cannot be delivered → `503 EMAIL_DELIVERY_FAILED` (never reported as sent).
2. `POST /auth/login/verify-otp` `{challengeId, otp}` → `200 { accessToken, refreshToken, tokenType:"Bearer", accessTokenExpiresIn, refreshTokenExpiresAt, user }`.
   OTP: HMAC-hashed at rest, expires after `OTP_EXPIRY_MINUTES`, max `OTP_MAX_ATTEMPTS` guesses, single use.
3. `POST /auth/login/resend-otp` `{challengeId}` → new `challengeId` (old one is voided). Respects `OTP_RESEND_COOLDOWN_SECONDS` (429 otherwise).

With `LOGIN_OTP_REQUIRED=false`, step 1 returns the tokens directly (`otpRequired:false`).

### Tokens
- **Access token**: HS256 JWT (`iss`, `aud`, `sub`=user id, `sid`=session id), `JWT_ACCESS_EXPIRES_IN` (15 m). Send `Authorization: Bearer …`. Role is *not* trusted from the token — it is read from the DB per request, and the session + account status are re-checked.
- **Refresh token**: opaque random string, stored hashed, rotated on every use: `POST /auth/refresh {refreshToken}` → new pair. Re-using an already-rotated token revokes the whole session. (Hence there is no `JWT_REFRESH_SECRET`.)
- `POST /auth/logout` revokes the session immediately (access token stops working, not only at expiry).
- Error codes the frontend should handle: `TOKEN_EXPIRED` (refresh then retry), `TOKEN_INVALID`, `SESSION_INVALID` (sign in again).

### Forgot / reset / change password
- `POST /auth/forgot-password {email}` → always `200` with the same message; the e-mail is sent in the background so timing doesn't leak existence.
- `POST /auth/reset-password {token, newPassword}` → token is random (256-bit), hashed at rest, valid `PASSWORD_RESET_EXPIRY_MINUTES`, single use; all sessions are revoked; confirmation e-mail sent. The same endpoint completes invitations.
- `POST /auth/change-password {currentPassword, newPassword}` (authenticated) → other sessions revoked.
- Password policy: 10–128 chars with lowercase, uppercase and digit.

### Profile
`GET /auth/me`, `PATCH /users/me/profile`.

## Rate limits (429 `RATE_LIMITED`, `Retry-After` header)

Configured in `.env` (window ms / max): general API (300/15 min per IP), login (10/15 min per IP), OTP verify (10/15 min per IP+challenge), OTP resend (5/15 min), forgot password (5/h), reset password (10/15 min), registration (10/h), reviewer application (5/h), uploads (60/15 min per user). Authenticated requests are keyed by user id, others by client IP.

- Set **`REDIS_URL`** in any multi-instance deployment so counters are shared; without it limits are per process.
- Set **`TRUST_PROXY`** to the exact number of proxy hops (OCI Load Balancer = `1`). `true` is rejected in production, so a forged `X-Forwarded-For` cannot spoof client IPs.

## Logging
Passwords, OTPs, tokens, hashes and `Authorization` headers are redacted; query strings and headers are not logged; failures are audited without secrets.
