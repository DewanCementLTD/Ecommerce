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
**Phase / Task:** phase-0, Task 6 (recorded ahead of time, applies when Task 6 is built)
**Decision:** The `company_id`-path guard for media serving is enforced in Express for Phase 0, not at the Nginx layer.
**Why:** Task 1's dev stack has no Nginx, and `00-SYSTEM-DESIGN.md §10` only places Nginx in the production environment. Building an Nginx-layer guard now means writing reverse-proxy config with nothing running locally to test it against.
**Alternatives considered:** Standing up a local Nginx just for this guard (rejected — no other part of Phase 0 needs a reverse proxy; revisit in Phase 3 when Nginx enters the stack for real).
