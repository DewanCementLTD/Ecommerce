# Phase 1 — Catalog, Content & Storefront

**Goal:** a real, browsable, mobile-first store — products, categories, a section-built homepage, and multi-language.
**Estimated:** 4–5 weeks. Branch: `phase-1-catalog`.

> Prerequisite: Phase 0 exit criteria all met. Re-read `CLAUDE.md`. Plan first, show me the plan, then build.

---

## Task 1 — Catalog schema (`003_catalog.sql`)

| Table | Columns (essentials) |
|---|---|
| `cats` | id, company_id, parent_id, name, slug, desc, image_id, position, is_active, meta_title, meta_desc |
| `products` | id, company_id, name, slug, desc (CLOB), short_desc, brand, is_active, is_featured, tags, meta_title, meta_desc, created_at, updated_at, deleted_at |
| `variants` | id, company_id, product_id, sku, barcode, name, opts (JSON), price, sale_price, cost, stock, weight, is_default, position, is_active |
| `options` | id, company_id, product_id, name, values (JSON), position |
| `prod_imgs` | id, company_id, product_id, media_id, alt, position |
| `prod_cats` | company_id, product_id, cat_id (composite PK) |
| `colls` | id, company_id, name, slug, desc, image_id, type (`manual`/`auto`), rules (JSON), is_active |
| `coll_prods` | company_id, coll_id, product_id, position |

Rules:
- Every product has at least one variant. A "simple" product is a product with one default variant — the storefront hides the variant picker when there's only one. This keeps one code path instead of two.
- Price stored as `NUMBER(12,2)`. `sale_price` nullable; when set and lower than `price`, the storefront shows the strikethrough.
- Stock lives on `variants`, never on `products`.
- Slugs unique per company. Auto-generate from name, allow manual override, ensure uniqueness with a numeric suffix.
- VPD policy + indexes on all of them. Index `products(company_id, is_active, created_at)`, `variants(company_id, product_id)`, `cats(company_id, parent_id, position)`.

---

## Task 2 — Catalog API

Full CRUD modules for `products`, `cats`, `colls`, following the module shape.

Product endpoints must support: pagination (cursor or offset, your call — document it), search by name/sku, filter by category/collection/status, sort by name/price/created, bulk activate/deactivate, bulk delete, image reorder, variant CRUD nested under the product, and stock adjustment with an audit log entry.

Category endpoints: tree read (`GET /cats/tree` returning nested children), reorder (accept an array of `{id, position, parent_id}`), and a guard against circular parenting.

Public storefront endpoints (no auth, company from host): `GET /shop/products`, `/shop/products/:slug`, `/shop/cats`, `/shop/cats/:slug`, `/shop/colls/:slug`, `/shop/search?q=`.

Performance: no N+1. Fetch products with their default variant and primary image in one query. Add a test that asserts the query count for a 24-product listing.

---

## Task 3 — Content schema (`004_content.sql`)

| Table | Columns |
|---|---|
| `pages` | id, company_id, title, slug, type (`home`/`page`), content (CLOB, for rich pages), is_active, meta_title, meta_desc, og_image_id |
| `sections` | id, company_id, page_id, type, position, is_active, settings (CLOB JSON) |
| `banners` | id, company_id, name, media_id, media_mobile_id, link, alt, position, is_active, starts_at, ends_at |
| `menus` | id, company_id, code (`header`/`footer`), name |
| `menu_items` | id, company_id, menu_id, parent_id, label, url, link_type, link_id, position, is_active |

Note `banners.media_mobile_id`: a separate mobile crop. Desktop hero images look terrible on phones, and mobile is most of the traffic.

---

## Task 4 — The section system

Build the shared registry described in `00-SYSTEM-DESIGN.md §5` at `shared/sections/registry.js`, consumed by both the admin and the storefront.

Section types to implement (this list is the scope — do not add more):

