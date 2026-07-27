# Phase 0 — Foundation: report

**Goal:** two companies, two domains, one app, provably isolated data.
**Status:** complete. Branch `phase-0-foundation`, 11 commits (`a07a0fc`..`d1032ef`), pushed.
**Date:** 2026-07-27 → 2026-07-28.

---

## Exit criteria

| Criterion | Status |
|---|---|
| `demo-a.localhost` and `demo-b.localhost` render different branded pages from one running app | Met — verified in headless Chromium at desktop and 375px; Demo Store A (ocean blue) and Demo Store B (sunset orange), same codebase |
| Creating a company through the API produces a fully usable store with zero manual steps | Met *for Phase 0's definition* — domain, working admin login, settings, default language. See deviation 2 below: a themed homepage needs Phase 1's `pages`/`sections` |
| Every isolation test passes against Oracle 19c EE | Met — 22/22 green against the live EE instance |
| Suspending a company shows the maintenance page within one cache TTL | Met, and better than required — suspension takes effect on the *next request*, not after a TTL, because the resolver caches only host→company_id and re-reads status per request |
| `npm run lint` and `npm test` clean | Met — lint clean, 26/26 integration tests green |
| `docs/DECISIONS.md` records any deviation | Met — 8 entries |

---

## What was built

| Task | Delivered |
|---|---|
| 1 | npm workspaces (`api`, `storefront`, `admin`, `superadmin`), shared ESLint flat config + Prettier, Vitest wiring, `.env.example`, README |
| 2+3 | `scripts/migrate.js` (custom runner, `migrations` tracking table, `--dry-run`), `001_init.sql` with the `sf_sec` PL/SQL package + VPD policies on all 6 company-owned tables, and `api/src/db/pool.js` — `withCompany()`/`withPlatform()`/`closePool()` |
| 4 | Tenant resolver (Host/X-Forwarded-Host → company via Redis, 5 min TTL, 404 unknown, 503 suspended), `reqId`, central `AppError` + error handler |
| 5 | `/auth` login, refresh (single-use rotating), logout (jti blacklist), me; `requireAuth`/`requireRole`; per-email login rate limiting; audit logging |
| 6 | `/media` upload (magic-byte MIME validation, 10MB cap, `sharp` → WebP at 320/640/1024/1600, EXIF stripped), list/patch/soft-delete/serve; `002_media.sql` |
| 7 | `/platform` company provisioning (single transaction), list/get/patch, suspend/activate, domains (with Redis cache-bust), impersonate, audit log listing |
| 8 | Super Admin SPA (React Router v7 + Tailwind): login, companies list, create form, company detail, audit log viewer |
| 9 | Next.js storefront rendering the resolved company's name/logo/theme; `scripts/seed-demo.js` provisioning the two demo stores |
| 10 | `api/tests/isolation/` — 22 tests across pool contract, media, auth/platform, and storefront routes |

**Test totals:** 26 integration + 22 isolation, all green against live Oracle 19c EE + Redis.

---

## Deviations from the brief

All eight are written up in `docs/DECISIONS.md`; the four that matter most:

1. **No Docker; native Oracle EE + native Redis.** The brief called for Oracle XE + Redis via `docker-compose.yml`. XE can't run VPD (`DBMS_RLS`) at all, which Task 3 requires — flagged before any code was written, and you approved moving to EE. It then turned out this host has no Docker installed *and* already runs Oracle 19c **Enterprise Edition** natively, so `docker-compose.yml` was dropped entirely. Redis was installed natively (open-source `tporadowski/redis` Windows port). Every local run therefore hits real EE, which makes the isolation gate meaningful by default rather than only at release time.

2. **Provisioning is descoped to Phase 0's tables.** `00-SYSTEM-DESIGN.md §6` lists 10 provisioning steps, but 4 of them write to `pages`, `sections`, `cats`, `menus`, `menu_items` — tables defined in Phase 1, not Phase 0. `POST /platform/companies` implements steps 1–5 and 10; **steps 6–9 must be added to the same endpoint in Phase 1**, which is the single most important carry-over item below.

3. **Media path guard is in Express, not Nginx.** Nginx doesn't enter the stack until Phase 3, so there was nothing locally to test an Nginx-layer guard against. The guard is real and tested — it just lives in the app for now.

4. **CI wiring deferred (your call).** The isolation suite exists and passes, but wiring it in as a blocking CI check needs an Oracle-access decision (throwaway EE container per run vs. exposing this shared dev box). Both options are written up in `docs/BACKLOG.md`. **Until that's done, `npm run test:isolation` is a manual pre-release gate, not an automated one** — this is the one place Phase 0 is weaker than the brief intended.

---

## Oracle-specific gotchas hit (all caught by running against the real DB, not by reading docs)

