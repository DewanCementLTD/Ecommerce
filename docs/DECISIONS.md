# Decisions log

Non-obvious choices that deviate from or clarify the phase briefs, in date order. Newest at the bottom.

---

## Template

**Date:** YYYY-MM-DD
**Phase / Task:** phase-N, Task M
**Decision:** what was decided
**Why:** what problem this solves / what constraint forced it
**Alternatives considered:** what else was on the table and why it lost

---

**Date:** 2026-07-27
**Phase / Task:** phase-0, Task 1
**Decision:** No `docker-compose.yml` for Oracle or Redis. The API connects to a native Oracle 19c **Enterprise Edition** install already running on the host as Windows services (confirmed via `SELECT banner FROM v$version`), using the credentials already present in `.env`. Redis runs as a native Windows service (the open-source `tporadowski/redis` Windows port, Redis 5.0.14.1).
**Why:** Task 1's brief calls for Oracle XE + Redis via `docker-compose.yml`, but (a) Oracle XE cannot run VPD (`DBMS_RLS`), which Task 3 requires on every company-owned table — this was flagged and the fix agreed was to use EE instead — and (b) this host has no Docker installed at all, while it already has a native, running Oracle 19c EE instance. Standing up a container layer neither exists nor is needed here would be pure overhead.
**Alternatives considered:** Installing Docker Desktop first (rejected — extra setup with no benefit, since a real EE instance is already running); Memurai for Redis (rejected — its download requires an email signup that can't be completed non-interactively; the open-source Windows Redis port needs no signup and speaks the same protocol).

---

**Date:** 2026-07-27
**Phase / Task:** phase-0, Task 7 (recorded ahead of time, applies when Task 7 is built)
**Decision:** Phase 0's company-provisioning endpoint will implement steps 1–5 and 10 of `00-SYSTEM-DESIGN.md §6` (company, domain, first admin, default settings, default language, audit log). Steps 6–9 (default pages, sections, starter categories, menus/menu_items) move to Phase 1, added to the same endpoint once those tables exist.
**Why:** `pages`, `sections`, `cats`, `menus`, and `menu_items` are defined in `docs/02-PHASE-1-catalog.md`, not in Task 3's `001_init.sql`. Building all 10 provisioning steps in Phase 0 would mean pulling forward Phase 1's catalog/CMS schema — the exact scope creep the phase files exist to prevent.
**Alternatives considered:** Pulling the five extra tables into Phase 0's migration (rejected — expands Phase 0's schema ownership beyond its stated goal of "two companies, two domains, provably isolated data").

---

**Date:** 2026-07-27
**Phase / Task:** phase-0, Task 2/3
**Decision:** The migration-tracking table is named `migrations`, not `_migrations` as literally written in the brief.
**Why:** Oracle rejects unquoted identifiers that start with `_` (`ORA-00911: invalid character`). Quoting it (`"_migrations"`) would force every reference, forever, to use exact-case double-quoted syntax — fragile and non-idiomatic for Oracle. `migrations` isn't on `CLAUDE.md`'s "final, do not rename" table list (that list only covers business-domain tables), so renaming this one piece of runner-internal bookkeeping was safe.
**Alternatives considered:** Quoting `"_migrations"` everywhere (rejected — fragile, unusual for Oracle, no upside over a straightforward rename).

---

**Date:** 2026-07-27
**Phase / Task:** phase-0, Task 2
**Decision:** `ecomm_platform`'s password is limited to 24 characters, and every table it needs now has a matching `CREATE OR REPLACE SYNONYM ecomm_platform.<table> FOR <table>` (in `scripts/setup-platform-user.js`, alongside its grants).
**Why:** Two Oracle-specific gotchas hit during Task 2, both confirmed by actually running the migration against the live instance rather than guessing: (1) `CREATE USER ... IDENTIFIED BY "password"` parses a double-quoted password as a quoted **identifier**, subject to Oracle's identifier length limit — a 32-character generated password raised `ORA-00972: identifier is too long`; 24 characters is comfortably under it. (2) Granting `SELECT/INSERT/UPDATE/DELETE` on `ecomm`'s tables to `ecomm_platform` does not let it use unqualified table names in its own queries — those resolve against its own (empty) schema first, raising `ORA-00942: table or view does not exist`. Synonyms fix this without forcing `withPlatform`-based repo code to write schema-qualified SQL that every other repo function doesn't need.
**Alternatives considered:** Schema-qualifying every `withPlatform` query as `ecomm.<table>` (rejected — inconsistent with every other repo module, and hardcodes the app schema's name into query text). Quoting a longer password instead of shortening it (works, but shortening is simpler and there's no requirement for password length beyond "strong").

---

**Date:** 2026-07-27
**Phase / Task:** phase-0, Task 6
**Decision:** `media`'s file-size column is `size_bytes`, not `size`.
**Why:** Unlike `key`/`value` (fine as Oracle column names), `SIZE` is on Oracle's actual reserved-words list (used historically in storage-clause and datatype-size syntax), so `CREATE TABLE media (... size NUMBER ...)` raises `ORA-00904: invalid identifier`. Same category of issue as the `_migrations` rename, caught the same way — by actually running it.
**Alternatives considered:** Quoting `"size"` everywhere (rejected, same fragility argument as before).

---

**Date:** 2026-07-27
**Phase / Task:** phase-0, Task 6
**Decision:** The `company_id` guard for media serving is enforced in Express for Phase 0, not at the Nginx layer.
**Why:** Task 1's dev stack has no Nginx, and `00-SYSTEM-DESIGN.md §10` only places Nginx in the production environment. Building an Nginx-layer guard now means writing reverse-proxy config with nothing running locally to test it against.
**Alternatives considered:** Standing up a local Nginx just for this guard (rejected — no other part of Phase 0 needs a reverse proxy; revisit in Phase 3 when Nginx enters the stack for real).

---

**Date:** 2026-07-27
**Phase / Task:** phase-0, Task 7
**Decision:** `scripts/seed-platform-admin.js` (bootstraps the first `role='platform'` admin, since nothing else can create one) connects as `ecomm_platform`, not `ecomm`.
**Why:** A platform admin row has `company_id IS NULL`. Inserting it through the plain `ecomm` connection hits `ORA-28115: policy with check option violation` — the `admins` VPD policy's `update_check` evaluates `company_id = SYS_CONTEXT('sf_ctx','company_id')`, and with no context set on that connection, that's `NULL = NULL`, which SQL treats as unknown, not true. This is exactly the access pattern `withPlatform()` exists for, and it's what Task 7's provisioning/admin-management code uses throughout — the seed script just needed to follow the same rule.
**Alternatives considered:** Special-casing `company_predicate` to treat "no context + NULL company_id" as a match (rejected — weakens the policy's fail-closed default for every table sharing the function, for a one-time bootstrap script that has a simpler fix).
