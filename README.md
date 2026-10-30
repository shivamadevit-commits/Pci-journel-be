# PCI / DigiPharmed Journal Portal — Backend

Express + TypeScript + PostgreSQL (Prisma) API implementing the BRD/FRD v1.0 workflow: article submission, editorial screening, plagiarism check, manual two-reviewer allocation, double-blind peer review, final decision, production/proofing, and HTML/PDF publication.

## Documentation map

| Doc | Content |
|---|---|
| [`docs/API.md`](docs/API.md) · [`docs/openapi.json`](docs/openapi.json) · `/api/docs` | Every endpoint: method, path, role access, request fields + validation, success and error responses (generated from code) |
| [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md) | Role / permission matrix + row-level rules (generated) |
| [`docs/WORKFLOW.md`](docs/WORKFLOW.md) | Statuses, allowed transitions, prerequisites, business rules |
| [`docs/AUTH.md`](docs/AUTH.md) | Registration, login + OTP, refresh, reset flows and the frontend contract |
| [`docs/DOUBLE_BLIND.md`](docs/DOUBLE_BLIND.md) | How anonymity is enforced and where each identity can/can't appear |
| [`docs/EMAIL_NOTIFICATIONS.md`](docs/EMAIL_NOTIFICATIONS.md) | Notification catalogue, delivery and retry semantics |
| [`docs/AUDIT.md`](docs/AUDIT.md) | Audit schema, event catalogue, tamper protection |
| [`docs/OCI_DEPLOYMENT.md`](docs/OCI_DEPLOYMENT.md) | OCI deployment guide + safe migration procedure |
| [`docs/PCI_OPEN_ITEMS.md`](docs/PCI_OPEN_ITEMS.md) | Decisions / integrations still awaiting PCI confirmation |

## Architecture

```
src/
  config/       env (zod-validated, fail-fast), logger (pino, redaction), prisma client
  constants/    roles, workflow statuses + transition table
  routes/       endpoint definitions (path, roles, schemas, rate limit, upload spec) — one registry drives routing AND docs
  controllers/  thin HTTP adapters: validated input → service → response
  services/     all business logic (workflow, auth, review, production, publication, payment, plagiarism, audit, notifications…)
  validators/   zod request schemas (body / query / params)        schemas/  shared zod primitives
  middlewares/  auth (JWT + live session check), RBAC, rate limiting, upload sniffing, request id, error handler
  providers/    payment + plagiarism integration interfaces (no vendor invented)
  storage/      local + OCI Object Storage drivers
  templates/    e-mail content and links (no logic)
  jobs/         e-mail retry + housekeeping
prisma/         schema.prisma, migrations/, seed.ts
```

Key design points: a single `workflow.service.transitionArticle()` is the only code that changes an article's status (edge validation + prerequisites + optimistic guard + history + audit, all in one transaction); every endpoint is protected by `route({ roles })` middleware and the services add row-level checks; request bodies are parsed by zod (unknown keys dropped) and fields are mapped explicitly into Prisma calls.

## Setup (local)

Requirements: Node ≥ 20, PostgreSQL ≥ 14.

```bash
npm install
cp .env.example .env                 # then edit DATABASE_URL, JWT_ACCESS_SECRET, SMTP_* …
npm run prisma:generate              # generate Prisma Client
npm run prisma:migrate:dev           # dev only: applies prisma/migrations/* to your local DB
npm run seed                         # subject areas (BRD §5) + first Admin (SEED_ADMIN_*)
npm run dev                          # http://localhost:4000  (docs: /api/docs)
```

`prisma/migrations/20261028000000_init/migration.sql` contains every table, enum, index, foreign key and constraint, plus database-level rules Prisma cannot express (append-only audit log, locked submitted reviews, one live assignment per reviewer/slot). **No manual table creation in pgAdmin is needed.**

Generate a fresh JWT secret: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.

### Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Watch mode (tsx) |
| `npm run build` / `npm start` | Generate client + compile to `dist/`; run compiled server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run prisma:migrate:create` | Create a new migration from schema changes **without applying it** (review the SQL first) |
| `npm run prisma:migrate:dev` | Apply migrations in development |
| `npm run prisma:migrate:deploy` | Apply pending migrations in deployment (never resets) |
| `npm run prisma:status` | Show applied/pending migrations |
| `npm run prisma:studio` | Inspect data |
| `npm run seed` | Idempotent seed |
| `npm run docs:generate` | Regenerate `docs/API.md`, `docs/PERMISSIONS.md`, `docs/openapi.json` |

Never run `prisma migrate reset` or `db push --force-reset` against a database that contains data.

## Configuration

All configuration comes from environment variables (see `.env.example`, validated at start-up — the process exits with a clear message if anything required is missing or unsafe, e.g. `STORAGE_DRIVER=local` or a localhost `FRONTEND_URL` in production). Journal rules (word limit, APC enforcement, revision policy, review due days, required publication metadata, reviewer eligibility years) can additionally be changed at runtime by the Admin through `PUT /api/v1/admin/config` (audited); `.env` provides the defaults.

## Security summary

- Passwords: bcrypt (cost 12). OTPs: keyed HMAC, single use, expiring, attempt-limited. Reset/invite/refresh tokens: random, only SHA-256 hashes stored.
- JWT: HS256 only, issuer + audience verified, short expiry; every request re-checks the session and account status in the DB (logout, deactivation and role changes apply immediately). Refresh tokens rotate; reuse of a rotated token revokes the session.
- Rate limiting per endpoint class (Redis-backed when `REDIS_URL` is set), trusted-proxy hop count, Helmet, strict CORS allow-list, body-size limits, upload content sniffing (magic bytes + OOXML structure, macro and zip-bomb guards).
- Double-blind enforced in the API layer (separate DTOs, neutral reviewer filenames, scrubbed document metadata, comment moderation) — see `docs/DOUBLE_BLIND.md`.
- Append-only audit trail enforced by database triggers.

## Out of scope / not invented

Payment gateway, APC amount, plagiarism vendor, review form scoring and deadlines are PCI decisions; clean interfaces and manual-entry fallbacks are provided (`docs/PCI_OPEN_ITEMS.md`). Automatic reviewer allocation and citation scores are excluded by the BRD.