| type | settings |
|---|---|
| `hero` | banner ids, autoplay, interval, height |
| `cat_tiles` | title, category ids, columns (mobile/desktop) |
| `prod_row` | title, source (`collection`/`category`/`manual`/`newest`/`featured`), source id, limit, layout (`grid`/`carousel`) |
| `promo` | media id, mobile media id, heading, subheading, button label, link |
| `best` | title, limit, period |
| `features` | items: [{icon media id, title, text}] |
| `blog` | title, limit (stub if blog isn't built — hide when empty) |
| `news` | heading, subheading, button label, background media id |
| `rich` | html content |

API: `GET /pages/:id/sections`, `POST /pages/:id/sections`, `PATCH /sections/:id`, `DELETE /sections/:id`, `POST /pages/:id/sections/reorder` (array of `{id, position}` in one transaction).

Every section component must render correctly when its data is empty or missing — a broken section must never break the page. Render nothing instead.

---

## Task 5 — Multi-language (`005_i18n.sql` + logic)

- `trans` table exactly as specified in the system design (universal, one row per translated field).
- `GET /langs`, `POST /langs`, `PATCH /langs/:id`, delete guard on the default language.
- Translation read helper: given entity + ids + requested lang, return a map with **default-language fallback per field**. Batch it — never one query per row.
- Translation write endpoint: `PUT /trans/:entity/:id` taking `{ lang, fields: {...} }`.
- Storefront routing: `/{lang}/...` with the default language served at both `/` and `/{default}/`. Emit `hreflang` alternates and a per-language sitemap.
- Admin: a language switcher on product/category/page editors that swaps the editable fields, showing the fallback value greyed out as a placeholder when a translation is missing.

Support RTL (`ar`): set `dir="rtl"` on the html element and verify the whole storefront layout mirrors correctly. Tailwind logical properties (`ps-`, `pe-`, `ms-`, `me-`) instead of left/right.

---

## Task 6 — Storefront build

Next.js App Router, SSR, mobile-first. Pages:

- `/` — sections from the `home` page, in order
- `/cats/[slug]` — product grid, filters (price, availability), sorting, pagination
- `/colls/[slug]`
- `/products/[slug]` — gallery, variant picker, price with sale strikethrough, stock state, quantity, add-to-cart (wired in Phase 2)
- `/search`
- `/pages/[slug]` — CMS pages
- header (logo, nav from `menus`, search, cart icon, language switcher), footer (menus, social, payment-free info)
- 404 and maintenance pages

**Theming:** theme tokens from the DB are injected as CSS custom properties on `<html>`. Every color, font and radius in the storefront reads from those variables. Changing a company's theme must not require a rebuild.

**Design quality bar.** Build this as a design lead would, not from a template:
- Type: pick a deliberate display + body pairing, set a real type scale. Not the default system stack.
- Layout: generous whitespace, a clear grid, product cards that look composed rather than bootstrapped.
- Motion: restrained. One considered page-load or scroll reveal; hover states on cards. Respect `prefers-reduced-motion`.
- Quality floor, unannounced: responsive from 375px, visible keyboard focus, alt text everywhere, semantic landmarks, colour contrast AA.
- Avoid the AI-design defaults: cream-and-terracotta serif, black-with-acid-green, and hairline broadsheet grids are tells. Choose something grounded in what a food/retail store actually needs.
- Skeleton loaders, not spinners. Empty states that invite action, never a bare "No data".

Ship **two themes** to prove the system works: one warm/retail (Meat Hub territory), one clean/modern. They must differ only in tokens and header/footer variant — never in data or components.

---

## Task 7 — Client Admin UI

React + Vite + Tailwind SPA. Screens: dashboard shell, products list (table, search, filters, bulk actions, inline stock edit), product editor (details, images with drag-reorder, variants, SEO, translations), categories (tree with drag-reorder), collections, media library (grid, folders, upload with progress), pages + **section arranger**, banners, menus editor, settings, staff.

**Section arranger** is the centrepiece: a vertical list of sections, each with a toggle, a drag handle, an inline settings form, and a live preview pane beside it. Use `dnd-kit`. Drag must work on touch. Optimistic reorder with rollback on failure.

Admin UX rules: every destructive action confirms and says exactly what will be deleted. Every save shows a toast in the same vocabulary as the button ("Save changes" → "Changes saved"). Forms show validation inline, never as an alert. Nothing more than three clicks from the dashboard.

---

## Phase exit criteria

- [ ] A client can add a product with images and variants, put it in a category, feature it on the homepage, and see it live — without a developer.
- [ ] Homepage sections can be toggled and reordered by dragging, on desktop and on a phone.
- [ ] The same store renders correctly in two languages, one of them RTL.
- [ ] Two companies with different themes look genuinely different.
- [ ] Lighthouse mobile: performance ≥ 85, accessibility ≥ 95 on home, category and product pages.
- [ ] Isolation suite still green.

Write `docs/PHASE-1-REPORT.md` as before.
