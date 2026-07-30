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

---

**Date:** 2026-07-27
**Phase / Task:** phase-0, Task 9
**Decision:** Added `demo-a.localhost` / `demo-b.localhost` → `127.0.0.1` entries to this machine's hosts file (`C:\Windows\System32\drivers\etc\hosts`), appended after the existing unrelated entries for other local projects on this box.
**Why:** Task 9 explicitly asks for these two host aliases to be reachable in dev, and this machine doesn't resolve `*.localhost` automatically (confirmed — `nslookup demo-a.localhost` went out to `8.8.8.8` and failed, rather than the OS short-circuiting to loopback the way some systems do). Editing the hosts file is the standard way to do this on Windows; only the two new lines were added, nothing existing was touched.

---

**Date:** 2026-07-27
**Phase / Task:** phase-0, Task 9
**Decision:** Added Tailwind (`tailwind.config.js`, `postcss.config.js`, `app/globals.css`) to `storefront/`, which didn't have it.
**Why:** Task 1 wired up Tailwind for `admin` and `superadmin` but never for `storefront`, even though `CLAUDE.md`'s stack table lists Tailwind for all three. It went unnoticed until now because Task 1's storefront page had no meaningful layout for its absence to be visible; Task 9's first real screenshot showed fully unstyled markup (utility classes present in the JSX but never compiled), which is what caught it.
**Alternatives considered:** None — this was a straightforward gap-fill, not a design choice.

---

**Date:** 2026-07-28
**Phase / Task:** phase-1, all tasks
**Decision:** Repositories keep using raw parameterized `oracledb` SQL. Knex is not introduced, and this supersedes the "Query layer: Knex (query builder only)" row in `CLAUDE.md`'s stack table.
**Why:** All six Phase 0 repo modules are already written this way, and the awkward parts of talking to Oracle from Node are solved in that style: `OFFSET ... FETCH NEXT` pagination, `RETURNING id INTO :id`, `CHECK (col IS JSON)` CLOBs, and the thin-mode `NJS-098` repeated-bind rule. Adding Knex for the Phase 1 modules would mean re-solving each of those against its Oracle dialect while leaving Phase 0's repos in a second, different style. Agreed with you before Task 1 was written.
**Alternatives considered:** Knex for new modules only (rejected — two conventions in one `modules/` folder is worse than one convention that differs from a doc); Knex everywhere including a rewrite of Phase 0's repos (rejected — a large, untested-benefit refactor at the start of the phase with the most new SQL to write).

---

**Date:** 2026-07-28
**Phase / Task:** phase-1, Task 1
**Decision:** Two columns are renamed from the literal names in `docs/02-PHASE-1-catalog.md`: `desc` → `descr` (on `cats`, `products`, `colls`) and `options.values` → `options.vals`.
**Why:** `DESC` and `VALUES` are both on Oracle's reserved-word list — confirmed on this instance with `SELECT keyword, reserved FROM v$reserved_words`, which returns `RESERVED='Y'` for both — so neither works as an unquoted column name. Same class of issue as Phase 0's `size` → `size_bytes`, but caught before writing the migration this time rather than after. The reserved list was checked for every column name in the Phase 1 brief; `type`, `position`, `content`, `rules`, `label`, `source`, `limit`, `period` and `value` are all clear.
**Alternatives considered:** Quoting `"desc"`/`"values"` everywhere (rejected for the third time in this project — it forces exact-case double quotes into every query that ever touches the column).

---

