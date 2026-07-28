# Phase 1 — Catalog, Content & Storefront: report

**Goal:** a real, browsable, mobile-first store — products, categories, a section-built homepage, and multi-language.
**Status:** **incomplete.** Tasks 1–6 are done and green; **Task 7 (the client admin SPA) is not built.**
**Branch:** `phase-1-catalog`, 8 commits (`94dbb41`..`HEAD`).
**Date:** 2026-07-28.

---

## Exit criteria

| Criterion | Status |
|---|---|
| A client can add a product with images and variants, categorise it, feature it on the homepage, and see it live — without a developer | **Not met.** Every one of those actions works over the API and is covered by tests, but there is no admin UI to do them from, so "without a developer" is false today. |
| Homepage sections can be toggled and reordered by dragging, on desktop and on a phone | **Not met.** The API does it (`POST /pages/:id/sections/reorder`, one transaction, tested); the drag-and-drop arranger does not exist. |
| The same store renders correctly in two languages, one of them RTL | **Met.** Verified by adding `ar` through the API and loading `/ar` — full mirroring, per-field fallback, Arabic web font. |
| Two companies with different themes look genuinely different | **Met.** Cleaver and Harbour differ only in `themes.tokens`, including fonts and header/footer variants. |
| Lighthouse mobile: performance ≥ 85, accessibility ≥ 95 on home, category and product | **Accessibility met** (100 / 98 / 100). **Performance marginal**: 85 / 89 / 82, and it moves between runs — see below. |
| Isolation suite still green | **Met.** 131 isolation tests, all passing against live Oracle 19c EE. |

**Totals:** 187 integration + 131 isolation tests, lint clean. Isolation went from 22 at the end of Phase 0 to 131.

---

## What was built

| Task | Delivered |
|---|---|
| 1 | `003_catalog.sql` — 8 tables, VPD policy + grant + synonym each. `004_variant_sku_uq.sql` fixes a bug in it. |
| 2 | `cats`, `products`, `colls` modules and the public `/shop` API: pagination, search, filters, sorting, bulk actions, nested variants, image reorder, audited stock adjustment, and a closed rule grammar for automatic collections |
| 3 | `005_content.sql` — pages, sections, banners, menus, menu_items |
| 4 | `shared/` workspace with `sections/registry.js`; content API including transactional section reorder |
| 5 | `006_i18n.sql` — universal `trans` table, langs CRUD, batched reads with per-field fallback, `/{lang}` routing, RTL, hreflang, per-language sitemap |
| 6 | The storefront: theming from tokens, two themes, all nine section components, category/collection/product/search/CMS pages, 404, unknown-domain and suspended pages |
| — | **Phase 0 carry-over closed:** provisioning now does all ten steps of `00-SYSTEM-DESIGN.md §6` |
| 7 | **Not started** |

---

## What is missing, precisely

**Task 7, the client admin SPA.** `admin/` is still the Task 1 placeholder — the same state Phase 0 left it in. Nothing was removed or half-built; the workspace simply has no screens yet.

Everything it needs is finished and tested behind it:

- products list and editor → `/products` (list, filters, bulk, variants, images, stock)
- categories tree → `/cats/tree`, `/cats/reorder`
- collections → `/colls`
- media library → `/media`
- pages + section arranger → `/pages`, `/sections`, `/sections/registry`, `/pages/:id/sections/reorder`
- banners, menus → `/banners`, `/menus`, `/menu-items`
- translations → `/langs`, `/trans/:entity/:id`

`GET /sections/registry` exists specifically so the arranger builds its settings forms from the same registry the storefront renders from. `superadmin/` is a working precedent for the shell (`lib/api.js`, `AuthContext.jsx`, `ProtectedRoute.jsx`).

Estimated remaining: **5–6 days**, the original T15+T16 estimate.

---

## Bugs I shipped and then found

Worth recording, because none of them were caught by reading the code:

1. **`UNIQUE (company_id, sku)` does not mean "unique when present."** Oracle only omits an index entry when *every* key column is NULL, so two SKU-less variants both indexed as `(42, NULL)` and collided — a store could hold exactly one product without a SKU. Found by the first products test run; fixed in `004`.
2. **`repeat(var(--cols), 1fr)` is invalid CSS.** The repeat count cannot be a variable, so the category grid silently fell back to content-sized columns and overflowed a 375px viewport. Found by looking at a screenshot.
3. **Media is tenant-scoped by Host**, so a browser fetching images directly from the API's origin resolved to no store and every image 404'd. Images are now same-origin and proxied by Next — which is also how Nginx will serve them in Phase 3.
4. **Section product rows returned raw catalog rows** while the cards expect the public shape, so every product in a homepage row rendered as `0.00` with no image. The mapper now lives in `shop.dto.js` and both callers use it.
5. **Section *content* was not translated** — the chrome and headings localised while the products underneath stayed in English, which is worse than no translation.
6. **My own isolation test was falsely green.** Vitest builds `describe` blocks before `beforeAll`, so row ids bound as `undefined` and "B sees none of A's rows" passed because the query matched nothing at all. Bind values are now lazy.

