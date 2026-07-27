# Phase 3 — Hardening & Launch

**Goal:** production-ready. Fast on a phone, secure, monitored, documented, and provably restorable.
**Estimated:** 2–3 weeks. Branch: `phase-3-launch`.

---

## Task 1 — SEO

- Per-page meta title/description from the DB, with sensible generated fallbacks (product → `{name} | {store}`).
- Open Graph + Twitter cards, using the product's primary image.
- `robots.txt` and per-company, per-language `sitemap.xml`, regenerated on publish.
- Canonical URLs; `hreflang` alternates across all enabled languages.
- JSON-LD: `Product` (with `offers`, availability), `BreadcrumbList`, `Organization`, `WebSite` search action.
- Clean URLs, no query-string pagination in canonicals.
- Suspended or non-primary domains must emit `noindex` and a 301 to the primary domain.

Verify with Google's Rich Results Test on a product page before signing this off.

---

## Task 2 — Performance

- Redis caching per the table in `00-SYSTEM-DESIGN.md §7`, every key prefixed `co:{id}:`. Add a test that fails if any cache key lacks the prefix.
- Next.js ISR with tag-based revalidation on product/section/menu save.
- Images: WebP/AVIF, correct `sizes`, lazy below the fold, explicit dimensions to stop layout shift, Cloudflare in front.
- Route-level code splitting; audit the bundle and remove anything heavy that isn't earning its place.
- DB: run `EXPLAIN PLAN` on the ten hottest queries; no full table scans on `products`, `orders`, or `variants`. Add missing indexes.
- Load test with `autocannon`: home, category, product. Record the numbers in the report.

**Targets:** mobile LCP < 2.5s on 4G, cached TTFB < 300ms, Lighthouse mobile performance ≥ 90.

---

## Task 3 — Security review

Work through this list and fix everything found:

- All inputs zod-validated; all SQL uses bind variables (grep the repo to prove no concatenation).
- `helmet`, strict CSP, HSTS, CORS allowlist per company domain.
- Rate limits: auth, checkout, search, contact form, media upload.
- Uploads: magic-byte check, size cap, re-encode, no SVG (script vector), no executable paths.
- JWT: short access tokens, rotating refresh, revocation on logout and password change.
- Password reset tokens: single-use, hashed at rest, 30-minute expiry, no user enumeration in responses.
- Company admins cannot escalate to platform role, cannot read another company's anything, cannot set their own `company_id`. Write explicit tests for each.
- Audit log covers every sensitive action, especially impersonation.
- `npm audit` clean of high/critical; dependencies pinned.
- Error responses leak nothing: no stack traces, no SQL, no internal paths in production.

Deliverable: `docs/SECURITY-REVIEW.md` with each item, its status, and evidence.

---

## Task 4 — Super Admin monitoring

- Platform dashboard: total companies, active vs suspended, orders per company (24h/7d), storage per company, error rate, slowest endpoints.
- Per-company health card: last order, product count, admin last login, domain/SSL status.
- Audit log browser with filters.
- Impersonation ("view as company") with a persistent banner in the UI and a full audit trail.

---

## Task 5 — Operations

- `pino` structured logs shipped to files with rotation; every line carries `req_id` and `company_id`.
- Error tracking (Sentry or equivalent) with company tagging.
- `/health` (liveness) and `/ready` (DB + Redis reachable) endpoints.
- Uptime monitoring on the platform domain plus a sample client domain.
- Nginx: gzip/brotli, cache headers for static assets, request size limits, per-domain server blocks, SSL via certbot.
- Process management: PM2 or systemd, auto-restart, zero-downtime reload.
- Backups: nightly Oracle RMAN full + archived redo logs, media rsync offsite. **Perform and document one full restore drill.** A backup that hasn't been restored is not a backup.

---

## Task 6 — Runbooks (`docs/runbooks/`)

Written for a teammate who has never touched this system:

1. `onboard-company.md` — from client request to live store, including the DNS + SSL steps and a checklist.
2. `add-domain.md`
3. `deploy.md` — including rollback.
4. `backup-restore.md` — with the drill results.
5. `incident.md` — what to do when a store is down, when Oracle is down, when a leak is suspected (this one first: revoke, isolate, assess, notify).
6. `troubleshooting.md` — common issues and fixes.

---

## Task 7 — Pilot

Onboard one real client end to end using only the runbook. Time it. Anything that required a developer, or wasn't in the runbook, is a bug — fix it and re-run.

---

## Phase exit criteria

- [ ] Lighthouse mobile ≥ 90 performance, ≥ 95 accessibility, ≥ 95 SEO on home, category, product.
- [ ] Security review complete, all high/critical resolved.
- [ ] Restore drill completed and documented.
- [ ] A non-developer can onboard a company from the runbook alone.
- [ ] Monitoring and alerts live.
- [ ] All tests green including isolation, run against Oracle 19c EE.

Write `docs/LAUNCH-REPORT.md` and a `docs/BACKLOG.md` for what comes next (payments, shipping, currency switching, free-form builder, reviews, WhatsApp ordering).
