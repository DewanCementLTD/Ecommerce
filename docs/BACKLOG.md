# Backlog

Items explicitly out of the current phase's scope, parked here instead of built.

Phase 3 items are first: they are the ones with a named owner in the next
session, and two of them are the difference between the phase's exit criteria
being met and not.

---

## Next.js streams metadata into `<body>` on a warm cache (Phase 3, Task 1) — **highest priority**

The one thing standing between the storefront and the ≥95 SEO exit criterion,
and the only item here with a client-visible symptom.

Every page has a correct title, description, canonical, `hreflang` set and
JSON-LD. Where Next *puts* them is not deterministic: a cold request emits them
in `<head>`, a warm one streams them into `<body>`. Browsers hoist body-level
meta tags and Googlebot renders JavaScript, so the site looks fine — but
Facebook, WhatsApp and LinkedIn scrapers do not run JavaScript and read only
`<head>`. On a warm cache, a shared product link has no preview.

Already tried, and all three were real fixes worth keeping (see
`docs/LAUNCH-REPORT.md`): removing `app/loading.js`, moving routes off Next's
`searchParams` prop onto a middleware-published header, and upgrading to React
19 so hydration stops relocating the tags. None made placement deterministic.

Two candidates, neither attempted:

1. **Render the critical tags as JSX** in the layout and page trees and rely on
   React 19's own hoisting, instead of `generateMetadata`. Needs verifying that
   React hoists during a streamed SSR flush rather than inheriting the same
   race.
2. **Buffer the document at the edge** — have Nginx (or the Node server) hold
   the response until `</html>` before flushing. Costs streaming's
   time-to-first-byte benefit, which for pages that render in ~40ms is close to
   nothing.

Measure with `npm run ui:check` (it checks `head meta` specifically) rather than
by eye: the bug is invisible in a browser.

---

## Storefront JavaScript execution (Phase 3, Task 2)

Lighthouse mobile performance sits at 81–92 against a ≥90 target, and the whole
remaining gap is total blocking time — 340–540ms of client-side JavaScript,
worst on the product page. CLS is 0 and accessibility is 100; the layout work is
finished.

The product page hydrates an image gallery, a variant picker, a cart drawer and
three context providers. Reducing it means shipping less JavaScript — making the
gallery and variant picker server components with small client islands — which
is a component-level refactor, not a configuration change.

Note when re-measuring: scores on this machine swing up to 14 points between
runs on the same build, because it also hosts Oracle, a 10k-product test store
and an unrelated application. Take the median of three runs.

---

## Run the API under PM2 cluster mode and re-measure (Phase 3, Task 5)

Single-connection latency is 33–41ms. At 20 concurrent connections the same
pages take ~900ms: one Node process rendering React SSR is CPU-bound long
before Oracle is.

`ecosystem.config.cjs` already defines the API in cluster mode. PM2 is not
installed on this box, so the improvement is unmeasured — and unmeasured is
the same as unproven. Install PM2, start from the ecosystem file, and re-run
`npm run loadtest`.

---

## Password reset (Phase 3, Task 3)

No forgot-password or reset flow exists for admins or customers. Nothing
insecure exists — there is simply no self-service recovery, so a single-owner
store with a lost password is a support ticket (a platform admin impersonates
and uses `resetPassword: true`).

Deliberately not built inside a hardening task. When it is built, these are the
requirements, written down in advance so they are inherited rather than
rediscovered:

- tokens **single-use**, invalidated the moment they are redeemed;
- **hashed at rest** — a leaked database must not yield working reset links;
- **30-minute expiry**;
- **no user enumeration**: the response is identical whether or not the address
  exists;
- rate limited per IP *and* per address;
- redeeming one must revoke existing sessions (`lib/sessions.js` already does
  this — reuse it, do not reinvent it);
- audit-logged.

---

## Instance-level RMAN restore drill (Phase 3, Task 5)

The per-company export/restore drill is done, repeatable and documented with
results (`docs/runbooks/backup-restore.md`). The instance-level one has **never
been performed**.

The application's database accounts hold `CREATE SESSION` and `EXEMPT ACCESS
POLICY` and nothing else — they cannot take or restore an RMAN backup, and
granting them that would be a much worse idea than needing a DBA once. This
therefore needs scheduling with whoever administers the Oracle instance:
restore the most recent backup onto a spare host, open it, and count rows.

Until then, that backup is a hope. `RESTORE DATABASE VALIDATE` is a useful
weekly check but is not a restore.

---

## Alert delivery (Phase 3, Task 5)

Built and working: the Super Admin dashboard (error rate, slowest endpoints),
per-company health cards, `/health`, `/ready`, and `npm run uptime`.

Missing: anything that tells a human when they go wrong.

- **An external uptime monitor.** A check that runs on the box it monitors
  cannot report that the box is down. Point a hosted monitor at
  `https://<platform>/ready` and one client storefront.
