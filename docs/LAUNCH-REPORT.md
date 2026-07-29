# Phase 3 — Hardening & Launch: report

**Goal:** production-ready. Fast on a phone, secure, monitored, documented, and
provably restorable.
**Status:** **six of seven tasks complete. Two exit criteria are not met**, both
named below rather than softened.
**Branch:** `phase-3-launch`
**Date:** 2026-07-28

---

## Exit criteria

| Criterion | Status |
|---|---|
| Lighthouse mobile ≥ 90 performance, ≥ 95 accessibility, ≥ 95 SEO on home, category, product | **Not met.** Accessibility **100** on all three (was 98–100). Performance **81–92**, SEO **92**. Both shortfalls are understood and are explained below. |
| Security review complete, all high/critical resolved | **Met for the code.** A critical cross-tenant privilege escalation was found and fixed. Five `npm audit` high advisories remain **inside Next's own dependency tree**, where the only offered fix is downgrading to Next 14. Documented in `SECURITY-REVIEW.md` §11. |
| Restore drill completed and documented | **Met, at the tenant level.** Export → restore → verify → drop, performed on the live database, 42 rows compared by content, no orphans. An instance-level RMAN restore drill was **not** performed — the application's DB accounts cannot, by design. `runbooks/backup-restore.md` and the backlog say so plainly. |
| A non-developer can onboard a company from the runbook alone | **Met**, after the pilot found and we fixed the one step that required a developer. |
| Monitoring and alerts live | **Partly.** The dashboard, health cards, audit browser, `/health`, `/ready` and the uptime probe are built and working. Alert *delivery* — an external uptime service, a Sentry DSN — needs accounts this machine does not have. |
| All tests green including isolation, against Oracle 19c EE | **Met.** 269 integration + 163 isolation, all green. Lint clean. All four apps build clean. |

---

## What shipped

| Task | Delivered |
|---|---|
| 1 — SEO | Canonicals, `hreflang`, OG/Twitter and JSON-LD all on the store's **primary** domain; secondary domains 301 and emit `noindex`. `GET /shop/sitemap` returns every indexable path in one call (the old sitemap silently listed at most 48 products, no collections and no pages). Product/Offer, BreadcrumbList, Organization and WebSite+SearchAction structured data. Per-store `robots.txt`. Generated meta descriptions with real fallbacks. |
| 2 — Performance | Redis cache layer per §7 with the `co:{id}:` prefix rule *enforced by a test*; tag-based storefront revalidation on every write; AVIF alongside WebP with per-request negotiation; `008_perf_indexes.sql` from real `EXPLAIN PLAN` output; load-test and plan-inspection tooling. |
| 3 — Security | A critical privilege escalation closed; CORS allowlist from the database replacing `*`; the storefront's first security headers; rate limits on auth, customer login, search and upload; session revocation on password change and deactivation; three dependency upgrades. `docs/SECURITY-REVIEW.md`. |
| 4 — Super Admin | Platform dashboard (companies, orders/revenue per store, storage, error rate, slowest endpoints), per-company health cards with real TLS checks, audit browser with company/admin/date filters, and impersonation with a non-dismissible banner. |
| 5 — Operations | Rotated + redacted logging, error tracking behind a provider interface, `/health` and `/ready`, PM2 ecosystem (including the cart-cleanup scheduler owed since Phase 2), Nginx configs, uptime probe, per-tenant backup/restore/verify. |
| 6 — Runbooks | Six, in `docs/runbooks/`. |
| 7 — Pilot | Onboarding run end to end from the runbook; ~2 minutes excluding DNS; one developer-requiring step found and fixed. |

---

## The two criteria that are not met

### SEO scores 92, not ≥95

Every page has a title, description, canonical, `hreflang` set and JSON-LD, and
they are correct. The score is lost to a single audit — **"document does not
have a meta description"** — and the cause is where Next puts the tag, not
whether it exists.

Chasing this took a long time and was worth writing down, because two of the
three things found along the way were real bugs:

1. **`app/loading.js`** wrapped every page in a Suspense boundary, which makes
   Next flush the HTML shell before `generateMetadata` resolves. Every meta tag
   landed in `<body>`. Removed.
2. **Routes taking Next's `searchParams` prop** are auto-wrapped in Suspense
   for the same reason. They now read the query from a header `middleware.js`
   publishes — same dynamic behaviour, no boundary.
3. **React 18 was moving the tags out of `<head>` during hydration.** Next 15's
   App Router expects React 19, which hoists `<title>`/`<meta>`/`<link>`; React
   18 does not, so the *served HTML* was correct and the *hydrated DOM* was
   not. Upgraded to React 19 across all four workspaces with a root `overrides`
   pin (upgrading only the storefront produced React error #31 — two React
   copies in one render).

