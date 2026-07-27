# CLAUDE.md — Project Rules (read this first, every session)

You are building **Storeforge**: a multi-tenant e-commerce platform. One codebase, one Oracle database, many client stores. Adding a client is a data operation, never a code change.

Reference storefront quality bar: `themeathub.com` (clean, mobile-first, banner slider → category tiles → product rows → newsletter → footer).

---

## Non-negotiable rules

1. **Plain JavaScript only. No TypeScript.** No `.ts`/`.tsx` files, no type annotations, no `tsconfig.json`. Use JSDoc comments for type hints where helpful.
2. **Nothing is hardcoded per client.** No client names, logos, colors, or copy in source. If it varies per store, it lives in the database.
3. **Every company-owned query is scoped by `company_id`.** Three layers enforce this (VPD, repository layer, tests). Never write raw SQL outside a repository module.
4. **Table names stay short and lowercase.** `products`, not `tbl_product_master`. See the naming table below.
5. **No payments, no shipping engine, no currency conversion.** Orders are manual/COD. Do not add gateway or courier code, even "just a stub."
6. **Mobile-first.** Every storefront view is designed at 375px first, then scaled up. Test mobile before desktop.
7. **Do not invent scope.** If something isn't in the current phase file, don't build it. Ask instead.
8. **Never commit secrets.** Everything sensitive goes in `.env`, which is gitignored. Commit `.env.example` only.

---

## Stack

| Layer | Choice |
|---|---|
| Backend | Node.js 20 LTS + Express, plain JS, ES modules |
| DB | Oracle 19c Enterprise Edition, `node-oracledb` (thin mode) |
| Query layer | Knex (query builder only — no Knex migrations against Oracle; see below) |
| Migrations | Plain numbered `.sql` files run by a small custom runner |
| Auth | JWT (access + refresh), `argon2` for password hashing |
| Validation | `zod` on every request body/params |
| Logging | `pino` (structured, always tagged with `company_id` + `req_id`) |
| Cache/session | Redis (`ioredis`) |
| Storefront | Next.js (App Router, JS), SSR, Tailwind |
| Admin panels | React + Vite SPA, Tailwind |
| Tests | Vitest + Supertest |
| Lint/format | ESLint + Prettier |

---

## Repository layout

```
storeforge/
├─ CLAUDE.md
├─ docs/                    # phase briefs, decisions, runbooks
├─ api/                     # Express API (the only thing that touches Oracle)
│  ├─ src/
│  │  ├─ config/            # env loading, constants
│  │  ├─ db/
│  │  │  ├─ pool.js         # oracledb pool + company-context wrapper
│  │  │  ├─ knex.js         # query builder instance (SQL generation only)
│  │  │  └─ migrations/     # 001_init.sql, 002_catalog.sql, ...
│  │  ├─ middleware/        # tenant resolver, auth, errors, rate limit
│  │  ├─ modules/           # feature folders (see below)
│  │  ├─ lib/               # shared helpers (slugify, images, mailer)
│  │  ├─ app.js
│  │  └─ server.js
│  └─ tests/
│     ├─ integration/
│     └─ isolation/         # cross-company leak tests (release gate)
├─ storefront/              # Next.js public site
├─ admin/                   # React SPA — client admin
├─ superadmin/              # React SPA — our panel
└─ scripts/                 # seed, migrate, dev helpers
```

**Module folder shape** (every feature follows this exactly):
```
modules/products/
├─ products.routes.js     # express routes, thin
├─ products.controller.js # req/res only, no SQL, no business rules
├─ products.service.js    # business logic
├─ products.repo.js       # ALL SQL for this module
├─ products.schema.js     # zod validation schemas
└─ products.test.js
```
Rule: routes → controller → service → repo. Never skip a layer. SQL only in `*.repo.js`.

---

## Database naming conventions

- Tables: lowercase, plural, short. Max ~12 chars.
- Every company-owned table has `company_id NUMBER NOT NULL` as its **first** column after the PK.
- PKs: `id NUMBER GENERATED ALWAYS AS IDENTITY`.
- FKs: `<table_singular>_id` (e.g. `product_id`).
- Timestamps: `created_at`, `updated_at` (`TIMESTAMP WITH TIME ZONE`, default `SYSTIMESTAMP`).
- Soft delete where useful: `deleted_at NULL`.
- Booleans: `NUMBER(1)` with a check constraint `(0,1)`, named `is_active`, `is_default`, etc.
- JSON: `CLOB` + `CHECK (col IS JSON)`.
- Slugs are unique **per company**: `UNIQUE (company_id, slug)`.
- Index the leading `company_id` on every lookup index.

**Table list (final — do not rename):**

| Table | Holds |
|---|---|
| `companies` | tenants |
| `domains` | domain → company mapping |
| `themes` | available themes (platform-level) |
| `admins` | platform + company admin users |
| `roles` | role definitions |
| `settings` | per-company key/value store settings |
| `langs` | per-company enabled languages |
| `trans` | universal translations table |
| `media` | uploaded files |
| `cats` | categories (self-referencing) |
| `products` | products |
| `variants` | product variants (sku, price, stock) |
| `options` | variant option definitions |
| `prod_imgs` | product images |
| `prod_cats` | product ↔ category link |
| `colls` | collections |
| `coll_prods` | collection ↔ product link |
| `pages` | pages |
| `sections` | page sections (ordered, toggleable) |
| `banners` | banner images |
| `menus` | navigation menus |
| `menu_items` | menu entries |
| `customers` | store customers |
| `addrs` | customer addresses |
| `carts` | carts |
| `cart_items` | cart lines |
| `orders` | orders |
| `order_items` | order lines |
| `order_log` | order status history |
| `logs` | audit log |

---

## The company-context contract (most important code in the project)

Oracle VPD filters every query by the current company. The API must:

```js
// db/pool.js — conceptual contract
const conn = await pool.getConnection();
await setCompanyContext(conn, companyId);   // on borrow
try { /* queries */ } finally {
  await clearCompanyContext(conn);          // ALWAYS on return
  await conn.close();
}
```

- Never call `pool.getConnection()` directly in a module. Always use the `withCompany(companyId, fn)` helper.
- Super Admin cross-company reads use `withPlatform(fn)`, which uses a **separate DB user** exempt from VPD policies. Every call is written to `logs`.
- Any new company-owned table **must** get a VPD policy in the same migration that creates it. A table without a policy is a bug.

---

## Definition of done (every task)

- [ ] Code follows the module shape; no SQL outside repos.
- [ ] zod validation on all inputs.
- [ ] Errors go through the central error middleware; no raw `res.status(500)` scattered around.
- [ ] Tests written and passing (`npm test`).
- [ ] Isolation tests still pass (`npm run test:isolation`).
- [ ] Lint clean (`npm run lint`).
- [ ] Mobile checked at 375px for any UI.
- [ ] `docs/DECISIONS.md` updated if you made a non-obvious choice.

## Git

- Small, focused commits. Conventional commits: `feat(products): add variant stock tracking`.
- One branch per phase: `phase-0-foundation`, `phase-1-catalog`, etc.
- Never commit `.env`, `node_modules`, build output, or uploaded media.

## When stuck

Stop and ask rather than guessing on: Oracle-specific SQL behavior, VPD policy syntax, anything that would change the data model, or anything that expands scope. State the options and your recommendation.
