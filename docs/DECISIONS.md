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
