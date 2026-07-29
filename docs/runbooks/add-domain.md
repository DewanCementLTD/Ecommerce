# Runbook — Add or change a domain

A store can have several domains. Exactly one is **primary**: it is the domain
every canonical URL, `hreflang` alternate and sitemap entry names, and every
other domain 301s to it. That is not cosmetic — two domains serving the same
shop without one being canonical splits the store's search ranking between
them.

---

## Add a second domain to an existing store

1. **Super Admin → the company → Domains → Add.** Enter the host without a
   scheme and without `www.` (`northfieldbutchers.co.uk`, not
   `https://www.northfieldbutchers.co.uk/`). `www.` is stripped when the host is
   resolved, so adding it separately creates a domain that can never match.
2. Point DNS at the server (`A @` and `A www` → `<SERVER_IP>`).
3. Issue a certificate for it:
   ```bash
   sudo certbot --nginx -d northfieldbutchers.co.uk -d www.northfieldbutchers.co.uk
   sudo nginx -t && sudo systemctl reload nginx
   ```
4. Confirm the redirect works — this is the check that matters:
   ```bash
   curl -sI https://northfieldbutchers.co.uk/products/some-product | head -3
   ```
   Expect `HTTP/2 301` and a `location:` on the **primary** domain, with the
   path intact.

New domains resolve within **5 minutes** — the host→company lookup is cached
in Redis for that long. If you cannot wait, restart the API
(`pm2 restart storeforge-api`).

---

## Make a different domain primary

There is no button for this yet; it is a single database change, and it is
listed in [BACKLOG.md](../BACKLOG.md).

```sql
-- Both statements or neither. A store with two primaries, or none, produces
-- canonical URLs that disagree with each other.
UPDATE domains SET is_primary = 0 WHERE company_id = :companyId;
UPDATE domains SET is_primary = 1 WHERE company_id = :companyId AND host = :newPrimaryHost;
COMMIT;
```

Then drop the cached company row, or the old primary keeps being served as
canonical for up to five minutes:

```bash
redis-cli DEL "co:<companyId>:company"
```

Verify:

```bash
curl -s https://<newPrimary>/ | grep -o '<link rel="canonical"[^>]*>'
curl -sI https://<oldDomain>/ | head -3      # now 301s to the new primary
```

---

## Remove a domain

**Super Admin → the company → Domains → Remove.** The host→company cache entry
is cleared as part of the removal, so it takes effect immediately.

Do not remove the primary domain of a live store: it leaves the store with no
canonical domain, and while the storefront falls back to whatever host was
asked for, search engines will already have indexed a domain that now belongs
to nobody. Make another domain primary first.

---

## Certificate renewal

Certbot installs a systemd timer that renews anything with under 30 days left.
Check it is alive:

```bash
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

The Super Admin health card also shows each domain's certificate and days
remaining — **the company → Health → Check SSL**. That is the one place to see,
across every client, whether anything is about to expire. It is behind a button
because each check opens a real TLS connection.

Renewal fails silently if the ACME challenge path is not reachable over plain
HTTP. `deploy/nginx/storeforge.conf` keeps `/.well-known/acme-challenge/`
served on port 80 for exactly this reason; do not "tidy up" that block by
redirecting all of port 80 to HTTPS.