**Date:** 2026-07-28
**Phase / Task:** phase-1, Task 1
**Decision:** Every child table in `003_catalog.sql` references its parent by the composite key `(company_id, id)`, not by `id` alone — e.g. `variants_product_fk FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id)`. This required adding `UNIQUE (company_id, id)` to `products`, `cats`, `colls`, and to the pre-existing `media` table.
**Why:** Oracle checks integrity constraints in the kernel, and that check is **not** subject to VPD. A plain `product_id NUMBER REFERENCES products(id)` would therefore happily accept another company's product id — the row's own `company_id` would pass the VPD check while its parent pointer crossed a tenant boundary. The composite form makes that combination unrepresentable in the database, which turns "a child never belongs to another company's parent" into a fourth enforcement layer instead of an application-level convention. `tests/isolation/catalog-schema.test.js` asserts all three variations (variant → foreign product, `prod_cats` → foreign category, `prod_imgs` → foreign media) fail with `ORA-02291`.
**Alternatives considered:** Single-column FKs plus a service-layer "parent must be in my company" check (rejected — that check is exactly the kind of thing a future refactor forgets, and the whole point of the three-layer model is not to rely on remembering). Note the FK is unenforced when the child column is NULL (Oracle has no `MATCH PARTIAL`), which is the desired behaviour for nullable `parent_id`/`image_id`.

---

**Date:** 2026-07-28
**Phase / Task:** phase-1, Task 2 (applies to every Phase 1 module)
**Decision:** Phase 1 services map rows to camelCase before returning them (`api/src/lib/rows.js`), so new endpoints emit `{ id, parentId, metaTitle }` rather than oracledb's `{ ID, PARENT_ID, META_TITLE }`. Phase 0's endpoints (`/auth`, `/media`, `/platform`) keep returning raw upper-case rows.
**Why:** The tree endpoint made the inconsistency concrete — a nested node would have read `{ NAME, POSITION, children: [...] }`, mixing two conventions inside one object. Phase 1 adds far more surface (catalog, content, sections, translations) consumed by two new UIs, and camelCase JSON is what those clients expect. Phase 0's shape is deliberately left alone: the Super Admin SPA already reads `row.NAME`, so changing it would break shipped, working screens to satisfy tidiness. Values are passed through untouched — `NUMBER(1)` flags stay `0`/`1` rather than being guessed into booleans.
**Alternatives considered:** Converting Phase 0's endpoints too (rejected for now — a UI-breaking change with no user-visible benefit; it can happen whenever the Super Admin SPA is next touched). Doing the mapping in each controller (rejected — it would be re-implemented per endpoint and drift).

---

