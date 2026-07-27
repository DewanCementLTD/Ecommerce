# Phase 0 — Foundation

**Goal:** two companies, two domains, one app, provably isolated data.
**Estimated:** 3 weeks. Branch: `phase-0-foundation`.

> Read `CLAUDE.md` and `00-SYSTEM-DESIGN.md` before starting. Work through the tasks in order. After each numbered task: run tests, run lint, commit. Do not start Phase 1 work.

---

## Start here

1. Enter plan mode and produce a task-by-task plan for this phase. Show it to me before writing code.
2. Flag anything in this document you think is wrong or risky. I would rather argue now than refactor later.
3. Confirm you understand: **plain JavaScript, no TypeScript.**

---

## Task 1 — Repo skeleton

Create the layout from `CLAUDE.md`. Set up:

- root `package.json` with npm workspaces (`api`, `storefront`, `admin`, `superadmin`)
- ESLint + Prettier, shared config, `npm run lint` at root
- Vitest at root, `npm test` and `npm run test:isolation` scripts
- `.env.example` with every variable documented, `.env` gitignored
- `docker-compose.yml`: Oracle XE, Redis (dev only)
- `README.md`: how to run it locally in under 5 commands
- `docs/DECISIONS.md`: empty log with a template entry

**Done when:** `npm install && npm run dev` starts API + storefront + admin with no errors.

---

## Task 2 — Oracle connection + company context

This is the most important code in the project. Build it carefully and test it hard.

Create `api/src/db/pool.js`:

```js
// Required exports
initPool()                        // oracledb pool, sized from env
withCompany(companyId, fn)        // borrow → set context → run fn → clear → release
withPlatform(fn)                  // separate DB user, VPD-exempt, for super admin
closePool()
```

Requirements:

- Context set via `DBMS_SESSION.SET_CONTEXT('sf_ctx','company_id', :id)` through a secured package (`sf_sec`), never directly from the app user.
- Context **always** cleared in a `finally` block, including when `fn` throws.
- `withCompany` refuses to run if `companyId` is null/undefined — throw immediately.
- Structured logging of borrow/release at debug level with `req_id`.

Write `api/tests/isolation/pool.test.js` proving:
- context is set correctly inside the callback,
- context is cleared after a normal return,
- context is cleared after a thrown error,
- two sequential `withCompany` calls with different ids never see each other's context.

**Done when:** those four tests pass against a real Oracle instance.

---

## Task 3 — Migration runner + core schema

Build `scripts/migrate.js`: reads `api/src/db/migrations/*.sql` in filename order, tracks applied ones in a `_migrations` table, runs inside transactions, supports `--dry-run`. No third-party migration tool — Oracle support in them is weak.

Write `001_init.sql` creating:

- `_migrations`
- the `sf_sec` PL/SQL package: `set_company`, `clear_company`, `company_predicate` (the VPD policy function), `is_platform`
- `companies` — id, name, biz_name, email, phone, logo_media_id, theme_id, currency, timezone, status (`active|suspended`), created_at, updated_at
- `domains` — id, company_id, host (unique), is_primary, created_at
- `themes` — id, code, name, tokens (CLOB JSON), is_active
- `admins` — id, company_id (NULL = platform user), email, pass_hash, name, role, is_active, last_login_at
- `roles` — id, company_id, code, name, perms (CLOB JSON)
- `settings` — id, company_id, key, value (CLOB), unique (company_id, key)
- `langs` — id, company_id, code, name, is_default, is_active
- `logs` — id, company_id, admin_id, action, entity, entity_id, meta (CLOB JSON), ip, created_at

Apply VPD policies to every company-owned table in the same migration. Add indexes: `domains(host)`, `admins(company_id, email)`, `settings(company_id, key)`, `logs(company_id, created_at)`.

**Done when:** `npm run migrate` is idempotent — running twice changes nothing.

---

## Task 4 — Tenant resolver middleware

`api/src/middleware/tenant.js`:

- read `Host` (respect `X-Forwarded-Host` from Nginx),
- strip port, lowercase, strip leading `www.`,
- look up in Redis `host:{host}` → `company_id`; on miss, query `domains` via `withPlatform`, then cache 5 min,
- unknown host → 404 with the platform's "site not found" JSON/page,
- company suspended → 503 with maintenance payload,
- attach `req.companyId`, `req.company` (id, name, status, theme, currency, default lang).

