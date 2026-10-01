# Claimix

Health insurance policy & hospital claims platform (India). Next.js App Router · TypeScript · PostgreSQL 16 · Drizzle · Zod · React Hook Form · CSS Modules (no Tailwind).

## Setup

```bash
cp .env.example .env.local        # then set SESSION_SECRET (32+ chars); SEED_DEMO_PASSWORD is for tests only
npm install
npm run db:up                      # Postgres 16 on localhost:5442 (Docker)
docker compose exec db psql -U claimix -c "create database claimix_test;"   # once, for integration tests
npm run db:migrate                 # applies pending migrations only; never drops data
npm run db:setup                   # system configuration only: roles, permissions, reason guidance
npm run admin:create -- --email you@example.org --name "Your Name"
                                   # first administrator; prints a one-time link to set the password
npm run dev                        # http://localhost:3000
npm run worker                     # background jobs: emails (.storage/outbox in dev), document re-scans,
                                   # daily policy-expiry reminders
```

The application starts empty: no demo organizations, users, patients, policies or statistics. After signing in,
the administrator adds hospitals, insurers/TPAs, government schemes (`/schemes/new`), medical codes
(`/admin/medical-codes`) and policies, and invites users (`/admin/users`). Dashboards and reports show zeros
and empty states until real records exist.

## Checks

```bash
npm run typecheck && npm run lint
npm test                    # unit
npm run test:integration    # PostgreSQL (uses TEST_DATABASE_URL, never the dev DB)
npm run build
npm run test:e2e            # Playwright, desktop + mobile (needs a prior build); uses its own
                            # database (E2E_DATABASE_URL, name must end in _e2e), created/migrated/seeded automatically
```

## Architecture

UI → Server Action / Route → Application Service → Domain → Repository → PostgreSQL.

- `modules/<name>/` — services, repositories, validation per business module
- `lib/permissions/` — permission catalog, `Principal`, `scopePredicate` (the single tenant-scoping rule)
- `lib/auth/session.ts` — Next.js cookie adapter over the framework-free `AuthService`
- `db/schema`, `db/migrations`, `db/setup` (system configuration; no sample data)
- `tests/fixtures/seed` — fictional fixture data loaded only into the isolated test databases
- Audit log, status history, payer responses and rule evaluations are append-only (DB triggers).

## Rules engine

`modules/rules/engine` is a pure, deterministic interpreter of declarative rule configs stored per policy
(`policies → rule_sets → rule_versions → rules`). Outcomes are `PASS | FAIL | NEEDS_VERIFICATION`;
a missing fact, an unknown/misconfigured rule, or a policy with no rules for a required category is never `PASS`.
Versions move `draft → active → retired`; rules of published versions can't be changed (DB trigger).
Every evaluation is recorded with policy, rule set, version, per-rule results, missing information and an input snapshot.

## Pre-authorization

`modules/preauth/preauth.workflow.ts` is the only definition of allowed status changes (`canTransition()`);
`PreauthService` applies every change through one `transition()` (timeline + audit + notifications, optimistic
status check). The 20-item checklist (`preauth.checklist.ts`) is recomputed on the server at submission.
Government-scheme decisions are recorded by the hospital's scheme desk with the scheme's reference number.

## Documents

Uploads: authorize → size → extension → magic-byte content check → scan (`modules/documents/scanner.ts`,
pluggable) → server-generated key → private storage (`STORAGE_LOCAL_DIR`, S3 adapter stub) → audit.
Downloads only via `/api/documents/[id]` (authorized, scoped, audited, `attachment`, sandboxed).

## Claims

`modules/claims` mirrors pre-authorization: its own state machine (`claims.workflow.ts`), a readiness
checklist on the shared checklist engine, and every status change through the shared `applyTransition()`
(`modules/workflow/transition.ts`). Cashless claims start from an approved pre-auth (one live claim each);
reimbursement claims from recorded coverage. Payer approval records the patient's share; settlement records
the payment (UTR), reduces the available sum insured, and moves the linked pre-auth to final approved / settled.
Database triggers refuse a "rejected" status without a payer rejection and "settled" without a paid settlement.

## Notifications, documents, audit

- In-app notifications per user (`/notifications`, unread badge in the top bar), created in the same transaction as the change.
- Payers verify documents or request re-upload; such documents stop counting as evidence. `/documents` lists requests missing mandatory documents.
- `/audit` (admin) views the append-only audit log; viewing it is itself audited.
- Services and repositories import `server-only`, so the build fails if browser code imports them.
- Browser (E2E) tests run with one worker against their own `_e2e` database loaded with test fixtures, so they never touch application data.

## Public site, dashboards, reports

- Public pages (`app/(public)`): landing, private insurance, government schemes (ABDM is described as digital-health
  infrastructure, not insurance), cashless vs reimbursement, Knowledge Center (16 guides) and a searchable glossary —
  content lives in `modules/knowledge` as typed data. The mobile menu and all search forms work without JavaScript.
- `/network`: anonymous Insurance/Scheme → City → Hospital search. Reference fields only; insurer networks and
  scheme empanelment are searched separately.
- `/register` creates an **access request** only (honeypot, per-IP limit, no account enumeration). Admins review
  them at `/admin/access-requests`; approving records the decision — accounts are still created by invitation.
- `/dashboard` is role-specific (admin, hospital, payer, patient, read-only); `/reports` gives status, money,
  monthly volume, turnaround and top query/rejection reasons, with CSV export. Every number comes from the same
  tenant-scoped queries as the list pages.

## Security notes

- Every server action and route authenticates, checks the permission and re-scopes ids to the caller's tenant.
  Administrative `*:manage` permissions are only honoured at platform ("all") scope.
- Rate limits: login (per email and per IP), password reset (per account, constant-time response), access requests (per IP).
- Client IPs come from `X-Forwarded-For` entries appended by trusted proxies only (`TRUSTED_PROXY_HOPS`, default 1).
  Run the app behind a reverse proxy that appends the client address (e.g. nginx `$proxy_add_x_forwarded_for`);
  never expose `next start` directly to the internet.
- Known limitations: the CSP still allows inline scripts (Next.js without nonces; no `dangerouslySetInnerHTML` is used);
  uploads are scanned synchronously by the built-in checks and re-scanned by the worker — plug a real antivirus
  engine into `modules/documents/scanner.ts` for production; the S3 storage adapter is a stub and is refused in production.

## Deployment

```bash
cp .env.example .env.production   # set real values; DATABASE_URL must use host "db", e.g. postgres://claimix:<pw>@db:5432/claimix
export POSTGRES_PASSWORD=<strong password>   # used by the db service; match it in DATABASE_URL
docker compose --profile app up -d --build   # db → migrate (one-off) → app (:3000) + worker
```

- One image runs the web app (`npm start`), the worker (`npm run worker`) and migrations (`npm run db:migrate`, additive only).
- Production refuses to start with the example `SESSION_SECRET`, `STORAGE_DRIVER=s3` or a non-https `APP_URL`
  (validated at boot in `instrumentation.ts`).
- Documents live on the `claimix_storage` volume; back it up together with the database.
- Postgres is published on `127.0.0.1:5442` only. `GET /api/health` reports app + database readiness (used by the image's HEALTHCHECK).
- After the first deploy run `npm run db:setup` and `npm run admin:create -- --email … --name …` once (e.g. `docker compose --profile app run --rm app npm run admin:create -- …`).
