# Security review — Phase 3, Task 3

**Date:** 2026-07-28
**Reviewed against:** `docs/04-PHASE-3-launch.md` Task 3, `docs/00-SYSTEM-DESIGN.md` §3 and §8
**Reviewer:** this session, against the running system on Oracle 19c EE

Every item below is the brief's own wording, with what was found, what changed,
and how it was checked. "Evidence" means something that was actually run — a
test, a grep, a request — not a reading of the code.

Two items are **not resolved** and are called out as such rather than softened:
password reset does not exist, and six `npm audit` high advisories remain inside
Next's own dependency tree.

---

## Summary

| # | Item | Status |
|---|---|---|
| 1 | All inputs zod-validated | **Pass** |
| 2 | All SQL uses bind variables | **Pass** |
| 3 | `helmet`, strict CSP, HSTS | **Fixed** — the storefront had no security headers at all |
| 4 | CORS allowlist per company domain | **Fixed** — was `*` for every origin |
| 5 | Rate limits on auth, checkout, search, contact form, media upload | **Fixed** — only checkout had one |
| 6 | Uploads: magic bytes, size cap, re-encode, no SVG, no executable paths | **Pass**, hardened |
| 7 | JWT: short access, rotating refresh, revocation on logout **and password change** | **Fixed** — password change did not revoke |
| 8 | Password reset tokens: single-use, hashed, 30-min, no enumeration | **Not implemented — no reset flow exists** |
| 9 | Company admins cannot escalate to platform, read another company, or set their own `company_id` | **Critical bug found and fixed** |
| 10 | Audit log covers sensitive actions, especially impersonation | **Pass** |
| 11 | `npm audit` clean of high/critical; dependencies pinned | **Partly** — 4 fixed, 5 remain inside Next |
| 12 | Error responses leak nothing | **Pass** |

---

## 1. All inputs zod-validated

**Pass.** Every route parses its params, query and body through a `*.schema.js`
before the controller touches them; there is no `req.body.x` read directly in a
service.

**Evidence:** `grep -rn "req.body" api/src/modules --include="*.controller.js"`
returns only lines of the form `schema.parse(req.body)`. Malformed input is a
`400 VALIDATION_ERROR` from the central error middleware, exercised throughout
the integration suite.

---

## 2. All SQL uses bind variables

**Pass.** SQL lives only in `*.repo.js` (a project rule, re-checked here), and
the only values interpolated into statement text are ones this codebase
generates: column names from closed lookup tables, `ASC`/`DESC` from a
two-value branch, and bind *names* (`:pid0`, `:rule0_1`).

**Evidence:**

- `grep -rn "execute(\`.*\${" api/src --include="*.repo.js"` → 6 hits, all
  interpolating a pre-built `${where}`/`${from}` fragment whose own values are
  bound.
- `products.repo.js` `listProducts` sorts by `SORT_COLUMNS[sort] ?? …` — a
  lookup, not the caller's string — and every filter is a bind.
- `colls.repo.js`'s automatic-collection rule builder is the most dynamic SQL
  in the project: its fields come from the closed `RULE_FIELDS` allowlist, an
  unknown field or operator throws, and every user value becomes `:ruleN_M`.

---

## 3. `helmet`, strict CSP, HSTS

**Fixed.** The API has had `helmet()` since Phase 0. The **storefront — the
only part of the system that serves HTML to the public — had no security
headers whatsoever**, which is the more consequential half.

Changes:

- `storefront/next.config.js` now sets, for every path: a CSP
  (`default-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'`,
  `object-src 'none'`, `base-uri 'self'`, `upgrade-insecure-requests`), HSTS
  (1 year, `includeSubDomains`, `preload`), `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` and COOP.
- `'unsafe-inline'` is present for scripts and styles and is a deliberate,
  documented limitation: Next's bootstrap and the theme's inline custom
  properties both need it, and a nonce pipeline is a larger change. The
  directives that stop the attacks this app actually faces —
  clickjacking a checkout (`frame-ancestors`) and repointing a form at an
  attacker's host (`form-action`) — are strict.
