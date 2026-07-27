# 00 — System Design (reference document)

Read once at project start and refer back. This is the "why"; the phase files are the "what to do now".

---

## 1. What the system is

A single Node.js application serving many independent e-commerce storefronts. Each client company gets:

- a branded storefront on their own domain,
- an admin panel to manage products, content and orders,
- complete data isolation from every other company.

We (the platform team) provision companies from a Super Admin panel. Clients never sign up themselves.

**Success test:** creating a new client store takes minutes and involves zero code changes and zero deployments.

---

## 2. Request lifecycle

```
Visitor → www.clientdomain.com
   │
   ▼
Nginx  (TLS termination, gzip/brotli, static passthrough)
   │
   ▼
Next.js storefront (SSR)  ──calls──►  Express API
                                        │
                                        ▼
                              Tenant Resolver middleware
                              host → company_id  (Redis cache, 5 min TTL)
                                        │
                       ┌────────────────┴────────────────┐
                  unknown host                     known host
                       │                                │
                    404 page                    company suspended?
                                                    │        │
                                                   yes       no
                                                    │        │
                                          maintenance page   │
                                                             ▼
                                             withCompany(id) → Oracle
                                             (VPD auto-filters every query)
                                                             │
                                                             ▼
                                          theme + sections + products → render
```

**Admin panels** resolve company differently: from the authenticated user's `company_id` claim in the JWT, not from the host. Super admins have `company_id = null` and an explicit `platform` role.

---

## 3. Tenant isolation — the three layers

This is the highest-severity risk in the whole system. One leak destroys client trust permanently.

**Layer 1 — Oracle VPD (database-enforced).**
Every company-owned table gets a row-level security policy. The API sets an application context on the connection; Oracle silently appends `company_id = SYS_CONTEXT('sf_ctx','company_id')` to every SELECT/INSERT/UPDATE/DELETE. Application bugs cannot leak data.

```sql
-- shape of what each migration adds per table
BEGIN
  DBMS_RLS.ADD_POLICY(
    object_schema   => 'SF',
    object_name     => 'products',
    policy_name     => 'products_co_pol',
    function_schema => 'SF',
    policy_function => 'sf_sec.company_predicate',
    statement_types => 'SELECT,INSERT,UPDATE,DELETE',
    update_check    => TRUE);
END;
```

**Layer 2 — repository layer (application-enforced).**
All SQL lives in `*.repo.js`. Every repo function takes `companyId` and includes the predicate explicitly. Redundant with VPD on purpose: it keeps queries readable, helps the optimizer pick the right index, and keeps the code portable.

**Layer 3 — automated leak tests (release gate).**
`tests/isolation/` seeds Company A and Company B, then for every endpoint attempts cross-company reads and writes as A against B's IDs. Expected result is always 404 or 403 — never data. CI fails the build on any leak.

**Connection pool discipline.** Context is set on borrow and cleared on return. If context leaked between pooled connections, Company A's request could inherit Company B's context — the worst possible bug. The `withCompany()` helper is the only sanctioned way to get a connection, and it has dedicated tests proving context is cleared even when the callback throws.

---

## 4. Data model overview

Three groups of tables:

**Platform-level** (no `company_id`): `companies`, `domains`, `themes`, plus platform rows in `admins`.

**Company-level** (all carry `company_id`, all VPD-protected): everything else.

**Key relationships:**

```
companies 1──* domains
companies 1──* admins        (company staff)
companies 1──* settings      (key/value)
companies 1──* langs         (enabled languages, one is_default)

cats  ──self──  cats                (parent_id for subcategories)
products 1──* variants              (sku, price, sale_price, stock)
products 1──* prod_imgs
products *──* cats     via prod_cats
products *──* colls    via coll_prods
options  1──* (variant option values, stored on variants as JSON)

pages 1──* sections                 (position, is_active, settings JSON)
menus 1──* menu_items               (parent_id for dropdowns)

customers 1──* addrs
customers 1──* orders
carts 1──* cart_items
orders 1──* order_items             (price copied in at order time)
orders 1──* order_log               (status history)

trans: universal translation rows   (entity, entity_id, lang, field, value)
```

**Translations.** One table instead of six:

| col | meaning |
|---|---|
| `company_id` | tenant |
| `entity` | `'product'`, `'cat'`, `'page'`, `'section'`, `'menu_item'`, `'banner'` |
| `entity_id` | row id in that table |
| `lang` | `'en'`, `'ar'`, … |
| `field` | `'name'`, `'desc'`, `'meta_title'`, … |
| `value` | translated text (CLOB) |

Unique on `(company_id, entity, entity_id, lang, field)`. Missing row → fall back to the company's default language. This keeps the schema small and adding a translatable field costs nothing.

**Orders without payments.** An order records what was ordered, by whom, delivery address, totals, and a status: `new → confirmed → delivered`, or `cancelled`. There is no payment table, no gateway reference, no transaction state. Adding payments later means adding a `payments` table and a status — not restructuring orders.

---

## 5. Page sections — how pages are built

A page is an ordered list of sections. Each section row:

```
sections: id, company_id, page_id, type, position, is_active, settings (CLOB JSON)
```

The admin can toggle `is_active` and drag to change `position`. Each `type` has a settings form in the admin and a matching React component in the storefront. Both sides read from one shared registry so they can never drift:

```js
// shared/sections/registry.js
export const SECTIONS = {
  hero:        { label: 'Hero slider',        fields: [...] },
  cat_tiles:   { label: 'Category tiles',     fields: [...] },
  prod_row:    { label: 'Product row',        fields: [...] },
  promo:       { label: 'Promo banner',       fields: [...] },
  best:        { label: 'Best sellers',       fields: [...] },
  features:    { label: 'Feature icons',      fields: [...] },
  blog:        { label: 'Blog strip',         fields: [...] },
  news:        { label: 'Newsletter',         fields: [...] },
  rich:        { label: 'Rich text',          fields: [...] },
};
```

Adding a new section type = one registry entry + one React component. Nothing else changes.

---

## 6. Company provisioning

Creating a company is a single transaction that writes:

1. `companies` row
2. `domains` row (primary)
3. first `admins` user (random password, emailed / shown once)
4. default `settings` (theme, currency label, timezone, SEO defaults)
5. default `langs` row (default language)
6. default `pages`: Home, About, Contact, Privacy
7. default `sections` on Home (hero, cat_tiles, prod_row, features, news)
8. starter `cats` (a few placeholders)
9. default `menus` (header + footer) and `menu_items`
10. `logs` entry

If any step fails, the whole thing rolls back. The store must be usable the moment the transaction commits.

---

## 7. Caching

| What | Where | TTL | Invalidated by |
|---|---|---|---|
| host → company | Redis | 5 min | domain edit |
| company settings | Redis | 5 min | settings save |
| menus | Redis | 10 min | menu save |
| rendered page sections | Redis | 10 min | page publish |
| product lists | Next.js ISR | 60 s | product save (revalidate tag) |
| images | CDN | long | filename hash |

Cache keys are always prefixed with the company: `co:{id}:settings`. A missing prefix is a cross-tenant bug.

---

## 8. Security baseline

- `helmet`, CORS allowlist, rate limiting (stricter on auth routes).
- Argon2id password hashing. JWT access (15 min) + refresh (7 days, rotating).
- Role-based permissions checked in the service layer, not just the UI.
- Uploads: extension + magic-byte validation, size cap, images re-encoded with `sharp` (strips EXIF and any embedded payload), stored under `media/{company_id}/...`.
- Audit `logs` for: login, failed login, create/update/delete of products, orders, settings, and every super-admin action including "view as company".
- No SQL string concatenation, ever. Bind variables only.

---

## 9. Performance targets

- Storefront mobile LCP under 2.5s on a mid-range phone / 4G.
- Cached page TTFB under 300ms.
- Product list queries under 50ms at 10k products per company.
- All images served as WebP with width variants; lazy-loaded below the fold.

---

## 10. Environments

| Env | Purpose |
|---|---|
| local | Docker Compose: Oracle XE (dev only), Redis, API, storefront, admin |
| staging | mirrors production, seeded with 2 demo companies |
| production | our server: Nginx + PM2/systemd + Oracle 19c EE + Redis + Cloudflare |

Note: develop against Oracle XE locally but **verify VPD on 19c EE** — VPD is not available in XE. The isolation test suite must be run against a real EE instance before any release.
