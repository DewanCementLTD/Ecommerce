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

`npm run dev` starts the API (`:8003`), the storefront (`:3001`), and the admin panel (`:5173`) together. Run `npm run dev --workspace=superadmin` separately for the Super Admin panel (`:5174`).

> **Ports on this host are not free real estate.** This machine also runs unrelated projects — `:3000` in particular belongs to another app. Storeforge owns exactly two of them: **`:8003` (API)** and **`:3001` (storefront)**. The two Vite admin panels are dev-only and never exposed publicly; if you need to look at one in a browser while the storefront is stopped, run it on the storefront's port (`npm run dev --workspace=superadmin -- --port 3001`) rather than claiming a third.

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
| `npm run seed:demo-catalog` | Fills the demo stores with categories, products, banners and wired-up home sections (images generated locally, no network) |
| `npm run backfill:order-seq` | One-time (idempotent) — seeds the per-company order-number counter for any company provisioned before `007_commerce.sql` |
| `npm run carts:cleanup` | Deletes expired (30-day) carts across every company. Scheduled nightly by PM2 (`ecosystem.config.cjs`) in production |
| `npm run ui:check <url>...` | Screenshots pages at 375px and 1440px and fails on horizontal overflow, missing alt text, unnamed buttons, broken images, a missing `h1`, browser console errors, or a missing meta description / canonical in `<head>` |
| `npm run smoke:panels <baseUrl> <email> <password> [path...]` | Logs into an admin panel and walks its screens, reporting anything the browser complained about |
| `npm run backfill:avif` | One-time (idempotent) — generates the AVIF sibling of every WebP variant uploaded before Phase 3 |
| `npm run seed:loadtest` | A store with realistic volume (10k products, 2k orders) plus filler tenants, so `EXPLAIN PLAN` and load tests mean something. `--drop` removes it all |
| `npm run explain [companyId]` | `EXPLAIN PLAN` over the fifteen hottest queries — captured from the repositories, not copied — failing on any full scan of `products`, `orders` or `variants` |
| `npm run loadtest [-- --api]` | autocannon against home/category/product (or the API endpoints behind them) |
| `npm run uptime <url>...` | Probes each URL; exits non-zero if any is down. Meant for a scheduler |
| `npm run backup:company -- --company <id>` | Exports every row one company owns to a JSON file |
| `npm run restore:company -- --file <export>` | Restores that export into a new, suspended company |

Production process management is `ecosystem.config.cjs` (PM2) and
`deploy/nginx/`. Operational procedures live in [docs/runbooks/](docs/runbooks/) —
start with [onboard-company.md](docs/runbooks/onboard-company.md), and
[incident.md](docs/runbooks/incident.md) when something is wrong.

Storefront performance claims must be measured against a production build
(`next build && next start`), never the dev server: `node scripts/lighthouse.js <url>`.

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

See `CLAUDE.md` for the full repository layout and module shape. In short: `api/` is the only thing that talks to Oracle, `storefront/` is the public Next.js site, `admin/` and `superadmin/` are Vite + React SPAs, `deploy/` holds the Nginx configuration and `docs/runbooks/` holds the procedures for running it.

## Notes for this environment

No Docker is used here — see `docs/DECISIONS.md` for why. Both Oracle and Redis are native Windows services already running on this host; `.env` is already populated with working credentials for them.