- **A Sentry DSN.** `lib/errorTracker.js` loads Sentry dynamically when
  `SENTRY_DSN` is set and reports to the log otherwise; it needs an account and
  `npm install --workspace=api @sentry/node`.

---

## Make a different domain primary from the Super Admin panel (Phase 3)

Changing which domain is primary is currently two SQL statements plus a Redis
delete (`docs/runbooks/add-domain.md`). It should be a button, and it must set
one primary and clear the others in the same transaction — a store with two
primaries, or none, produces canonical URLs that disagree with each other.

---

## Test leftovers accumulate in `companies` (Phase 3)

The Super Admin dashboard lists several stray companies from interrupted test
runs (`Iso Staff A …`, `Dupe Co …`, `Content Co …`). Each suite cleans up in
`afterAll`, which does not run when a run is killed.

Not a correctness problem — they are inert, and tenant isolation means they
cannot affect anything — but they make the platform dashboard harder to read,
which is the one screen whose job is being readable. A `scripts/clean-test-companies.js`
matching the suites' naming conventions would do it.

---

## Nginx and TLS have never been exercised (Phase 3, Task 5)

`deploy/nginx/storeforge.conf` and `cache-paths.conf` are written and
commented, and the runbooks reference them. Neither has run: there is no Nginx
on this Windows host and no real domain to issue a certificate for. The proxy
cache key including `$http_accept` (for AVIF/WebP negotiation) and the
ACME-challenge passthrough are the two parts most worth verifying first on a
real host.

---

## Wire `npm run test:isolation` into CI (Task 10, phase-0)

Task 10 asks for the isolation suite to run as a blocking CI check. No CI is configured
in this repo yet, and the suite needs a real Oracle **Enterprise Edition** instance
(not XE) to mean anything — VPD isn't available on XE.

Two ways to give CI that Oracle access, discussed with the user, decision deferred:

1. **Ephemeral Oracle EE service container per CI run** (recommended when this gets
   picked up) — fully isolated, destroyed after the job, nothing on the shared dev
   machine exposed. Needs a GitHub Actions workflow using Oracle's official EE
   container image, plus `container-registry.oracle.com` pull credentials added as
   repo secrets (requires an Oracle account accepting the image's OTN license —
   a step only the repo owner can do).
2. **Point CI at this machine's live Oracle instance** — faster to wire since the
   schema/data already exist here, but requires opening `163.61.91.221:1521` to
   GitHub-hosted runners and storing its real credentials as repo secrets. Not
   recommended — this server also hosts other, unrelated projects.

Until one of these is set up, `npm run test:isolation` is a manual, pre-release gate
(run it locally against a real EE instance before shipping), not an automated one.

---

## ~~Wire `scripts/cleanup-expired-carts.js` into a scheduler~~ — done in Phase 3

Resolved. `ecosystem.config.cjs` runs it as a PM2 process with
`cron_restart: '15 3 * * *'` and `autorestart: false`, which is what stops PM2
treating its normal exit as a crash. It has not yet *run* on a schedule here,
because PM2 is not installed on this box — see the PM2 item above.

---

## Real SMTP send, unverified (Phase 2)

`modules/mail/` defaults to a `log` provider (no SMTP catcher on this box) and has a
working `smtp` provider via `nodemailer` behind the same interface, selected by
`EMAIL_PROVIDER=smtp` plus the `SMTP_*` vars in `.env`. The templates are verified to
render correctly (en and ar, both inspected via the log provider's output); an actual
send through a real mail server has not been. Do one real end-to-end send before
trusting this in production.

---

## ~~Storefront performance headroom (Phase 1 → Phase 3)~~ — partly done

The Redis caching layer was built in Phase 3 Task 2, with the `co:{id}:` prefix
rule enforced by a test, and it moved the API numbers substantially
(`/shop/home` from 294 to 760 req/s). It did **not** move Lighthouse
performance much, because the remaining cost is client-side JavaScript rather
than server time — which is now its own item at the top of this file.

---

## Category filters as SQL predicates

`/cats/[slug]` filters price and availability over the page the API returned, rather
than pushing them into the catalog query. Correct for a 24-item page; wrong at scale.
When product counts grow, `listProducts` should take price/stock predicates. Bundle it
with the Phase 3 performance work.

---

## Richer automatic-collection rules

The rule grammar is deliberately closed: `cat_id`, `brand`, `tag`, `price`,
`is_featured`, with `eq`/`neq`/`gt`/`lt`/`in` and a single `all`/`any` join. Nested
groups, date conditions and stock-level rules were all left out. Add them to
`RULE_FIELDS` in `colls.repo.js` if a client actually asks.