Also build `api/src/middleware/reqId.js` (uuid per request, into logs) and `api/src/middleware/error.js` (single error handler; `AppError` class with `status`, `code`, `message`; never leak stack traces in production).

**Done when:** two seeded hosts resolve to two different companies, an unknown host 404s, and a suspended company returns the maintenance response.

---

## Task 5 — Auth

- `POST /auth/login` — email + password, argon2id verify, returns access (15 min) + refresh (7 days) tokens. JWT payload: `sub`, `company_id` (null for platform), `role`, `jti`.
- `POST /auth/refresh` — rotating refresh tokens, old token invalidated in Redis.
- `POST /auth/logout` — blacklist jti until expiry.
- `GET /auth/me`.
- `requireAuth` and `requireRole(...roles)` middleware. Company admins are locked to their own `company_id`; a token's `company_id` **overrides** any id in the URL or body. Never trust a client-supplied company id.
- Rate limit: 5 failed logins per email per 15 min, then lockout with a clear message.
- Log every login, failed login, and logout to `logs`.

**Done when:** a Company A token cannot read Company B data through any auth-protected route, and the isolation test proves it.

---

## Task 6 — Media upload

- `POST /media` — multipart, images only (`jpg|png|webp|avif`), max 10MB, validated by magic bytes not extension.
- Re-encode with `sharp` to WebP; generate widths 320/640/1024/1600; strip metadata.
- Store at `media/{company_id}/{yyyy}/{mm}/{uuid}-{w}.webp`. Row in `media`: id, company_id, filename, alt, mime, size, width, height, folder, created_at.
- `GET /media` — paginated, searchable, filter by folder.
- `PATCH /media/:id` — alt text, folder. `DELETE /media/:id` — soft delete.
- Serving: through Nginx with a path guard so `company_id` in the path must match the resolved company for private contexts.

Add `media` table + VPD policy in `002_media.sql`.

**Done when:** an image uploads, thumbnails generate, and Company A cannot fetch or list Company B's media.

---

## Task 7 — Super Admin API: company provisioning

`POST /platform/companies` — the one-screen create. In a **single transaction**, do all ten steps from `00-SYSTEM-DESIGN.md §6`. Roll back entirely on any failure.

Also:
- `GET /platform/companies` (list, search, status filter)
- `GET/PATCH /platform/companies/:id`
- `POST /platform/companies/:id/suspend` and `/activate`
- `POST /platform/companies/:id/domains`, `DELETE /platform/domains/:id` (busts Redis cache)
- `POST /platform/companies/:id/impersonate` — issues a short-lived scoped token, writes an audit log entry, never returns the client's password

All platform routes require `role = platform` and use `withPlatform`.

**Done when:** one API call creates a company that immediately has a homepage, menus, categories, settings, and a working admin login.

---

## Task 8 — Super Admin UI (minimal)

React + Vite + Tailwind. Screens: login, companies list, create company form, company detail (settings, domains, suspend/activate), audit log viewer. Function over beauty in this phase — but responsive and keyboard-accessible.

---

## Task 9 — Storefront "hello store"

Next.js app that, for the resolved company, renders a page showing that company's name, logo and theme colors pulled from the API. This proves the whole chain end to end.

Set up local host aliases (`demo-a.localhost`, `demo-b.localhost`) so both stores are reachable in dev.

---

## Task 10 — Isolation test suite (the release gate)

`api/tests/isolation/` — seeds Company A and Company B, then for **every** existing endpoint:

- A reads B's resource by id → expect 404
- A updates B's resource → expect 404
- A deletes B's resource → expect 404
- A lists resources → B's rows never appear
- direct repo call with A's context cannot select B's rows (proves VPD, not just app code)

Wire `npm run test:isolation` into CI as a blocking check. Add a README note: **this suite must be run against Oracle EE, not XE**, because XE has no VPD.

---

## Phase exit criteria

- [ ] `demo-a.localhost` and `demo-b.localhost` render different branded pages from one running app.
- [ ] Creating a company through the API produces a fully usable store with zero manual steps.
- [ ] Every isolation test passes against Oracle 19c EE.
- [ ] Suspending a company shows the maintenance page within one cache TTL.
- [ ] `npm run lint` and `npm test` are clean.
- [ ] `docs/DECISIONS.md` records any deviation from this brief.

Then write `docs/PHASE-0-REPORT.md`: what was built, what deviated and why, what Phase 1 should watch out for.
