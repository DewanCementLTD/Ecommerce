# Storeforge

Multi-tenant e-commerce platform. One codebase, one Oracle database, many client stores. See `CLAUDE.md` for the project rules and `docs/00-SYSTEM-DESIGN.md` for the architecture.

## Prerequisites

- Node.js 20 LTS (or newer)
- An Oracle Database instance you can connect to. **Must be Enterprise Edition** — VPD (`DBMS_RLS`) is not available on Express Edition (XE), and every company-owned table relies on it. On this dev machine, Oracle 19c EE already runs natively as Windows services (`OracleServiceORCL`, `OracleOraDB19Home1TNSListener`) — nothing to install.
- Redis, reachable on `localhost:6379` by default. On this dev machine it runs as a native Windows service (installed from the open-source `tporadowski/redis` Windows port).

## Run it locally

```bash
npm install
cp .env.example .env          # already done on this machine — fill in your own values elsewhere
npm run setup:platform-user   # one-time: creates the VPD-exempt DB user used by withPlatform()
npm run migrate
npm run seed:platform-admin   # one-time: creates the first role=platform admin (PLATFORM_ADMIN_EMAIL/PASSWORD)
npm run seed:demo             # one-time: two demo stores (demo-a.localhost / demo-b.localhost), each themed differently
npm run dev
```

`npm run dev` starts the API (`:4000`), the storefront (`:3000`, falls back to the next free port if occupied), and the admin panel (`:5173`) together. Run `npm run dev --workspace=superadmin` separately for the Super Admin panel (`:5174`).

`demo-a.localhost` and `demo-b.localhost` need entries in the hosts file (`C:\Windows\System32\drivers\etc\hosts` on Windows) pointing at `127.0.0.1` — Windows doesn't resolve `*.localhost` automatically. Already done on this machine; `npm run seed:demo` prints each demo admin's one-time login.

## Scripts (root)

| Script | Does |
|---|---|
| `npm run dev` | Starts api + storefront + admin concurrently |
| `npm test` | Runs each workspace's test suite |
| `npm run test:isolation` | Runs the cross-tenant leak suite (release gate) — see below |
| `npm run lint` | ESLint across the whole repo (one shared flat config) |
| `npm run format` | Prettier write across the whole repo |
| `npm run migrate` | Applies pending `.sql` files from `api/src/db/migrations/`, tracked in the `migrations` table |
| `npm run migrate:dry` | Lists pending migrations without applying them |
| `npm run setup:platform-user` | One-time (idempotent) bootstrap of the `ecomm_platform` VPD-exempt DB user + its table synonyms |
| `npm run seed:platform-admin` | One-time (idempotent) bootstrap of the first Super Admin login (`PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD`) |
| `npm run seed:demo` | One-time (idempotent) two demo stores + themes, for `demo-a.localhost` / `demo-b.localhost` |

## The isolation suite is the release gate

`npm run test:isolation` (`api/tests/isolation/`) seeds two companies and then, for every
company-owned endpoint, attempts cross-company reads and writes as A against B's ids —
expecting 404/403 every time, never data. It also asserts at the database level that a
connection carrying company B's context cannot SELECT, UPDATE, DELETE, or INSERT company A's
rows, using SQL with **no** `company_id` predicate of its own — so a pass proves Oracle VPD
is doing the work, not just the repository layer's own `WHERE` clause.

> **This suite must be run against Oracle Enterprise Edition, not XE.** XE has no VPD
> (`DBMS_RLS`), so on XE the database-level assertions would be testing nothing while still
> reporting green — the most dangerous possible outcome for a tenant-isolation gate.

If anything in `tests/isolation/` fails, nothing ships until it's green. This is currently a
manual pre-release step; wiring it into CI as a blocking check is tracked in
[docs/BACKLOG.md](docs/BACKLOG.md).

## Layout

See `CLAUDE.md` for the full repository layout and module shape. In short: `api/` is the only thing that talks to Oracle, `storefront/` is the public Next.js site, `admin/` and `superadmin/` are Vite + React SPAs.

## Notes for this environment

No Docker is used here — see `docs/DECISIONS.md` for why. Both Oracle and Redis are native Windows services already running on this host; `.env` is already populated with working credentials for them.
