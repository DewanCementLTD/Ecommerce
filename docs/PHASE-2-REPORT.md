# Phase 2 — Cart, Orders & Customers: report

**Goal:** a visitor can place an order; the client can manage it. Manual/COD only.
**Status:** **complete.** All six tasks done and green.
**Branch:** `phase-1-catalog` (Phase 2 was built in the same session immediately after Phase 1's Task 7; see "What the next session should do" — it never got its own branch cut).
**Date:** 2026-07-28.

---

## Exit criteria

| Criterion | Status |
|---|---|
| Full journey works on a phone: browse → add to cart → checkout → order appears in the client admin | **Met.** Driven end-to-end in a real browser at 375px against the live demo store: product page → Add to basket → drawer → `/checkout` → placed → confirmed in `admin`'s order list and detail screen. |
| Stock decrements correctly; concurrent checkouts on the last item can't oversell | **Met.** A conditional `UPDATE variants SET stock = stock - :qty WHERE stock >= :qty` is the entire guard — no `SELECT ... FOR UPDATE`. Proved with an actual `Promise.all([...])` of two simultaneous checkouts against a one-unit variant: exactly one succeeds, the other gets `409 INSUFFICIENT_STOCK`, every time. |
| Renaming or repricing a product does not alter any existing order | **Met.** `order_items` snapshots name/sku/opts/price at checkout; a dedicated test renames and 60×-reprices a product after an order exists and asserts the order is untouched. |
| Status transitions are enforced and logged; invalid transitions are rejected | **Met.** `new→confirmed→delivered`, anything→`cancelled`, enforced in the service layer only, each change writing `order_log` in the same transaction. |
| Emails arrive in the right language with the right branding | **Met, via the `log` provider** — this box has no SMTP catcher (same "no Docker, native services only" reasoning as Phase 0/1), so delivery is verified by inspecting the rendered output rather than an inbox: confirmed en and ar templates both render correct subject/body, and branding (name, primary color) comes from the same company shape `tenant.js` already builds. `smtp` provider (nodemailer) exists and is config-selected but unexercised against a real mailbox on this host. |
| Zero payment-gateway code exists in the repo | **Met.** Grepped `api/src` and `storefront` for `stripe\|paypal\|payment\|gateway` — no matches beyond this report and the brief's own words. |
| Isolation suite green, including orders and customers | **Met.** 149 isolation tests (up from 131 at the end of Phase 1), all passing against live Oracle 19c EE. |

**Totals:** 247 integration + 149 isolation tests, lint clean, storefront and admin production builds both clean.

---

## What was built

| Task | Delivered |
|---|---|
| 1 | `007_commerce.sql` — customers, addrs, carts, cart_items, order_seq, orders, order_items, order_log. VPD policy + grant + composite FK on every one. |
| 2 | `modules/carts/` — public cart API (`/shop/cart`), token-based, revalidates price/stock/availability on every read. |
| 3 | `modules/orders/` — `POST /shop/checkout` (the two-pass transaction described below), admin order management, CSV export, customer order history. |
| 4 | Storefront: cart drawer, checkout page, confirmation screen, account login/register, order history, sticky mobile add-to-cart. Next route handlers (`app/api/*`) as the one place the storefront talks to Express for writes. |
| 5 | `modules/dashboard/` — `GET /dashboard/summary`: today/7d/30d with deltas, awaiting-confirmation count, low-stock/out-of-stock alerts, top-10 products, 30-day revenue series. Every number computed in SQL. |
| 6 | `modules/mail/` — provider adapter (`log` default, `smtp` via nodemailer), en/ar templates for order confirmation, status change, and the admin new-order notice. |
| — | `modules/customers/` (built ahead of Task 3 since checkout needs it) — customer accounts (register/login/refresh/logout, its own JWT claim and Redis namespace, parallel to `modules/auth/`, not a reuse of it), address book, admin customer list. |
| — | Admin UI: orders (list/detail/status/CSV), customers, a real dashboard replacing Phase 1's placeholder. |

---

## The checkout transaction, in detail

Because this is the one place in the whole project where a real mistake costs a client actual money, it's worth spelling out precisely what `POST /shop/checkout` does:

1. **Pre-check** (before any transaction): idempotency key lookup in Redis: an existing key returns the same order instead of creating a second one. Cart loaded and revalidated; empty or unavailable/out-of-stock lines fail fast with a clear error.
2. **Transaction opens.** Guest checkout finds-or-creates a customer row (matched by email if one was given; a phone-only guest always gets a fresh row rather than a brittle phone-matching heuristic). Cart items are re-read on the transaction's own connection. Current prices are re-fetched fresh (a separate connection is fine for a read; only the write needs to be atomic).
3. **Pass 1 (validate + total):** for every line, confirm the variant is still available, compute the current unit price and line total, accumulate the order subtotal. Nothing is written yet.
4. **Order row inserted** with the real computed totals and the next `order_no` from `order_seq` (a per-company counter row; the `UPDATE ... RETURNING` that increments it takes a row lock, which is what serializes two concurrent checkouts for the same company onto different numbers).
5. **Pass 2 (the actual write):** for each line, a conditional stock decrement (`stock >= qty` in the `WHERE`) — if it affects zero rows, the whole transaction (including the order row from step 4) rolls back with `409 INSUFFICIENT_STOCK`. Otherwise the snapshot `order_items` row is inserted.
6. **Commit.** `order_log` gets the initial "Order placed" entry in the same transaction.
7. **Outside the transaction, after commit:** the cart is cleared, the idempotency key is stored, and confirmation/admin-notice emails are sent — deliberately last, so a mail provider outage can never roll back an order that has already committed.

---

## Bugs I shipped and then found

Worth recording, because — same pattern as every previous phase — none of these were caught by writing the code, only by running it:

1. **`orders.number` isn't a legal column name.** `NUMBER` is a reserved datatype keyword; `CREATE TABLE ... (number NUMBER ...)` raises `ORA-00904` even unquoted, a different failure mode than `DESC`/`VALUES`/`SIZE` but the same root cause. DDL auto-commits per statement, so this left five tables half-created before the migration failed; they had to be dropped and the migration re-applied clean. Renamed to `order_no`.
2. **A dashboard query bound named `:from` hit `ORA-01745`** — `FROM` is reserved as a bind variable name too, not just as an identifier. Renamed to `:fromDate` in all three affected functions; the JS-side parameter stayed `from` since it reads better at call sites.
3. **`countOutOfStockProducts`'s first draft returned one row per matching product**, not a count — a `GROUP BY ... HAVING` with no outer aggregation. Caught before it ever ran, while writing the dashboard integration test.
4. **Two separate `deleteX` service functions forgot `conn.commit()`** (`staff.service.js`'s `deleteRole`, `customers.service.js`'s `deleteAddr`) — both returned success, and the row was still there on the next read, because the DELETE rolled back silently when the pooled connection was returned. Both caught by the integration test's very next assertion, not by the delete call "succeeding." Worth calling out as a pattern now that it's happened twice: a delete that reports success without checking the row is actually gone is not proof of anything.
5. **The storefront's language-prefix middleware treated `/api` as a language code.** `/ar/cats/beef` → `/cats/beef` relies on "a 2-3 letter first segment is a language, and no real route prefix is that short" — true for Phase 1's routes (`cats`, `products`, `pages`, `search`, …), false the moment Phase 2 added `/api/*`. Every cart/checkout/account route handler 404'd through this rewrite before it ever reached the handler. Excluded via `config.matcher`, the same way `_next`/`fonts`/`favicon.ico` already were.
6. **The "added to cart" toast rendered on top of the cart drawer's own checkout button**, both at the same trigger (adding an item opens the drawer and shows a toast at once), and the toast's `z-50` sat above the drawer's `z-40`. An automated click on "Go to checkout" landed on the toast instead and silently did nothing. The drawer is modal-like and needed to win; swapped the stacking order.
7. **The dev API server ran stale for a long stretch of this session.** `node --watch` didn't restart cleanly across the volume of new files Phase 2 added (whole new route modules, not edits to already-loaded files), so `/dashboard/summary` and friends 404'd through Express's own catch-all long after the code existed on disk. A full restart of the dev stack fixed it. Worth remembering for next time: a passing test suite and a 404 from the actual running app are not in conflict — they're testing two different processes.

The pattern holds from every phase so far: every one of these needed a real browser, a real database, or an actual running server — never just reading the code.

---

## Deviations from the brief

1. **Migration is `007_commerce.sql`, not `006_commerce.sql`** as `docs/03-PHASE-2-orders.md` literally says — `006` was already `006_i18n.sql`. Same renumbering situation as Phase 1's SKU fix.
2. **`order_seq` is a new table**, not in the brief's schema list. A global Oracle sequence can't give "unique per company" order numbers cheaply; a per-company counter row, incremented via `UPDATE ... RETURNING` inside the checkout transaction, gives both the number and the concurrency guarantee (the row lock serializes same-company checkouts) from one mechanism. Provisioning gained an eleventh step seeding it; `scripts/backfill-order-seq.js` (idempotent) covers every company that existed before this migration.
3. **`order_items.variant_id` is `ON DELETE SET NULL`, `cart_items.variant_id` is `ON DELETE CASCADE`** — not a plain FK. `products.repo.js`'s `deleteVariantById` is a hard delete (products are soft-deleted; variants are not), and a restrictive FK would eventually block removing any variant that has ever been ordered. The snapshot columns are the actual source of truth for a placed order, so losing the back-reference costs nothing.
4. **Customers are a new module built ahead of schedule.** The brief lists customer accounts under Task 3 (checkout), but checkout can't find-or-create a customer without the module existing first, so it was built as groundwork rather than inline with checkout.
5. **`modules/dashboard/` and `modules/mail/` have no repo of their own.** Dashboard composes `orders.service` and `products.service`; mail has no table at all. Both follow the "reuse via service, not another module's repo" rule already established in Phase 1, just with no SQL of their own to add.
6. **The cart token is an explicit header (`X-Cart-Token`), never a cookie Express sets.** This codebase has never had cookie handling in the API — even admin JWTs are bearer-only — so the boundary stays clean: Express is a pure token-in/token-out API, and the Next.js route handlers (`app/api/*`) are the only place that turns tokens into browser cookies (httpOnly, for both the cart token and the customer's JWTs).
7. **No CI wiring, still.** Same gap `docs/BACKLOG.md` already tracks from Phase 0 — the isolation suite remains a manual pre-release gate, run against live Oracle 19c EE by hand.

---

## Oracle gotchas hit this phase

Additions to the running list, both found by running against the real database:

- **`NUMBER` is a reserved datatype keyword**, and using it as a plain column name fails even unquoted (`ORA-00904`) — a different failure shape than the `DESC`/`VALUES`/`SIZE` class from earlier phases, but the same lesson: check every column name against `v$reserved_words`, including ones that don't look like keywords at first glance.
- **`FROM` is reserved as a bind variable name**, not just as an identifier — `ORA-01745`. Same class as Phase 0's `:size` bind.

---

## Performance

Not re-measured this phase — Lighthouse's Phase 1 numbers (85/89/82 mobile performance, ≥95 accessibility everywhere) apply to the storefront's catalog/content pages, which this phase didn't touch beyond adding client-side cart/checkout components. The honest fix for the performance number is still the Redis caching layer in `00-SYSTEM-DESIGN.md §7`, still correctly scheduled as Phase 3 Task 2, still not pulled forward.

---

## Tooling added

- `scripts/backfill-order-seq.js` — one-time, idempotent; seeds `order_seq` for any company provisioned before this migration existed.
- `scripts/cleanup-expired-carts.js` — the 30-day cart cleanup the brief asks for, one `DELETE` across every company via `withPlatform`. No cron on this dev host; needs wiring into whatever scheduler production ends up using.

---

## What the next session should do

1. **Cut the actual `phase-2-orders` branch retroactively, or note in the repo that Phase 1 and Phase 2 shipped on `phase-1-catalog`.** This session built both phases back to back per direct instruction rather than in separate sessions, which is why `docs/PHASE-1-REPORT.md` and this report share a branch — flagged here so it isn't mistaken for an oversight later.
2. **Phase 3 (`docs/04-PHASE-3-launch.md`)** is next: SEO pass, mobile QA, the Redis caching layer, Super Admin monitoring, backups/runbooks, a pilot with one real client.
3. **Wire `scripts/cleanup-expired-carts.js` into a real scheduler** once Phase 3 picks a production process manager — it's a no-op today, run by hand.
4. **If a real SMTP provider is ever configured** (`EMAIL_PROVIDER=smtp` + the `SMTP_*` vars in `.env`), do one real end-to-end send before trusting it in production — the `log` provider proves the templates render correctly, not that a real mail server accepts them.
5. **Watch the same three obligations for any new table:** VPD policy in the migration, grant to `sf_platform_role`, entry in `PLATFORM_TABLES` — none needed this phase since Phase 3's scope (per the brief) doesn't add new company-owned tables, but the next one that does should not skip this.