After all three, placement is **still not deterministic**: a cold request puts
the metadata in `<head>`, a warm one streams it into `<body>`. That is Next's
streaming behaviour and not something this code controls from where it stands.

**Why it still matters and is not cosmetic:** browsers hoist body-level meta
tags, so the site looks fine and Googlebot (which renders JS) is fine. Social
preview scrapers — Facebook, WhatsApp, LinkedIn — do not run JavaScript and
read only `<head>`. On a warm cache, an OG tag in the body means a broken link
preview. Top item in `BACKLOG.md`, with the two candidate fixes.

### Performance scores 81–92, not ≥90 consistently

| Page | Performance | LCP | CLS | TBT |
|---|---|---|---|---|
| Home | 82 | 3.1s | **0** | 480ms |
| Category | 89 | 2.6s | **0** | 340ms |
| Product | 81 | 2.8s | **0** | 540ms |

Two honest observations:

- **CLS is 0 everywhere** and accessibility is 100 everywhere. The layout work
  is done.
- **The scores swing by up to 14 points between runs on the same build** (the
  product page measured 76, 81, 86, 87 and 90 across this session). This
  machine runs Oracle, a 10,000-product test store, another unrelated
  application, and the Lighthouse browser itself. These numbers are a *floor*,
  not a measurement of the product.

What is real, and measured single-connection against a production build:

| | Result | Target |
|---|---|---|
| Warm TTFB, home | 27–44 ms | < 300 ms ✅ |
| Warm TTFB, category / product | 32–40 ms | < 300 ms ✅ |
| LCP (Lighthouse mobile emulation, throttled) | 2.6–3.1 s | < 2.5 s ❌ |

The remaining gap is **total blocking time** — client-side JavaScript
execution, worst on the product page, which hydrates a gallery, a variant
picker, a cart drawer and three context providers. Reducing it means shipping
less JavaScript, which is a component-level refactor rather than a
configuration change. Backlogged with that framing.

**Throughput** deserves its own note. Single-connection latency is 33–41ms; at
20 concurrent connections the same pages take ~900ms. One Node process
rendering React SSR is CPU-bound long before Oracle is. The answer is already
written: PM2 cluster mode (`ecosystem.config.cjs`). It is not measured here
because PM2 is not installed on this box.

---

## The security finding

`POST /admins` and `PATCH /admins/:id` validated `role` as
`z.string().min(1).max(50)`. **`platform` is a string.**

Any company owner could create a staff member — or promote themselves — with
`role: "platform"`, log in, and reach every `/platform/*` route: every other
client's settings and domains, suspension, and impersonation of any company on
the box. A complete cross-tenant compromise, reachable from an ordinary client
login by adding one JSON field.

VPD could not have stopped it. The token's claim is what
`requireRole('platform')` reads, and the platform routes deliberately use the
VPD-exempt connection.

It is now refused at the schema **and** the service layer, matching how the
rest of the project treats tenancy — the repository layer restates
`company_id` that VPD already enforces, for the same reason.

**It was found by writing the test the brief asked for.** Three phases of
reading this code had not surfaced it. The first request that actually sent
`role: "platform"` did, immediately.

---

## Bugs found by running it, not by reading it

The pattern from every previous phase held.

1. **`req.host` is a getter on Express's `IncomingMessage`** — assigning to it
   throws. Every storefront request 500'd until it was renamed.
2. **`cacheBust` invalidated nothing on admin writes.** It read `req.companyId`,
   which only `tenantResolver` sets; an authenticated admin's company lives on
   `req.admin.companyId`. Every client save left the cache stale. Found by
   driving a real settings save end to end.
3. **The first `EXPLAIN PLAN` run said "full table scan on orders"** — and the
   optimizer was right. The load-test company owned 100% of the rows, so
   `company_id = :1` selected the whole table. The criterion is only meaningful
   when a tenant is a *minority* of the table; five filler tenants later, the
   same queries use an index range scan.
4. **An index that measured as useless.** `orders(company_id, customer_id,
   placed_at)` cannot eliminate a sort, because Oracle indexes `TIMESTAMP WITH
   TIME ZONE` through a hidden `SYS_NC…$` virtual column the optimizer will not
   equate with `ORDER BY placed_at`. Built, measured, dropped.
5. **`Cannot navigate to invalid URL`** — Git Bash rewrites a leading `/` in an
   argument into a Windows path, so `/dashboard` reached Node as
   `C:/Program Files/Git/dashboard`.