The pattern: five of six needed a real browser or a real database, not a test run.

---

## Deviations from the brief

All are in `docs/DECISIONS.md`; the ones that matter:

1. **`desc` → `descr`, `options.values` → `vals`.** Both are Oracle reserved words. Checked against `v$reserved_words` before writing the migration this time.
2. **Composite `(company_id, id)` foreign keys** on every child table. FK checks run outside VPD, so a single-column FK would accept another company's parent row. This makes a cross-tenant parent pointer unrepresentable, and the isolation suite proves it.
3. **No Knex.** Raw parameterized `oracledb` SQL throughout, consistent with Phase 0. Supersedes CLAUDE.md's stack table; agreed before Task 1.
4. **camelCase JSON on Phase 1 endpoints only.** Phase 0's routes keep their raw upper-case shape because the Super Admin SPA already reads it.
5. **`shared/` is a new workspace**, which CLAUDE.md's layout does not list — but the brief and the system design both name `shared/sections/registry.js`, and a registry that lives inside one app is not shared.
6. **Category filters are applied over the returned page**, not pushed into SQL. Sorting and pagination are the API's job; turning every filter into a predicate is Phase 3 performance work.

---

## Oracle gotchas hit this phase

Additions to the Phase 0 list, all found by running against the real database:

- **`DESC` and `VALUES` are reserved words** — same class as Phase 0's `SIZE`.
- **`SIZE` bites as a *bind variable* name too** (`ORA-01745`), which the Phase 0 report warned about and I still hit once in a seed script.
- **A composite unique key does not skip NULLs** unless *all* its columns are NULL. Function-based indexes are the way to express "unique when present".
- **A CLOB cannot be compared with `=`** (`ORA-00932`); `DBMS_LOB.SUBSTR` is needed.
- **`CREATE INDEX` on columns a unique constraint already covers fails** with `ORA-01408`.
- **DDL auto-commits**, so a migration that fails midway leaves the earlier statements applied. Both partial failures this phase needed manual cleanup before re-running.

---

## Performance, honestly

Lighthouse mobile on a production build, three runs deep:

| Page | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| Home | 85 | 100 | 96 | 92 |
| Category | 89 | 98 | 100 | 92 |
| Product | 82 | 100 | 100 | 92 |

Accessibility clears the ≥95 bar everywhere. Performance sits **on** the 85 line and moves between 82 and 89 across runs — total blocking time alone varies 310–660 ms depending on what else this shared machine is doing. Layout shift is 0 on every page; LCP is 2.6–3.1 s.

I did not chase the last few points, because the honest fix is the Redis caching layer in `00-SYSTEM-DESIGN.md §7`, which is **Phase 3, Task 2**. Pulling it forward to make a number go up would be exactly the scope creep the phase files exist to prevent. The storefront currently uses Next's own `revalidate` on public fetches and nothing else.

---

## Tooling added

- `scripts/ui-check.js` — drives the installed Chrome through `puppeteer-core`, screenshots pages at 375px and 1440px, and **fails** on horizontal overflow, missing `alt`, unnamed buttons, broken images, or a missing `h1`. It is what caught the home page having no `h1`.
- `scripts/lighthouse.js` — mobile Lighthouse against a production build.
- `scripts/seed-demo-catalog.js` — generates demo images locally with `sharp`, so the demo stores are browsable with no network and no third-party assets.

---

## What the next session should do

1. **Build Task 7.** Start with the shell and the products list, following `superadmin/`'s structure. The section arranger is the centrepiece and should come last, since it depends on the media picker and the registry-driven form renderer.
2. **Re-run the exit criteria** once the admin exists — two of them cannot be judged until then.
3. **Watch the same three obligations for any new table:** VPD policy in the migration, grant to `sf_platform_role`, entry in `PLATFORM_TABLES`.
4. `npm run seed:demo` prints fresh admin passwords; `npm run seed:demo-catalog` fills the stores.
5. The storefront must be run with `next build && next start` for any performance claim. Port 3000 on this machine belongs to an unrelated project — use another.
