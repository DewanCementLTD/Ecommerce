# Storeforge

Multi-tenant e-commerce platform. One codebase, one Oracle database, many client stores. See `CLAUDE.md` for the project rules and `docs/00-SYSTEM-DESIGN.md` for the architecture.

## Prerequisites

- Node.js 20 LTS (or newer)
- An Oracle Database instance you can connect to. **Must be Enterprise Edition** — VPD (`DBMS_RLS`) is not available on Express Edition (XE), and every company-owned table relies on it. On this dev machine, Oracle 19c EE already runs natively as Windows services (`OracleServiceORCL`, `OracleOraDB19Home1TNSListener`) — nothing to install.
- Redis, reachable on `localhost:6379` by default. On this dev machine it runs as a native Windows service (installed from the open-source `tporadowski/redis` Windows port).

## Run it locally

```bash
npm install
cp .env.example .env   # already done on this machine — fill in your own values elsewhere
npm run migrate        # from Task 3 onward
npm run dev
```

`npm run dev` starts the API (`:4000`), the storefront (`:3000`), and the admin panel (`:5173`) together. Run `npm run dev --workspace=superadmin` separately for the Super Admin panel (`:5174`).

## Scripts (root)

| Script | Does |
|---|---|
| `npm run dev` | Starts api + storefront + admin concurrently |
| `npm test` | Runs each workspace's test suite |
| `npm run test:isolation` | Runs the cross-tenant leak suite (release gate) — must be run against Oracle **Enterprise Edition** |
| `npm run lint` | ESLint across the whole repo (one shared flat config) |
| `npm run format` | Prettier write across the whole repo |

## Layout

See `CLAUDE.md` for the full repository layout and module shape. In short: `api/` is the only thing that talks to Oracle, `storefront/` is the public Next.js site, `admin/` and `superadmin/` are Vite + React SPAs.

## Notes for this environment

No Docker is used here — see `docs/DECISIONS.md` for why. Both Oracle and Redis are native Windows services already running on this host; `.env` is already populated with working credentials for them.