These cost real time and are worth knowing before Phase 1 writes more SQL:

- **Unquoted identifiers can't start with `_`** → the tracking table is `migrations`, not `_migrations` (`ORA-00911`).
- **`SIZE` is a reserved word** → `media.size_bytes`, not `size` (`ORA-00904`). It also bites as a *bind variable* name (`ORA-01745`), which is a separate, later failure.
- **`CREATE USER ... IDENTIFIED BY "pw"` parses the password as a quoted identifier**, so it's subject to the 30-byte identifier limit (`ORA-00972`).
- **Object grants alone don't let a second schema resolve unqualified table names** — `ecomm_platform` needs a synonym per table, refreshed whenever a table is added (`ORA-00942`). `scripts/setup-platform-user.js` maintains that list; **Phase 1 must add its new tables to it.**
- **`company_id IS NULL` rows can't be inserted through a VPD-covered connection** — `NULL = NULL` is unknown, not true, so `update_check` rejects it (`ORA-28115`). Platform-level rows must go through `withPlatform()`.
- **oracledb returns CLOBs as streams, not strings**, unless `fetchAsString = [oracledb.CLOB]` is set — now set globally in `pool.js`, so `settings.value`, `themes.tokens`, and `roles.perms` will just work in Phase 1.
- **oracledb's thin-mode bind counting rejects repeated named binds** alongside unrelated extra keys (`NJS-098`) — give each occurrence its own bind name in paginated list/count query pairs.

---

## Bugs found by actually running the app

Worth calling out because both were invisible to a green test suite:

- **`server.js` never called `initPool()`.** The real running API had no Oracle pool from Task 2 onward — every DB-touching route would have thrown. It stayed hidden because each integration test initializes its own pool in `beforeAll`, and the only prior real-server check (Task 1) hit `/health`, which touches no database. Caught the first time a browser drove a real login. Fixed, plus graceful pool/Redis shutdown on SIGINT/SIGTERM.
- **`storefront` never had Tailwind wired up.** Task 1 configured it for `admin` and `superadmin` only, so every utility class in the storefront JSX was inert. Invisible until Task 9's first screenshot.

The lesson for Phase 1: passing tests are not evidence the application runs. Both of these needed a browser pointed at a real server.

---

## What Phase 1 should watch out for

1. **Finish provisioning.** Add steps 6–9 of `00-SYSTEM-DESIGN.md §6` (default pages, home sections, starter categories, header/footer menus) to `POST /platform/companies` as soon as those tables land. Until then, "creating a company gives a usable store" is only true in the Phase 0 sense. This is the top carry-over.
2. **Every new table needs three things, not one:** a VPD policy in the same migration, a `GRANT ... TO sf_platform_role`, and an entry in `PLATFORM_TABLES` in `scripts/setup-platform-user.js` (for its synonym). Miss the third and `withPlatform` queries fail confusingly with `ORA-00942`. Miss the first and you have a silent data-leak hole.
3. **Extend the isolation suite alongside each new endpoint, not at the end.** The pattern is established in `api/tests/isolation/` — for each resource: B reads/updates/deletes A's id (404), B's list excludes A's rows, and a raw no-predicate SQL check under B's context proving VPD (not just the repo's `WHERE`) is filtering.
4. **Watch the `settings`/`themes`/`roles` CLOBs.** They're JSON-in-CLOB with `CHECK (col IS JSON)`. Reads now return strings thanks to the global `fetchAsString`, but writes still need `JSON.stringify`.
5. **Redis keys must stay `co:{id}:`-prefixed.** Phase 0 only added `host:{host}` (a platform-level lookup, correctly unprefixed) plus auth keys. Phase 1's settings/menus/section caches are company-owned and **must** carry the prefix.
6. **Mobile-first is not yet proven at Phase 1's bar.** Phase 0's UIs were checked at 375px and are responsive, but "function over beauty" was the Phase 0 standard. Phase 1's design bar (`themeathub.com`) and Lighthouse targets are a different exercise.
7. **The `admin` workspace is still a bare scaffold.** Only `superadmin` got a real UI in Phase 0; `admin/` is the Task 1 placeholder.

---

## Bootstrap sequence (for a fresh environment)

```bash
npm install
cp .env.example .env          # fill in real values
npm run setup:platform-user   # VPD-exempt DB user + synonyms (idempotent)
npm run migrate               # idempotent
npm run seed:platform-admin   # first role=platform login (idempotent)
npm run seed:demo             # two demo stores (idempotent)
npm run dev
```

`demo-a.localhost` / `demo-b.localhost` need hosts-file entries pointing at `127.0.0.1` (already added on this machine; Windows doesn't resolve `*.localhost` automatically).