6. **Three defects in the restore path**, each found only by restoring: JSON
   has no date type (`ORA-01843`), `media.storage_key` is globally unique, and
   a wrong column name in the foreign-key map (`media_mobile_id`, not
   `mobile_media_id`) pointed banner images at the *source* company — caught
   only because the composite `(company_id, id)` foreign keys refused it.
7. **A missing favicon** was the "browser errors were logged to the console"
   Lighthouse kept reporting. Now generated per store from its own name and
   palette.
8. **`scripts/lighthouse.js` pinned `--remote-debugging-port=9222`**, so a
   second run could not start while an earlier headless Chrome lived, and hung
   with no output.

---

## Deviations from the brief

1. **No contact form exists**, so the rate limit the brief asks for on one has
   nothing to apply to. Noted in `SECURITY-REVIEW.md` §5.
2. **No password reset flow exists**, so the brief's requirements for reset
   tokens have nothing to attach to. Not built during a hardening task:
   credential recovery deserves its own design and test pass. Backlogged with
   the four required properties written down in advance.
3. **Cloudflare is not in front of anything.** No domain, no account. The
   caching that would sit behind it — immutable media headers, `Vary: Accept`,
   Nginx cache zones — is configured and correct.
4. **Rate limiters are disabled under `NODE_ENV=test`.** Every one is keyed by
   IP and the suite makes hundreds of requests from 127.0.0.1. The alternative
   — raising production limits until tests passed — removes the protection
   instead of the noise. The mechanism has its own direct test.
5. **`orders_company_cust_placed_ix` was deliberately not shipped** (see above).
6. **The restore drill is tenant-level, not instance-level.** Explained in the
   criteria table and in the runbook.

---

## Numbers

**Tests:** 269 integration + 163 isolation (from 247 + 149 at the end of Phase
2), all green against Oracle 19c EE, reproducibly stable with
`--no-file-parallelism`. Lint clean. All four apps build clean.

**API throughput** (autocannon, 20 connections, 10s, warm):

| Endpoint | req/s | mean | p97.5 |
|---|---|---|---|
| `/shop/home` | 456–760 | 26–43 ms | 42–71 ms |
| `/shop/products` | 204–271 | 73–97 ms | 123–164 ms |
| `/storefront/company` | 590–1492 | 13–33 ms | 26–52 ms |

`/shop/home` went from **294 to 760 req/s** when one uncached query — the
published-pages lookup that ran before every cached section render — was moved
behind the cache.

**Images:** AVIF is **53% smaller** than WebP on a representative demo product
image (889 B vs 1,900 B at 640px). 270 pre-existing variants backfilled.

**Restore drill:** 15 non-empty tables, 42 rows compared by content, 104 media
files, no orphans, clean drop.

---

## The pilot

Onboarding was run end to end against a real store from
`runbooks/onboard-company.md` alone: **about two minutes** for everything that
does not wait on DNS.

Company created → storefront answering with the store's name → `robots.txt` and
`sitemap.xml` on its own domain → owner logged in → settings saved → category
renamed → product added → product live on the storefront with its own title and
description → health card in Super Admin showing the product count and the
owner's last login.

**One step required a developer, and that is the pilot's whole purpose.** The
runbook says to agree a theme with the client, and the Super Admin create form
had no theme field — every store created through it rendered in the fallback
palette until someone ran an `UPDATE`. Fixed: `GET /platform/themes` and a
Theme dropdown. Re-run, the store came up in the right palette.

Two more things the pilot taught, now written into the runbooks: renaming a
category changes its URL, and `ui:check` needs a hosts entry for a `.localhost`
domain.

---

## What the next session should do

1. **The metadata streaming issue** (top of `BACKLOG.md`). It is the only thing
   between this and the SEO criterion, and broken social previews are a
   client-visible symptom.
2. **Install PM2 and re-measure under cluster mode.** The single-process
   throughput ceiling is the largest performance number left, and the fix is
   already written.
3. **Password reset.** The requirements are pre-written in the backlog.
4. **Arrange the RMAN restore drill with whoever administers Oracle.** The
   per-company drill is done and repeatable; the instance-level one has never
   been performed, and until it is, that backup is a hope.
5. **Point an external uptime monitor** at the platform and one client domain.
   `npm run uptime` is the check; nothing is watching it from off the box.
6. **Clean up test leftovers.** The Super Admin dashboard shows several stray
   companies from interrupted test runs (`Iso Staff A …`, `Dupe Co …`). The
   suites clean up after themselves when they finish; they do not when killed.