- The API's helmet config is explicit rather than default: HSTS pinned to a
  year with `includeSubDomains` (every client store is another domain on this
  one server), `frame-ancestors 'none'`, and `crossOriginResourcePolicy:
  cross-origin` because product images are served to store domains.

**Evidence:** `curl -sI http://demo-a.localhost:3001/` shows the full header
set; `npm run ui:check` loads the pages in a real browser with them applied and
reports no console errors, so the CSP is not breaking the app.

---

## 4. CORS allowlist per company domain

**Fixed.** The API ran `app.use(cors())` — `Access-Control-Allow-Origin: *` for
every origin. Every unauthenticated endpoint (all of `/shop/*` and
`/storefront/*`) was readable cross-origin by any page on the internet.

`api/src/middleware/cors.js` now builds the allowlist from the `domains`
table — the same rows the tenant resolver reads — plus `ADMIN_ORIGINS` for the
panels. Adding a client's domain stays a data operation with no deploy, which
is the platform's central rule. The list is cached in Redis for 5 minutes under
`sf:cors:hosts`. A request with no `Origin` (server-to-server, the storefront's
own SSR fetches) is allowed, because CORS is a browser mechanism; a database
failure results in refusal, not a permissive answer.

---

## 5. Rate limits

**Fixed.** Before this review only `POST /shop/checkout` was limited.

| Route | Limit | Key |
|---|---|---|
| `POST /auth/login`, `/auth/refresh` | 20 / 15 min | `sf:auth:attempt:{ip}` |
| `POST /shop/account/login`, `/register` | 20 / 15 min | `co:{id}:account:attempt:{ip}` |
| `GET /shop/search` | 60 / min | `co:{id}:search:{ip}` |
| `POST /media` | 60 / 10 min | `co:{id}:media:upload:{ip}` |
| `POST /shop/checkout` | 10 / 15 min | `co:{id}:checkout:attempt:{ip}` (pre-existing) |

The admin login limit is per IP and sits **on top of** the existing per-account
lockout (5 failures) in `auth.service.js`: the lockout stops someone grinding
one account, the rate limit stops someone spraying one password across many
accounts from one place, and neither sees what the other does.

Customer-account limits are company-scoped so that one store under attack
cannot lock shoppers out of a different store behind the same NAT.

**There is no contact form in the product**, so that line of the brief has
nothing to apply to; when one is built it must be limited before it ships.

Limiters are disabled under `NODE_ENV=test` (every one is keyed by IP, and the
suite makes hundreds of requests from 127.0.0.1). The alternative — raising
production limits until the tests stopped failing — removes the protection
instead of the noise. The mechanism itself is covered directly by
`tests/integration/rateLimit.test.js`, including that a blocked request does
not extend its own window.

---

## 6. Uploads

**Pass**, with hardening.

- **Magic bytes:** `fileTypeFromBuffer` decides the type, not the filename or
  the client's `Content-Type`; only `image/jpeg|png|webp|avif` pass.
- **No SVG:** absent from the allowlist, deliberately — SVG is a script vector.
- **Size cap:** 10 MB, enforced by multer *while reading the stream*, so an
  oversized body is refused before it is buffered.
- **Re-encode:** every upload is re-encoded by sharp into 4 widths × 2 formats.
  sharp strips EXIF by default, so a payload embedded in metadata does not
  survive.
- **No executable paths:** the stored name is `{company_id}/{uuid}-{width}.{ext}`.
  The client's filename is kept only as a display label in the `media` row and
  never touches the filesystem.

Added this phase: `files: 1, fields: 10` alongside the size cap — without a file
count, one request could carry a hundred 10 MB parts and be "within the limit"
for each — and the upload rate limit above.

---

## 7. JWT lifecycle

