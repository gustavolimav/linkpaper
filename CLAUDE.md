# Papershare — Claude Code Context

## What this project is

Papershare is an open-source platform for document upload, sharing, and analytics.
Users upload documents, generate configurable sharing links, and see engagement data.
Stack: Next.js 14, TypeScript, PostgreSQL (raw SQL, no ORM), Jest integration tests.

---

## Architecture

```
pages/api/v1/   → HTTP delivery layer (route handlers, no business logic)
models/         → Domain/business logic (pure functions, no HTTP knowledge)
infra/          → Technical plumbing (DB client, error classes, middleware)
types/index.ts  → Single source of truth for all TypeScript interfaces
tests/          → Integration tests only (hit the live server + real DB)
```

**Rule:** business logic lives in `models/`, never in `pages/` or `infra/`.

---

## Autonomous development workflow (mandatory)

All feature/fix/refactor work — whether done by a human-directed session or an
autonomous agent cycle — goes through the **`tlc-spec-driven`** methodology,
vendored at `.claude/skills/tlc-spec-driven/` (from
[tech-leads-club/agent-skills](https://github.com/tech-leads-club/agent-skills),
`packages/skills-catalog/skills/(development)/tlc-spec-driven`). Load it by
name (`Skill` tool) rather than reading its files directly by path. It defines
four auto-sized phases — **Specify → (Design) → (Tasks) → Execute** — with
requirements written in EARS notation, requirement IDs traced through to
tests, one atomic Conventional Commit per task, and deterministic Python
gates (`scripts/validate_spec.py`, `validate_tasks.py`, `check_commit.py`,
`validate_state.py`) that must exit `0` before proceeding. Design and Tasks
are skipped for Small/Medium-sized work; Specify and Execute always run.
Every feature ends with an **independent Verifier** (author ≠ verifier) that
re-derives spec coverage from scratch and runs a discrimination-sensor
mutation test in an isolated `git worktree` (never `git stash`), writing
`.specs/features/[feature]/validation.md` with a PASS/FAIL verdict before the
feature is considered done. See the skill's own `SKILL.md` for full rules —
this section only records how it's wired into this repo.

### The agent team (`.claude/agents/`)

An autonomous cycle is orchestrated by the main session, which dispatches
role-scoped sub-agents matching the skill's phases:

| Agent          | Phase                       | Responsibility                                                                  |
| -------------- | --------------------------- | ------------------------------------------------------------------------------- |
| `spec-planner` | Specify (+ Discuss)         | Turns a chosen increment into `spec.md` (EARS ACs, priorities, requirement IDs) |
| `architect`    | Design (Large/Complex only) | Architecture, components, data model, file-level plan in `design.md`            |
| `task-planner` | Tasks (Large/Complex only)  | Breaks spec/design into atomic tasks + Test Coverage Matrix in `tasks.md`       |
| `implementer`  | Execute (batch worker)      | Implements one batch of tasks: test → code → gate → one atomic commit           |
| `verifier`     | Execute (final step)        | Independent PASS/FAIL verdict; never the same agent/context that implemented    |

The orchestrating session never implements code itself when a team is
running a cycle — it picks the increment, dispatches phases in order, and
enforces the gates between them. Sub-agent batching for Execute follows the
skill's own ~7-task-per-worker packing rule; batches run sequentially.

### External dependencies never block autonomous work

If an increment would need a real external account, credential, OAuth
consent, or other manual dashboard setup (a new payment/email/analytics/OAuth
provider, etc.) that only Gustavo can complete, an autonomous cycle must
**never** stop and wait for it. Instead:

1. Implement the feature behind a new or existing feature flag
   (`models/featureFlag.ts` — see Superadmin section below), **off by
   default**, exactly like `billing_stripe` today.
2. Provide a working local stub/mock for the code path exercised when the
   flag is off (or when the corresponding env var is unset), covered by
   tests — the same degrade-gracefully pattern already used by
   `infra/stripe.ts`, `infra/ai.ts`, and the mailer.
3. Record the exact manual step in `docs/TECH-DEBT.md`: what Gustavo needs to
   do by hand, which flag/env var to flip afterward, and how to validate it
   worked. Never leave this undocumented — the flag existing is not enough,
   the debt must be legible.

### Blast radius for autonomous cycles

An autonomous cycle works on a feature branch with local commits only. It
never merges or pushes to `main`, never deploys, and never touches a
production database or credential. Opening a PR (pushing the feature branch
and running `gh pr create`) is the one remote-visible action a cycle is
expected to take at the end, once tests/lint/typecheck are green — anything
beyond that (merging, force-push, infra changes) requires Gustavo.

---

## Database

- Raw SQL. No ORM. Use `database.query<T>({ text, values })` from `infra/database.ts`.
- Migrations are `.sql` files in `infra/migrations/`, run via `postgres-migrations`.
- Naming: `NNN-description.sql` (e.g. `004-create-documents.sql`).
- Always use parameterized queries (`$1`, `$2`, …). Never interpolate user input.
- Case-insensitive lookups: wrap column in `LOWER()` and pass `value.toLowerCase()`.

---

## Authentication

- Session-based (not JWT). Sessions stored in `sessions` table.
- `session_id` HTTP-only cookie holds the session token.
- Protect routes with `router.use(authMiddleware)` from `infra/auth.ts`.
- Authenticated request: cast to `AuthenticatedNextApiRequest` to access `req.user` and `req.session`.

---

## Superadmin access

- `users.is_superadmin` (boolean, default `false`) gates the `/superadmin/*`
  pages and lets a logged-in session run migrations without the
  `MIGRATIONS_SECRET` header (see `infra/auth.ts#migrationsAuthMiddleware`).
  Named "superadmin" (not "admin") specifically to keep it distinct from any
  future account-level/workspace "admin" role a customer might have — this
  flag is platform-operator access, not a product feature.
- There is **no API or UI to grant superadmin** — by design, so no one's
  email ends up hardcoded in a migration file in this public repo. To
  promote an account, run this once directly against the database (local
  `psql`, or your hosting provider's SQL console in prod):
  ```sql
  UPDATE users SET is_superadmin = true WHERE email = 'you@example.com';
  ```
- `/superadmin/feature-flags` — a superadmin-only kill switch for features
  that aren't ready for every user yet. `feature_flags` (`key`, `enabled`)
  works like `subscriptions`: absence of a row for a key means disabled,
  so shipping a new flag never needs a seed migration.
  `models/featureFlag.ts#requireEnabled(key)` throws the same
  `ServiceError` (503) shape as an unconfigured external service
  (`infra/stripe.ts`, `infra/ai.ts`) when a flag is off. Currently gates
  `billing_stripe` (checkout/portal) — off by default, so the Faturamento
  tab's subscribe/manage buttons redirect to `/em-breve` instead of
  calling the API, until a superadmin turns it on.

---

## Error handling

Use the custom classes from `infra/errors.ts`. Never throw plain `Error` objects.

| Situation                              | Class                       |
| -------------------------------------- | --------------------------- |
| Invalid input / missing required field | `ValidationError` (400)     |
| Not authenticated                      | `UnauthorizedError` (401)   |
| Resource not found                     | `NotFoundError` (404)       |
| DB / external service down             | `ServiceError` (503)        |
| Unexpected crash                       | `InternalServerError` (500) |

---

## Adding a new endpoint — checklist

1. Create migration if new table needed (`infra/migrations/NNN-*.sql`)
2. Add TypeScript types to `types/index.ts`
3. Implement model in `models/` (business logic + DB queries)
4. Create page handler in `pages/api/v1/` using `createRouter` from `next-connect`
5. Apply `router.use(authMiddleware)` if authentication required
6. Write integration tests in `tests/integration/api/v1/`

---

## Testing

- All tests are integration tests. They hit `http://localhost:3000` and a real PostgreSQL DB.
- Each test file starts with:
  ```ts
  beforeAll(async () => {
    await orchestrator.waitForAllServices();
    await orchestrator.cleanDatabase();
    await orchestrator.runPendingMigrations();
  });
  ```
- Use `orchestrator.createUser()` for test fixtures. Never hardcode UUIDs or passwords.
- Tests run with Docker + Next.js dev server. Start both before running: `npm test`.

### End-to-end (Playwright)

- `tests/e2e/*.spec.ts` — a second, separate suite (Playwright, not Jest)
  covering plan-gating (Free/Pro/Business) end-to-end: real browser
  interactions (disabled fields, inline upgrade messages, Faturamento tab)
  alongside direct backend assertions (402 status codes), so UI and API
  are checked together rather than the API alone. Run with `npm run
test:e2e`. `tests/e2e/helpers.ts` reuses `tests/orchestrator.ts` directly
  (same DB access, same `activateSubscription`) — Playwright tests run in
  plain Node, so the same fixtures work in both suites.
- `jest.config.js` excludes `tests/e2e/` (`testPathIgnorePatterns`) so Jest
  doesn't try to run Playwright's `.spec.ts` files as its own tests.
- Runs against `next dev` (on-demand compilation), not a production
  build — occasionally serves a corrupted chunk under rapid automated
  navigation (a known Next.js dev-mode HMR race, unrelated to application
  code; manifests as a page-crashing `SyntaxError` with no stack).
  `playwright.config.ts` sets `retries: 2` to absorb this — a test that
  fails for a real, reproducible reason fails identically on every retry
  too, so this doesn't mask genuine bugs.

---

## Key commands

```bash
npm run dev              # Start Docker + run migrations + start Next.js
npm test                 # Run full integration test suite
npm run test:e2e         # Run the Playwright end-to-end suite
npm run test:watch       # Watch mode
npm run sf               # Auto-fix formatting (Prettier + ESLint)
npm run lint:eslint:check # ESLint without fixing
npm run migrations:up    # Run pending migrations manually
npm run commit           # Interactive conventional commit (Commitizen)
```

---

## Definition of Done — mandatory before closing any task

Every task (feature, fix, refactor) is only considered complete when ALL of the following pass locally:

1. **Formatting** — `npm run sf` exits with no errors (Prettier + ESLint clean)
2. **Tests** — `npm test` passes with no failures (full integration suite against real DB)

Do not mark a task done, open a PR, or commit a "done" message until both commands exit 0.
If Docker is not running, start it first with `npm run services:up` before running tests.

---

## Code conventions

- Async/await everywhere. No `.then()` chains.
- Named exports for functions, default export for the model object.
- Model files export a single typed object: `export default modelName`.
- SQL: keywords uppercase, columns lowercase, one clause per line, trailing semicolon.
- No `console.log` in production code (use errors instead).
- Error messages in Portuguese (pt-BR). Internal/debug messages in English.
- Commits follow Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.

---

## Environment variables

| Variable                    | Purpose                                                                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_HOST`             | DB host                                                                                                                                                                                                                                  |
| `POSTGRES_PORT`             | DB port                                                                                                                                                                                                                                  |
| `POSTGRES_USER`             | DB user                                                                                                                                                                                                                                  |
| `POSTGRES_DB`               | DB name                                                                                                                                                                                                                                  |
| `POSTGRES_PASSWORD`         | DB password                                                                                                                                                                                                                              |
| `DATABASE_URL`              | Full connection string                                                                                                                                                                                                                   |
| `PEPPER`                    | Password hashing pepper (never change in prod) — one-way, used only for password hashing, never decrypted                                                                                                                                |
| `ENCRYPTION_KEY`            | 32-byte hex key for AES-256-GCM (`infra/encryption.ts`), used to encrypt/decrypt real reversible credentials at rest — currently each user's own Anthropic API key (never change in prod, or every stored key becomes undecryptable)     |
| `NODE_ENV`                  | `development` / `production` / `test`                                                                                                                                                                                                    |
| `MIGRATIONS_SECRET`         | Shared secret required via `x-migrations-secret` header on `/api/v1/migrations`                                                                                                                                                          |
| `STORAGE_ENDPOINT`          | S3-compatible endpoint (MinIO locally; unset for real AWS S3, R2 endpoint in prod)                                                                                                                                                       |
| `STORAGE_REGION`            | S3 region (dummy value accepted by MinIO)                                                                                                                                                                                                |
| `STORAGE_ACCESS_KEY_ID`     | S3-compatible access key                                                                                                                                                                                                                 |
| `STORAGE_SECRET_ACCESS_KEY` | S3-compatible secret key                                                                                                                                                                                                                 |
| `STORAGE_BUCKET`            | Bucket used for document uploads                                                                                                                                                                                                         |
| `STORAGE_FORCE_PATH_STYLE`  | `true` for MinIO (path-style addressing); unset/`false` for AWS S3                                                                                                                                                                       |
| `MAX_FILE_SIZE_MB`          | Max upload size in MB (set to `2` in `.env.development` for fast oversized-file tests; production should set its own higher value, e.g. 50)                                                                                              |
| `RESEND_API_KEY`            | Resend API key for transactional email (view notifications); unset makes the mailer a silent no-op                                                                                                                                       |
| `MAIL_FROM_ADDRESS`         | Sender address for outgoing email; unset falls back to Resend's shared test domain (`onboarding@resend.dev`)                                                                                                                             |
| `STRIPE_SECRET_KEY`         | Stripe API secret key; unset makes checkout/portal routes return `503` (`infra/stripe.ts#requireStripeConfigured`), same degrade-gracefully pattern as `ANTHROPIC`/`RESEND` keys                                                         |
| `STRIPE_WEBHOOK_SECRET`     | Signs/verifies `POST /api/v1/webhooks/stripe` — a local HMAC key, not a real Stripe credential, so it's safe to set a dummy value for local dev/CI (see `.env.development`)                                                              |
| `STRIPE_PRICE_ID_PRO`       | Stripe Price object ID for the Pro plan (created manually in the Stripe dashboard, in BRL) — only used by the webhook handler as a plain string match, so `.env.development` sets a dummy value for tests, no real Stripe account needed |
| `STRIPE_PRICE_ID_BUSINESS`  | Stripe Price object ID for the Business plan (created manually in the Stripe dashboard, in BRL) — same dummy-value-for-tests note as `STRIPE_PRICE_ID_PRO`                                                                               |

---

## Current state (as of 2026-07-16)

Completed: user registration, login, session auth middleware, profile get/update,
logout, authorization guards, soft-delete accounts, rate limiting, pre-Phase-3
security hardening, Phase 3 (documents: S3/MinIO-backed upload, validation,
CRUD API), Phase 4 (share links: CRUD, password/expiry/revocation, public
share endpoint), Phase 5 (analytics: view recording with 30-min dedup,
per-link and per-document aggregation), Phase 6 (full frontend: App
Router + Tailwind v4/shadcn foundation, auth forms, dashboard, document
detail/share links, public PDF viewer, analytics visualization, account
settings), Phase 7 (engagement/trust/growth: view notifications, per-page
heatmaps, composite engagement score, NDA gate, watermarking, email
allow-list, custom branding, OG meta tags, duplicate-link-settings), and
Phase 8 (AI features: auto-summarization, summary endpoint, viewer chat
(RAG) with SSE streaming, analytics insights, drop-off suggestions,
AI-drafted follow-up email suggestions — bring-your-own-key model, each
document owner pastes their own Anthropic API key in Settings
(encrypted at rest via `infra/encryption.ts`/`ENCRYPTION_KEY`), and every
AI feature on their documents runs against that key; features degrade
gracefully — fire-and-forget ones (summarization, insights) silently
no-op, synchronous ones (chat, follow-up email) return a clear `503` —
when the owner hasn't configured one).
Next up: Phase 9 (team workspaces & data rooms) or Phase 10
(monetization) — see `TODO.md` for the full phased roadmap and
`user-stories/phase-6-frontend/` for the per-block Phase 6 specs (each has
a 2026-07-13 alignment note reconciling it with the App Router / shadcn
decisions).
