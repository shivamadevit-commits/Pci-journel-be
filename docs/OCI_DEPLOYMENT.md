# OCI deployment guide

## Target layout

```
Internet ─▶ OCI Load Balancer (TLS termination, health check /health)
              └─▶ 2+ API instances (OCI Compute VM / Container Instances / OKE) — container from ./Dockerfile
                    ├─▶ OCI Database with PostgreSQL (private subnet)
                    ├─▶ OCI Cache (Redis) — shared rate-limit store      (REDIS_URL)
                    ├─▶ OCI Object Storage (private bucket)               (STORAGE_DRIVER=oci)
                    └─▶ OCI Email Delivery (SMTP) or other SMTP relay     (SMTP_*)
```

## 1. Prepare services

1. **PostgreSQL**: create database + a least-privilege app user (CONNECT, CREATE on schema for migrations; use a separate migration user if you prefer). Put it in a private subnet; allow only the API subnet on 5432. Enable automatic backups / point-in-time recovery.
2. **Object Storage**: private bucket (no public access, no pre-authenticated requests). Create a **Customer Secret Key** for a dedicated IAM user limited to this bucket (`OCI_OS_ACCESS_KEY_ID` / `OCI_OS_SECRET_ACCESS_KEY`). The S3-compatible endpoint is `https://<namespace>.compat.objectstorage.<region>.oraclecloud.com` (derived automatically; override with `OCI_OS_ENDPOINT`). Files are only served through authorised API calls — never public URLs.
3. **Redis**: OCI Cache; set `REDIS_URL=rediss://…`. Required for globally consistent rate limiting with more than one instance.
4. **SMTP**: OCI Email Delivery — create approved sender + SMTP credentials; configure SPF/DKIM for the sender domain.
5. **Secrets**: keep `.env` values in OCI Vault (or instance-injected environment); never bake them into the image (`.dockerignore` excludes `.env*`).

## 2. Environment (production)

Set at least: `NODE_ENV=production`, `PORT`, `DATABASE_URL`, `JWT_ACCESS_SECRET` (≥ 32 random chars), `JWT_ISSUER`, `JWT_AUDIENCE`, `FRONTEND_URL` (https), `CORS_ORIGIN`, `TRUST_PROXY=1` (one LB hop; use the real hop count), `REDIS_URL`, `STORAGE_DRIVER=oci` + `OCI_OS_*`, `SMTP_*`, `EMAIL_FROM`, `SWAGGER_ENABLED=false` (or keep it behind VPN/WAF). The process refuses to start in production with local storage, `TRUST_PROXY=true`, a localhost frontend URL or a placeholder JWT secret. Full list: `.env.example`.

## 3. Build and publish the image

```bash
docker build --target runtime -t <region>.ocir.io/<tenancy-namespace>/pci-journal-api:<version> .
docker build --target migrate -t <region>.ocir.io/<tenancy-namespace>/pci-journal-migrate:<version> .
docker push …   # both
```

## 4. Safe database migration procedure

1. **Back up** (or confirm a recent automatic backup/PITR point).
2. Review the pending SQL (`prisma/migrations/*/migration.sql`) — it is plain SQL, reviewed in the PR that introduced it.
3. Run the migration as a **one-off job** (not on every container start, so rolling restarts can't race):
   ```bash
   docker run --rm --env-file prod.env <…>/pci-journal-migrate:<version>       # runs: prisma migrate deploy
   ```
   `migrate deploy` applies only pending migrations, never resets or drops data, and takes an advisory lock so concurrent runs are safe.
4. First deployment only: seed subject areas + the first admin: `docker run --rm --env-file prod.env <…>/pci-journal-migrate:<version> npm run seed` (set `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`, then change the password and unset them).
5. Roll the API instances (rolling update). Schema changes must be backward compatible with the previous app version (expand → deploy → contract).
6. Check state any time: `npm run prisma:status`.

Never run `prisma migrate reset`, `db push --force-reset` or `migrate dev` against production.

## 5. Load balancer / runtime

- Health check: `GET /health` (liveness). `GET /ready` checks DB + storage (use for readiness / deployment gates, returns 503 when a dependency is down).
- Idle timeout ≥ 65 s (server keep-alive is 61 s). Max body ≈ `MAX_UPLOAD_MB` + overhead for multipart.
- Graceful shutdown: SIGTERM stops accepting connections, drains in-flight requests, closes DB/Redis (25 s hard limit) — set the termination grace period ≥ 30 s.
- Logs: JSON on stdout/stderr → OCI Logging agent. Every line carries `requestId`.
- Run ≥ 2 instances; background e-mail retry and housekeeping jobs are safe to run on all instances (atomic claims).

## 6. Post-deployment checklist

- [ ] `/ready` returns 200 behind the LB; `/api/docs` is not publicly reachable
- [ ] Admin can sign in with OTP e-mail (SMTP works) and the admin password was changed
- [ ] Upload a .docx → object appears in the bucket under `manuscript/…`, bucket is private
- [ ] Rate limit headers (`RateLimit`) present; counters shared across instances (Redis)
- [ ] `TRUST_PROXY` hop count verified: client IP in logs is the real client, not the LB
- [ ] Backups restored in a test environment at least once