**Fixed.** Access tokens are 15 minutes, refresh 7 days and rotating (the old
`jti` is deleted from Redis as the new one is written, so a replayed refresh
token fails). Logout blacklists the access token's `jti`.

**The gap:** `PATCH /admins/:id` with `resetPassword: true` changed the hash and
left every existing session working — up to seven days for a refresh token.
Resetting a compromised admin's password did not lock anyone out, which is the
one thing a reset is for. Deactivating a staff member had the same hole.

`api/src/lib/sessions.js` adds a per-admin **token epoch**: revocation writes a
timestamp, and `requireAuth` refuses any token issued before it. Blacklisting
handles "this browser is done"; the epoch handles "this account's tokens are
all void", which is what a password change and a deactivation need. Both now
call it, after the commit — revoking sessions for a change that then rolled
back would log someone out for nothing.

**Evidence:** `tests/isolation/escalation.test.js` → "a password reset ends the
sessions that already exist": logs in, confirms `/auth/me` works, resets the
password, confirms the same token now gets 401.

---

## 8. Password reset tokens

**Not implemented.** There is no forgot-password or reset flow in the product
for either admins or customers, so the brief's requirements (single-use, hashed
at rest, 30-minute expiry, no user enumeration) have nothing to attach to.

This is a **gap, not a finding**: nothing insecure exists, but an admin who
forgets their password today has no self-service recovery — a platform admin
must impersonate the company and use `resetPassword: true`, or another owner
must. For a single-owner store with a lost password, that is a support ticket.

Tracked in `docs/BACKLOG.md` with the four properties above written down in
advance, so whoever builds it inherits the requirements rather than rediscovers
them. It was not built during this review because a security-sensitive
credential-recovery flow deserves its own design and test pass, not an
afterthought at the end of a hardening task.

---

## 9. Privilege escalation

**A critical vulnerability was found here and fixed.**

`POST /admins` and `PATCH /admins/:id` validated `role` as
`z.string().min(1).max(50)` — any string. **`platform` is a string.** Any
company owner could create a staff member (or promote themselves) with
`role: "platform"`, log in, and reach every `/platform/*` route:
`GET /platform/companies`, every other client's settings and domains,
suspension, and impersonation of any company on the box. A complete
cross-tenant compromise, reachable from a normal client login with one JSON
field.

VPD did not stop it and could not: the token's claim is what
`requireRole('platform')` reads, and the platform routes deliberately use the
VPD-exempt connection.

**Fixed in two layers**, matching how the rest of the project treats tenancy:

1. `staff.schema.js` — `platform` is a reserved role and is rejected by
   validation, with a message that explains why.
2. `staff.service.js` — `refuseReservedRole()` runs inside `createAdmin` and
   `patchAdmin`, so a future caller that skips the schema (a script, a seed, a
   new endpoint) still cannot mint one. Same reasoning as the repository layer
   re-stating `company_id` that VPD already enforces.

Platform admins are created only by `scripts/seed-platform-admin.js`, with
`company_id IS NULL`.

**How it was found:** by writing the test the brief asks for. Reading the code
had not surfaced it in three phases; the first request that actually sent
`role: "platform"` did, immediately.

The other two escalation paths were already sound and now have explicit tests:

- **Cannot set their own `company_id`.** Sending `companyId`/`company_id` in
  the body of `POST /products` or `PUT /settings` is ignored — the company
  comes from the token claim (`req.admin.companyId`) or the resolved host,
  never the payload. Verified by writing rows with a foreign `companyId` in the
  body and asserting at the database level which company owns them.
- **Cannot read another company's anything.** B's product, staff record,
  settings, orders, customers and dashboard all 404 or return only A's data,
  and an attempt to deactivate B's admin leaves that row untouched.

A platform token is also not a skeleton key: it carries `company_id: null` and
is refused by company-scoped routes with `COMPANY_REQUIRED` — cross-company
access has to go through impersonation, which is logged.

