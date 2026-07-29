# Runbook — Troubleshooting

Symptoms in the order you are likely to meet them. For anything that is
currently *down*, start at [incident.md](incident.md) instead.

---

## The five-minute rule

Most "it did not take effect" reports are this. The API caches, per
`00-SYSTEM-DESIGN.md §7`:

| Cached | For | Dropped by |
|---|---|---|
| host → company | 5 min | removing a domain |
| the company row (name, theme, status, currency) | 5 min | any Super Admin edit, suspend or activate |
| settings | 5 min | saving settings |
| menus, rendered page sections | 10 min | **any** successful write for that company |

Every change made **through the admin or Super Admin panels** drops the right
entries immediately. Changes made **directly in the database** do not — nothing
tells the API they happened.

```bash
redis-cli DEL "sf:host:<host>"          # after editing `domains` by hand
redis-cli DEL "co:<companyId>:company"  # after editing `companies` by hand
redis-cli --scan --pattern "co:<companyId>:*" | xargs -r redis-cli DEL   # everything
```

This is why the suspension tests in the test suite drop the cache after their
`UPDATE`: it is not test plumbing, it is the same obligation a human has.

---

## Storefront

### "This domain is not connected to any store"

No `domains` row matches the host. The host is normalised — port removed,
leading `www.` stripped, lowercased — so `www.Example.COM:443` looks up
`example.com`. Check for a typo, and check you did not enter `www.` as a
separate domain.

### "This store is temporarily unavailable"

The company is `suspended`. Super Admin → the company → **Activate**. If you
suspended it in SQL, drop `co:<id>:company` too.

### A price or product change is not showing

In order of likelihood:

1. **Fewer than 60 seconds have passed.** The storefront caches API responses
   for a minute unless told otherwise.
2. **The API could not reach the storefront to tell it.** After every write,
   the API calls the storefront's `/api/revalidate`. Check `STOREFRONT_URL` and
   `REVALIDATE_SECRET` are set and identical on both sides, then look for
   `storefront revalidation failed` in the API log.
3. **The change was made directly in the database.** See the five-minute rule.

### A category or product page started 404ing

Its slug changed. Renaming a category or product regenerates the slug, and the
slug is the URL — `/cats/featured` becomes `/cats/beef` when "Featured" is
renamed to "Beef". This is not recoverable by clearing a cache; the old address
genuinely no longer exists.

The sitemap and the store's own navigation update themselves, so nothing inside
the site breaks. What breaks is anything *outside* it: a link the client posted
on Facebook, a bookmark, a search result until Google recrawls. Warn clients
before they rename things that have been live for a while.

### Images are broken

- **404 on `/storefront/media/…`** — the row exists, the file does not. Usually
  a restored company whose media files were not copied
  ([backup-restore.md](backup-restore.md)).
- **Some sizes work, others 404** — variants are generated at upload for the
  widths that make sense for the original. An 800px original has no 1600px
  variant, and the serving code falls back to the largest that exists.
- **Everything broken after a restore** — `media/{company_id}/` was not copied.

### The site looks unstyled

The storefront process is down and Nginx is serving something else, or the
build did not finish. `pm2 status`, then rebuild.

---

## SEO

### Google shows the wrong title, or no description

```bash
curl -s https://<domain>/ | grep -o '<title>[^<]*</title>'
curl -s https://<domain>/ | grep -o '<meta name="description"[^>]*>'
```

If they are present but Google shows something else, Google has not recrawled
yet — that is not a bug in the platform.

If they are missing entirely, check the store has filled in **Settings → store
title / description**. Pages without their own meta fall back to generated text
built from the store's own data, so "missing" should be impossible; if it is
genuinely absent, see the known Next.js streaming issue in
[BACKLOG.md](../BACKLOG.md).

### Sitemap is empty

`sitemap.xml` returns an empty document for a suspended store, an unknown
domain, or a **secondary** domain. That last one is deliberate: only the
primary domain has a sitemap, because only the primary domain should be
indexed. Check which domain is primary in Super Admin.

### A secondary domain is being indexed

It should be 301ing to the primary. Test it:

```bash
curl -sI https://<secondary>/products/x | head -3
```

No redirect means the storefront could not reach the API to learn which domain
is primary (it fails open — serving the page is better than a redirect loop).
Check `/ready`.

---

## Admin panels

### "This endpoint belongs to a store. Platform admins must impersonate a company first."

Working as intended. A platform account has no `company_id`. Use Super Admin →
the company → **View as company**.

### Cannot assign the `platform` role to a staff member

Also working as intended, and deliberately so — see
[SECURITY-REVIEW.md](../SECURITY-REVIEW.md) §9. Platform admins are created
only by `npm run seed:platform-admin`.

### A staff member is still logged in after their password was reset

They should not be. A reset writes a revocation epoch and every token issued
before it is refused. If it is genuinely still working, check Redis is up —
the check fails open when it cannot reach Redis, and that is worth knowing
about immediately.

### 429 Too many requests

The rate limits are per IP. An office behind one NAT sharing a login can hit
the auth limit (20 attempts / 15 min). The limits are in
`SECURITY-REVIEW.md` §5. Clear one:

```bash
redis-cli DEL "sf:auth:attempt:<ip>"
```

If this happens often to legitimate users, raise the limit deliberately rather
than clearing keys repeatedly.

---

## Database

### `ORA-00001: unique constraint … violated`

The constraint name says which rule was broken. The common ones:

| Constraint | Meaning |
|---|---|
| `domains_host_uq` | that domain belongs to another store |
| `admins_email_uq` | email addresses are unique **across the platform**, not per company — a deliberate Phase 1 decision so login is unambiguous |
| `products_company_slug_uq` | slug already used in *this* store; slugs are unique per company |
| `media_storage_key_uq` | two media rows would point at one file |

### `ORA-00257: archiver error`

The archive log destination is full. This takes the database down completely,
and it is nearly always disk. [incident.md](incident.md).

### A query got slow

```bash
npm run explain -- <companyId>
```

Runs `EXPLAIN PLAN` over the fifteen hottest statements — the real ones, captured
from the repositories rather than copied — and fails if any full-scans
`products`, `orders` or `variants`. Note that a plan is only meaningful against
realistic data: on a store with ten products, a full scan is the correct plan.

---

## Tests

### The isolation suite fails

Nothing ships. Read the failure: it names the endpoint and which company saw
what. See [incident.md](incident.md) §1 for how to work out which of the three
layers failed.

### Tests pass but the app is broken

They test a different process from the one that is running. Restart the dev
stack — this has bitten this project before, in Phase 2, badly enough to be
written into the phase report.

### Tests fail with `429` or a rate-limit error

Rate limiting is disabled under `NODE_ENV=test`. If you are seeing 429s,
`NODE_ENV` is not `test` — check how the suite is being invoked.