**Date:** 2026-07-28
**Phase / Task:** phase-1, Task 2
**Decision:** Added `requireCompany` (`api/src/middleware/company.js`) in front of `/cats` **and retro-fitted it to `/media`**: a token whose `company_id` is null now gets 403 `COMPANY_REQUIRED` instead of reaching `withCompany(null)`.
**Why:** Platform admins authenticate with `company_id: null`. Before this, a platform admin calling a company-owned route would pass `requireAuth`, reach `withCompany(null)`, and get a 500 from the pool helper's own guard — an internal error for what is really a permissions answer. `/media` had the same hole since Phase 0; it is one line to close and leaving it inconsistent with `/cats` would be worse. The sanctioned path is unchanged: impersonate the company first, which mints a token that does carry a `company_id`.
**Alternatives considered:** Letting `withCompany` throw an `AppError(403)` instead (rejected — the pool helper is a database concern and shouldn't know about HTTP status codes).

---

**Date:** 2026-07-28
**Phase / Task:** phase-1, Task 2
**Decision:** `GET /cats` and `GET /cats/tree` are not paginated. They return every category for the company, capped at 1000 rows. Everything else in Phase 1 (`/products`, `/colls`, `/media`) uses offset pagination with `page`/`pageSize`, `pageSize` capped at 100, returning `{ rows, total, page, pageSize }`.
**Why:** Task 2 asks for a tree read, and a tree cannot be assembled from a page of rows — the admin's drag-and-drop tree and the storefront's nav both need the complete set in one response. Stores have tens to low hundreds of categories, not thousands. The 1000-row cap keeps a pathological data set from returning something unbounded. Offset (rather than cursor) pagination elsewhere because admin tables need a total row count and page numbers, and storefront listings need crawlable `?page=2` URLs — neither of which a cursor gives cheaply.
**Alternatives considered:** Paginating the flat list while leaving the tree unpaginated (rejected — two different contracts for the same resource, and no caller wants the paginated one); cursor pagination (rejected — no total, and opaque cursors are bad URLs for SEO).

---

**Date:** 2026-07-28
**Phase / Task:** phase-1, Task 3 (fixes Task 1)
**Decision:** `004_variant_sku_uq.sql` replaces `variants_company_sku_uq UNIQUE (company_id, sku)` with a function-based unique index: `(CASE WHEN sku IS NULL THEN NULL ELSE company_id END, sku)`. The content and i18n migrations shift to `005_` and `006_`.
**Why:** The original constraint was meant to read "a SKU is unique within a company, and optional". It doesn't. Oracle only omits an index entry when **every** key column is NULL, and `company_id` is never NULL — so two SKU-less variants in one company both index as `(42, NULL)` and the second raises `ORA-00001`. A store could have exactly one product without a SKU. Found by the first run of the products test suite, not by reading the migration. The function-based form nulls the entire key when `sku` is absent, so those rows are not indexed at all while real SKUs stay unique per company — the same technique already used for `variants_one_default_uq`. Delivered as a follow-up migration rather than an edit to `003`, because `003` was already applied and committed; editing an applied migration is a habit worth not starting.
**Alternatives considered:** Making `sku` NOT NULL and auto-generating one (rejected — invents SKUs for stores that don't use them, and the auto-generated values then have to be unique and meaningful to nobody); dropping SKU uniqueness entirely (rejected — duplicate SKUs in one store are a real data-integrity problem).

---

**Date:** 2026-07-28
**Phase / Task:** phase-1, Task 3
**Decision:** A variant's `opts` JSON is validated in the service against the product's `options` rows — unknown option name, unknown value, and duplicate combinations are all 400s. Variants with **no** option values are exempt from the duplicate check.
**Why:** `00-SYSTEM-DESIGN.md §4` deliberately stores option definitions as rows (`options`) and the chosen values as JSON on `variants`, and Oracle cannot express a constraint spanning the two. Without a check, a variant could claim `{ Colour: "Red" }` on a product whose only option is Size, and the storefront picker would render something impossible to select. The exemption for empty `opts` came out of the first test run: a product may legitimately have several plain variants told apart by name or SKU ("Pack of 6", "Pack of 12"), and treating them all as the same empty combination made that unbuildable.
**Alternatives considered:** Normalising variant option values into their own table (rejected — contradicts the system design's stated shape, and a variant's combination is always read as a unit); no validation at all (rejected — the invariant would break silently in the storefront rather than loudly at the API).

---

**Date:** 2026-07-28
**Phase / Task:** phase-1, Task 3
**Decision:** Product audit entries (`product_created`, `product_updated`, `product_deleted`, `product_bulk_*`, `stock_adjusted`) are written through `insertLog` on the **same `withCompany` connection and transaction** as the change itself, rather than through a separate `withPlatform` call.
**Why:** `00-SYSTEM-DESIGN.md §8` requires an audit trail for product create/update/delete. Writing it in the same transaction means a rolled-back change cannot leave behind a log entry claiming it happened, and a logged change cannot be missing from the data. `logs` has a VPD policy, and passing the same `company_id` the connection is scoped to satisfies its `update_check` — the platform connection is only needed for platform-level entries where `company_id` is NULL. The doc comment on `logs.repo.js` now describes both callers.
**Alternatives considered:** A second connection via `withPlatform` (rejected — two transactions means the pair can disagree, and it burns a connection from a different pool per write).

---

**Date:** 2026-07-28
**Phase / Task:** phase-1, Task 7
**Decision:** Two new API modules, `modules/settings/` (GET/PUT key-value store) and `modules/staff/` (admin + role CRUD), were added on Phase 0's existing `settings`/`admins`/`roles` tables. No migration — those tables already carry VPD policies, `sf_platform_role` grants, and `PLATFORM_TABLES` synonym entries from `001_init.sql`.
**Why:** `docs/02-PHASE-1-catalog.md` Task 7 lists "Settings" and "Staff & roles" as admin screens as if matching endpoints already existed, but the only settings read was `GET /platform/companies/:id/settings`, gated `requireRole('platform')` — a Super Admin, not a company's own admin, endpoint. Building the screens required building the API underneath them first.
**Alternatives considered:** Loosening `/platform/companies/:id/settings`'s role gate to also accept a company-scoped admin for their own company (rejected — conflates two different trust boundaries in one route; platform routes should stay platform-only, and a company self-service endpoint reads more clearly as its own module, matching the module-per-resource shape every other Phase 1 feature uses).

---

**Date:** 2026-07-28
**Phase / Task:** phase-1, Task 7
**Decision:** `admins.email`'s existing platform-wide `UNIQUE` constraint (from `001_init.sql`, predates Phase 1) is left as-is; `staff.service.js`'s `createAdmin` catches its violation and returns `409 EMAIL_TAKEN` rather than attempting to scope the uniqueness per company.
**Why:** `/auth/login` resolves an email to exactly one admin row with no company hint in the request — scoping the constraint per company would make login ambiguous (which company's admin did `owner@x.com` mean?) without also adding a company-selection step to login that nothing in Phase 0 or Phase 1 needs otherwise. Documented as an isolation test (`settings-staff.test.js`) rather than silently discovered later: it proves company B genuinely cannot claim an email already used by company A, and that this is by design, not a leak.
**Alternatives considered:** Per-company unique constraint on `(company_id, email)` plus a "select your store" step in login (rejected — meaningfully expands Phase 1 scope for a problem no phase brief raised).

---

**Date:** 2026-07-28
**Phase / Task:** phase-2, Task 5
**Decision:** Dashboard query binds are named `:fromDate`, not `:from`, in every repo function that takes a period start (`orderStatsForPeriod`, `topProductsByQty`, `revenueByDay`).
**Why:** `FROM` triggers `ORA-01745: invalid host/bind variable name` when used as a bind name, not just as an unquoted identifier — the same class of failure as Phase 0's `:size` bind (documented in `docs/PHASE-0-REPORT.md`), caught the same way, by actually running the query. The JS-side parameter itself stays named `from` (it reads naturally at every call site); only the SQL-facing bind name changes.
**Alternatives considered:** Renaming the JS parameter too, e.g. to `fromDate` everywhere (rejected — `from` reads better in `{ companyId, from, limit }`-style destructuring at every call site, and the bind/parameter names never need to match).

---

**Date:** 2026-07-28
**Phase / Task:** phase-2, Task 1
**Decision:** The commerce schema migration is `007_commerce.sql`, not `006_commerce.sql` as `docs/03-PHASE-2-orders.md` literally names it; `orders.number` is `order_no`; `order_items`/`cart_items` reference `variants(company_id, id)` with `ON DELETE SET NULL` and `ON DELETE CASCADE` respectively, not a plain restrictive FK; a new `order_seq` table (one row per company, `next_no` incremented inside the checkout transaction) backs human-friendly per-company order numbers; provisioning gained an eleventh step seeding that row, and a one-time idempotent `scripts/backfill-order-seq.js` fills it in for every company provisioned before this migration existed.
**Why:** Four independent, DB-verified findings: (1) `006` was already `006_i18n.sql` (same renumbering situation as the SKU fix earlier this phase). (2) `NUMBER` is a reserved datatype keyword — `CREATE TABLE ... (number NUMBER ...)` raises `ORA-00904` even though it isn't on the same short list as `DESC`/`VALUES`/`SIZE`; found by running the migration, which left five tables partially created before failing (DDL auto-commits per statement) and had to be dropped and re-applied. (3) `products.repo.js`'s `deleteVariantById` is a real, hard `DELETE` (products themselves are soft-deleted via `deleted_at`, but variants are not) — a plain FK from `order_items.variant_id` would eventually block deleting any variant that has ever been ordered, which breaks "renaming or repricing a product does not alter any existing order" the moment "renaming" becomes "removing." `ON DELETE SET NULL` lets the id go missing while the snapshot columns (`sku`, `name_snap`, `opts_snap`, `price_snap`) — which are the actual source of truth for a placed order — keep the order's history intact. `cart_items` gets `ON DELETE CASCADE` instead, because an active cart line pointing at a deleted variant is just dead weight the checkout flow would reject anyway. (4) A global `orders` sequence can't give "unique per company, not globally" numbers cheaply; a dedicated per-company counter row, incremented via a plain `UPDATE ... SET next_no = next_no + 1 ... RETURNING next_no INTO :out` inside the checkout transaction, gets both the number and the concurrency guarantee (the row lock the `UPDATE` takes serializes concurrent checkouts for that company) from one mechanism.
**Alternatives considered:** Quoting `"number"` (rejected, same fragility argument made three times already this project); a global Oracle `SEQUENCE` plus formatting per-company numbers cosmetically (rejected — two companies' 47th orders would collide if the sequence ever needed to be inspected or reset per company, and the brief is explicit that numbers are per-company); leaving `order_items.variant_id` as a plain restrictive FK and handling the conflict in the service layer with a "can't delete, has orders" error (rejected — that's a real product decision a store owner should not hit for something as routine as retiring a discontinued cut of meat, and it contradicts the snapshot design's whole point).

---

**Date:** 2026-07-28
**Phase / Task:** phase-3, ports
**Decision:** Storeforge owns exactly two ports on this host — `:8003` (API) and `:3001` (storefront). Every default in the code points at them (`env.js`, `storefront/package.json`, both SPAs' `api.js`, `next.config.js`), rather than relying on shell environment variables that are not set anywhere. The two Vite admin panels keep `:5173`/`:5174` for local development only; when one needs a browser check, it is run on `:3001` while the storefront is stopped.
**Why:** This machine also runs unrelated projects — `:3000` belongs to another app entirely — and the previous ports (`:4000`, `:3000`) were both squatting on a shared host. Two fixed, project-owned ports also make the Nginx server blocks and the PM2 ecosystem file in Task 5 exact rather than "whatever it started on."
**Alternatives considered:** Leaving the ports on env vars with no defaults (rejected — nothing exports them on this host, so every default was the real configuration in practice, and the two SPAs would silently talk to a dead port).

---

**Date:** 2026-07-28
**Phase / Task:** phase-3, Task 1
**Decision:** Canonical URLs, `hreflang` alternates, the sitemap and every absolute URL in JSON-LD are built on the store's **primary** domain (`domains.is_primary = 1`), not on the host the request arrived on. Requests on any other host get a `301` to the primary from `storefront/middleware.js`, and independently emit `noindex` and an empty robots.txt/sitemap.
**Why:** The phase brief requires both the redirect and the `noindex`, and they are not redundant: a crawler that has not yet followed the redirect still reads the tags on the page it already has, so a canonical naming the secondary domain would split the store's own ranking signals across its own domains. The middleware does the redirect rather than a layout-level `permanentRedirect()` because Next's redirect helpers emit `308`, and the brief asks for `301`; middleware is also cheaper, since it answers before any page renders. `middleware.js` caches host → primary host in worker memory for 5 minutes, the same TTL the API uses for its own host → company lookup (`00-SYSTEM-DESIGN.md §7`), and treats an unreachable API as "no opinion" so a dead API can never turn into a redirect loop.
**Alternatives considered:** Doing the check in the root layout with `permanentRedirect()` (rejected — `308`, and it pays for a full render first); trusting Nginx to canonicalize domains (rejected — the mapping lives in the database and changes without a deploy, which is the whole point of the tenant model).

---

**Date:** 2026-07-28
**Phase / Task:** phase-3, Task 1
**Decision:** `GET /shop/sitemap` is a new public endpoint returning every indexable path for the resolved store in one call; `storefront/app/sitemap.js` renders it and expands each path into its `hreflang` alternates. Product/Offer JSON-LD moved out of `components/ProductDetail.jsx` (a client component) into the page, via `lib/seo.js`.
**Why:** The Phase 1 sitemap walked `/shop/products?pageSize=48` and so silently listed at most 48 products, no collections, and no CMS pages; a complete sitemap cannot be assembled from paged HTTP endpoints without N round trips, so the walking happens on the database side of the boundary. The JSON-LD move fixes two real defects: the client component emitted **relative** image URLs (invalid in structured data), and once the server started emitting a Product block there were two conflicting `Product` objects on the same page. `offers` is omitted entirely when the store has no `currency` set, because an offer with a price and no `priceCurrency` is invalid — and guessing a currency for a client's store would be worse than saying nothing.
**Alternatives considered:** A sitemap index with one child sitemap per language (rejected — a translated product is the same URL in another language, which is what `alternates.languages` already expresses; an index is for stores past ~50k URLs, which is a different feature); keeping the JSON-LD in the client component and making its image URLs absolute there (rejected — a client component cannot see the request's host, so it cannot know the canonical origin at all).

---

**Date:** 2026-07-28
**Phase / Task:** phase-3, Task 2
**Decision:** Cache invalidation is one `cacheBust` middleware on every successful non-GET request, not an `invalidate()` call at the end of each mutating service function. It drops that company's `menus` and `sections` entries wholesale and asks the storefront to drop its `sf:{host}` fetch-cache tag.
**Why:** The precise version — "a product save invalidates sections but not menus, a category rename invalidates both" — is a mapping that has to be re-derived every time an endpoint is added, and the failure mode of forgetting is a client who saves a price and does not see it change. That gets diagnosed as "the cache is broken, turn it off," which costs more than the extra rebuild a coarse invalidation costs. One hook cannot be forgotten. It reads `req.companyId ?? req.admin?.companyId` because those are two different middlewares' outputs, and reading only the first silently covered no admin write at all — found by driving a real settings save end to end, not by the tests.
**Alternatives considered:** Per-service `invalidate()` calls (rejected as above); a background sweep (rejected — a cache invalidated asynchronously serves stale data for however long the sweep takes, which is the one thing invalidation exists to prevent).

---

**Date:** 2026-07-28
**Phase / Task:** phase-3, Task 2
**Decision:** Every Redis key in the API is now either `co:{id}:...` (company-owned) or `sf:...` (platform-level), including the admin-auth, customer-auth and checkout keys that predate this phase. `companyKey()` throws on an id it does not believe. `tests/integration/cache.test.js` records every key the API touches while serving real traffic and fails on any that lacks a prefix, with a negative control proving the recorder bites.
**Why:** `00-SYSTEM-DESIGN.md §7` says a missing prefix is a cross-tenant bug, and the phase brief asks for a test that fails without one. A rule with three exceptions is not a rule you can test, so the exceptions were removed rather than allow-listed; the recorder hooks `sendCommand`, which every ioredis call including pipelined ones funnels through, so a service that builds a raw key by hand is still caught.
**Alternatives considered:** Asserting over `KEYS *` before and after (rejected — this Redis is shared with other projects on the box, so other apps' keys would be false positives, and `KEYS` blocks the server); checking only keys written through `lib/cache.js` (rejected — that tests the helper, not the codebase, and the bug being guarded against is precisely code that bypasses the helper).

---

**Date:** 2026-07-28
**Phase / Task:** phase-3, Task 2
**Decision:** Prefix-scoped invalidation is backed by a per-company set of live key names (`co:{id}:idx`), not by `KEYS`/`SCAN`.
**Why:** Several cached values are per language (`menus:en`, `menus:ar`) or per page (`sections:about`), so invalidation must be able to say "every menu for this company" without knowing which languages exist. `KEYS` blocks the Redis server for the duration; `SCAN` is O(whole keyspace) for something that runs on every settings save, on a Redis this box shares with other projects. A set we maintain ourselves is bounded by what we actually wrote.
**Alternatives considered:** A per-company generation counter in the key (`co:{id}:v7:menus:en`) (rejected — costs an extra round trip on every *read* to learn the current generation, and reads outnumber invalidations by orders of magnitude).

---

**Date:** 2026-07-28
**Phase / Task:** phase-3, Task 2
**Decision:** The load-test store (`scripts/seed-loadtest.js`) seeds 10k products and 2k orders for one company **and 4k orders each for five "filler" companies**.
**Why:** The first `EXPLAIN PLAN` run against a single load-test company reported full table scans on `orders` — and the optimizer was right: that company owned 100% of the rows, so `WHERE company_id = :1` selected the whole table, and no index can beat reading a table you need all of. "No full table scans on orders" is only a meaningful criterion when a tenant is a minority of the rows, which is what production looks like. With the filler tenants (2,000 of 22,000 rows, about 9%) the same two queries switch to index range scans and the criterion means something.
**Alternatives considered:** Declaring the criterion met against the ten-product demo store (rejected — every plan is cheap at that size and the result would be noise); hinting the queries (rejected — a hint that only helps because the data is unrealistic is worse than no index).

---

**Date:** 2026-07-28
**Phase / Task:** phase-3, Task 2
**Decision:** No index on `orders(company_id, customer_id, placed_at)`, and the admin order list still shows a `WINDOW SORT`.
**Why:** `placed_at` is `TIMESTAMP WITH TIME ZONE`, which Oracle cannot index directly — it silently builds a function-based index over a hidden `SYS_NC...$` column holding `SYS_EXTRACT_UTC(placed_at)`. The optimizer does not treat that expression as equivalent to `ORDER BY placed_at` for ordering purposes, so such an index cannot eliminate a sort. It was created, measured (the plan kept choosing the existing two-column `orders_company_customer_ix`), and dropped rather than shipped as decoration. `orders(company_id, placed_at)` **is** kept: it is chosen for the dashboard's `placed_at >= :from` range scan, which is what it was added for.
**Alternatives considered:** Keeping it anyway "for safety" (rejected — an unused index costs every insert and misleads the next person reading the schema).

---

**Date:** 2026-07-28
**Phase / Task:** phase-3, Task 2
**Decision:** The storefront moved from React 18.3 to React 19, with a root `overrides` entry pinning a single React copy across all four workspaces.
**Why:** Next 15's App Router expects React 19. On React 18 the metadata Next renders into `<head>` server-side was **relocated into `<body>` during hydration**, because React 18 has no hoisting for `<title>`/`<meta>`/`<link>`: the served HTML was correct and the hydrated DOM was not, which is why it went unnoticed — it only shows up in a tool that reads `head meta` after running JavaScript. Upgrading only the storefront produced React error #31 at build time (`next` resolved the hoisted React 18 at the root while app code resolved 19 from its own `node_modules`), so the override is what makes it one copy rather than two.
**Alternatives considered:** Staying on React 18 and accepting the hydration-time relocation (rejected — it breaks the tags for anything that reads the rendered DOM); upgrading the storefront alone (rejected — proven broken, two React copies in one render).

---

**Date:** 2026-07-28
**Phase / Task:** phase-3, Task 2
**Decision:** `app/loading.js` was removed, and the routes that took Next's `searchParams` prop now read the query string from a header `middleware.js` publishes (`x-sf-query`, alongside the `x-sf-path` it already published).
**Why:** Both create a Suspense boundary around the page, and a Suspense boundary makes Next flush the HTML shell before `generateMetadata` has resolved — putting every `<title>`, `<meta>` and `<link rel=canonical>` into `<body>` instead of `<head>`. Browsers hoist them so the site looks fine, but Lighthouse's SEO audits read `head meta`, and social-preview scrapers (Facebook, WhatsApp, LinkedIn) do not run JavaScript at all, so Open Graph tags in the body mean broken link previews. Reading the query from a header is just as dynamic and does not trigger the boundary. **This did not fully fix it** — see `docs/BACKLOG.md`: with a warm cache Next still streams metadata into the body, and Lighthouse SEO sits at 92 against a 95 target.
**Alternatives considered:** Keeping `loading.js` for its navigation skeletons (rejected — an SEO defect on an e-commerce storefront outweighs a skeleton on a page that renders in about 40ms); rendering the tags as JSX and relying on React 19 hoisting (not adopted — the hoisting happens at the same point in the stream, so it inherits the same race).

---

**Date:** 2026-07-29
**Phase / Task:** post-phase-3
**Decision:** The client admin is served at `{store-domain}/admin`, built into `storefront/public/admin/`, with the API same-origin behind an `X-Storeforge-Api` header. `/auth/login` refuses an account that does not belong to the store the login was attempted on.
**Why:** A separate Vite port was a development convenience that had become the architecture — a client had to be sent to a different host to manage their own shop, and nothing in the URL said which store was being managed. Under `/admin` the tenant comes from the Host header like everywhere else. The header is needed because the storefront and the panel share path prefixes on one origin: `/products` is a shop page for a visitor and an API endpoint for the SPA, and routing on the path alone would replace every product page with JSON. The login check is what makes the URL's claim real rather than decorative; without it store A's owner could sign in at store B's `/admin` and be shown store A's data, because the company comes from the JWT.
**Alternatives considered:** Routing `/admin` in Nginx only (rejected — there is no Nginx in local development, so the two environments would disagree about where the panel lives, which is exactly the class of problem this change is fixing); a distinct subdomain per store (`admin.clientdomain.com`) (rejected — doubles the DNS and certificate work for every onboarding, and the runbook is already the longest part of the process).

---

**Date:** 2026-07-29
**Phase / Task:** post-phase-3
**Decision:** A third theme, `butcher` ("Butcher Block"), with an original palette and type pairing, plus a third demo store on `demo-c.localhost` to show it.
**Why:** `CLAUDE.md` names a reference storefront as the quality bar. The *structure* it describes — banner slider, category tiles, product rows, newsletter, footer — was already what the section registry produces, so what was missing was a theme in that register rather than any new layout code. The palette is chosen for contrast first: the accent measures ~7:1 on the background, because Phase 1 shipped an ochre at 4.47:1 that failed AA by a hair and had to be redone.
**Alternatives considered:** Reproducing a specific existing shop's design and assets (rejected — their photography, logo and copy are that business's property, and this theme ships to every client onboarded onto the platform, which would make one company's product shots part of the product sold to their competitors). Tokens are data precisely so a client's own licensed photography drops in and the theme carries it.

---

**Date:** 2026-07-29
**Phase / Task:** post-phase-3
**Decision:** Four new predefined themes — `boutique` (fashion, Playfair Display serif), `circuit` (electronics, dark canvas), `harvest` (grocery, sage green), plus the existing `butcher` — each seedable with real photography via `scripts/seed-themed-store.js`, which downloads-once/uploads-through-the-real-media-pipeline rather than generating gradients.
**Why:** The user asked for popular, ready-to-use themes with real images rather than placeholder gradients, to preview what a client's store could actually look like. Images are Unsplash-licensed (free to use, no attribution required) and are not committed to the repo or fetched at runtime — they live in `scripts/seed-assets/` (gitignored) and are only touched by the seed script, so removing that folder costs nothing but pictures on the four demo stores it seeded.
**Alternatives considered:** Fetching images from Unsplash at request time (rejected — the whole point of self-hosted media is that a store's first paint never depends on a third party being up); using Unsplash's API with a key (rejected — the CDN's direct photo URLs serve the same licensed images with no key and no rate limit for this one-time seed use).

---

**Date:** 2026-07-29
**Phase / Task:** post-phase-3
**Decision:** `admin/vite.config.js` and `superadmin`'s dev server both proxy the API's path prefixes now, matching `storefront/next.config.js` and `deploy/nginx/storeforge.conf`.
**Why:** Moving the client admin to `{store-domain}/admin` made its API calls same-origin — correct when the storefront serves it and proxies those prefixes, but the standalone Vite dev server had no such proxy. Every API call silently went to Vite instead, which answered with the SPA's own `index.html`. Reads looked like they half-worked (Vite returns 200 HTML); uploads died with a bare `fetch failed`. Found by reproducing the user's exact report end to end rather than guessing from the symptom.
**Alternatives considered:** none — the prefix list already existed in two other places, and it was missing from exactly the one place a bare `vite --port 3001` invocation goes through. The list now needs to agree in three places; that duplication is itself now called out for cleanup in `docs/troubleshooting.md`.

---

**Date:** 2026-07-30
**Phase / Task:** phase-3, ports
**Decision:** The storefront now runs on `:4000` instead of `:3001` (`storefront/package.json`, `.env`/`.env.example` `STOREFRONT_URL`, `ecosystem.config.cjs`, `deploy/nginx/storeforge.conf`, `storefront/lib/seo.js`, docs and scripts that reference it by number).
**Why:** Requested directly — `:3001` on this host was also wanted free for another purpose.
**Alternatives considered:** none — this is a straight port reassignment, not a design change.