**Evidence:** `api/tests/isolation/escalation.test.js`, 12 tests, part of the
release-gate suite.

---

## 10. Audit log

**Pass.** `logs` records login, failed login, logout, product create/update/
delete/bulk/stock, staff and role changes, settings saves, order status
changes, company create/update/suspend/activate, domain add/remove, and
**impersonation** — which carries the acting platform admin's id, the target
company, and the IP.

Audit entries for company-owned actions are written on the same connection and
in the same transaction as the change (a Phase 1 decision), so a rolled-back
change cannot leave a log claiming it happened.

**Evidence:** the escalation suite asserts that each impersonation appends
exactly one `impersonate` row naming the acting admin.

---

## 11. `npm audit` clean of high/critical; dependencies pinned

**Partly resolved.** Production dependencies went from 6 high advisories to 5,
and the remaining ones are all inside Next's own dependency tree.

Fixed by upgrading:

- **sharp** → 0.35.3 (libvips CVEs). This is the one that mattered: sharp
  processes every uploaded image, i.e. attacker-supplied bytes.
- **nodemailer** → 9.0.3 (email sent to an unintended domain via interpretation
  conflict).
- **postcss** → 8.5.24 (XSS via unescaped `</style>`).

Remaining, all with `fixAvailable` pointing at **downgrading Next to 14.2.35**,
which would undo the App Router the storefront is built on:

| Package | Advisory | Assessment |
|---|---|---|
| `postcss` (bundled in `next`) | XSS via unescaped `</style>` in CSS stringify | Build-time only. Our CSS is Tailwind output from our own source; no user input reaches PostCSS. |
| `sharp` (bundled in `next`) | libvips CVEs | Next's copy is used by `next/image`, which this storefront does not use — images go through the API's own sharp 0.35.3. |
| `next` | inherited from the two above | — |
| `react-router` / `react-router-dom` | RSC-mode CSRF bypass (7.12–8.2); open-redirect XSS (≤7.11) | **Both** the current and the "fixed" version carry a high advisory — downgrading to 7.11.0 was tried and simply swapped one for the other. Used purely as a client-side router in the two Vite SPAs; RSC mode is not used, and the SPAs are authenticated internal tools. |

Dependencies are pinned by `package-lock.json`, and `overrides` pins a single
React copy across all four workspaces.

**Re-check with:** `npm audit --omit=dev`. The `--omit=dev` matters: the full
tree reports 20 including devDependencies (lighthouse, autocannon) that never
run in production.

---

## 12. Error responses leak nothing

**Pass.** `middleware/error.js` returns `{ error: { code, message } }` and
nothing else. Only `AppError` carries a message the client sees; every other
throw becomes a flat `500 INTERNAL_ERROR` / "Internal server error". No stack,
no SQL, no path, no Oracle error code reaches the client — the full error is
logged server-side with the `req_id` that the response carries in
`X-Request-Id`, which is how you connect the two without telling the world.

Validation errors do return zod's `issues`, which name the offending fields.
That is deliberate: the field names are the client's own request shape, and a
400 that will not say what was wrong is unusable.

**One operational note, not a code defect:** `.env` on this machine has
`LOG_LEVEL=debug`, which logs every request's headers — including
`Authorization` — to the server log. Fine for a dev box, wrong for production;
`docs/runbooks/deploy.md` sets `LOG_LEVEL=info` and `NODE_ENV=production` as
part of the deploy checklist.

---

## What this review did not cover

- **Penetration testing.** This is a code and configuration review with tests,
  not an adversarial engagement.
- **The Oracle instance itself** — listener configuration, OS hardening, patch
  level. It is a shared machine that also hosts unrelated projects; `withPlatform`'s
  separate, VPD-exempt DB user is in scope and reviewed, the server it runs on is not.
- **Dependency supply chain** beyond `npm audit` (no provenance or lockfile
  attestation checks).
