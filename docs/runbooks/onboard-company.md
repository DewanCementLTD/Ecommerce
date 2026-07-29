# Runbook — Onboard a new client store

**Who this is for:** anyone. This is deliberately written so it needs no
developer. If you hit a step that requires one, that is a bug — record it and
tell the team.

**How long it takes:** about 12 minutes of work, plus waiting for DNS.

**What you need before you start:**

| Thing | Example | Who gives it to you |
|---|---|---|
| Store name | `Northfield Butchers` | the client |
| Domain | `northfieldbutchers.com` | the client |
| Owner's email | `sam@northfieldbutchers.com` | the client |
| Owner's name | `Sam Patel` | the client |
| Currency code | `BDT`, `AED`, `GBP` | the client |
| Default language | `en` / `English` | the client |
| Theme | `cleaver` or `harbour` | you, with the client |

---

## 1. Create the company (2 min)

1. Open the **Super Admin** panel and log in.
2. **New company**. Fill in the form using the table above, including the
   **Theme** dropdown — leave it on "Default palette" only if the client has no
   preference. (The pilot run of this runbook found there was no theme field at
   all, which meant every new store rendered in the fallback palette until a
   developer changed it in SQL. It was added because of that.)
3. Submit.

The panel shows a **one-time password** for the owner's login. It is shown
once and never again. Copy it somewhere before you navigate away.

What just happened, so you can answer the client's questions: one database
transaction created the company, its first domain, the owner's login, its
default settings and language, four pages (Home, About, Contact, Privacy), a
home page with five sections already arranged, three starter categories, and
header and footer menus. The store is renderable from this moment — it has no
products yet, but it is not broken.

> **If it fails with "That domain is already connected to a store"** the domain
> is in use by another client. Nothing was created — the whole thing rolls
> back. Check with the team before reassigning a domain.

---

## 2. Point the domain at us (2 min of work, up to 24h of waiting)

Give the client these records, or set them yourself if you manage their DNS:

```
A     @      <SERVER_IP>
A     www    <SERVER_IP>
```

Then check it has taken effect:

```bash
nslookup northfieldbutchers.com
```

Until this resolves to our server, nothing below will work. That is normal and
is not a fault with the platform.

---

## 3. Issue the certificate (3 min)

On the server:

```bash
sudo certbot --nginx -d northfieldbutchers.com -d www.northfieldbutchers.com
sudo nginx -t && sudo systemctl reload nginx
```

Certbot edits the Nginx config in place and sets up automatic renewal. Confirm:

```bash
curl -sI https://northfieldbutchers.com | head -1     # expect HTTP/2 200
sudo certbot certificates                            # expect ~89 days left
```

Detail and troubleshooting: [add-domain.md](add-domain.md).

---

## 4. Check the store answers (1 min)

```bash
npm run uptime -- https://northfieldbutchers.com/ https://<PLATFORM_DOMAIN>/ready
```

Both must say ` ok `. Then open the site in a browser. You should see a themed
storefront with the store's name and empty category tiles. Empty is correct at
this stage.

---

## 5. Hand over to the client (3 min)

Send the owner:

- the admin panel URL,
- their email address as the username,
- the one-time password from step 1, and
- a note to change it on first login (**Staff → their name → Reset password**).

Tell them their first three jobs, in this order:

1. **Settings** — store title and description (these are what Google shows),
   contact email and phone.
2. **Media → upload**, then **Categories** — rename the three starter
   categories to their real ones. Tell them this now: **renaming a category
   changes its web address.** "Featured" at `/cats/featured` becomes "Beef" at
   `/cats/beef`, and the old address stops working. Doing it on day one costs
   nothing; doing it a year later breaks every link and bookmark to it.
3. **Products → New product**.

---

## 6. Verify the store is really live (1 min)

Once the client has added at least one product:

```bash
npm run ui:check -- https://northfieldbutchers.com/ https://northfieldbutchers.com/cats/<a-real-category>
```

> **Testing against a `.localhost` domain?** `ui:check` drives a real browser,
> so the hostname has to resolve. Windows does not resolve `*.localhost`
> automatically — add it to `C:\Windows\System32\drivers\etc\hosts`. Real
> client domains resolve through DNS and need nothing.

Every line must say ` ok `. It checks for layout overflow at 375px, images
without alt text, unnamed buttons, broken images, missing headings, browser
console errors, and a missing meta description or canonical URL.

Then confirm the SEO basics resolved to the client's own domain:

```bash
curl -s https://northfieldbutchers.com/robots.txt
curl -s https://northfieldbutchers.com/sitemap.xml | head -20
```

`robots.txt` must name the client's sitemap, and the sitemap URLs must be on
the client's domain — not ours, and not another client's.

---

## Checklist

Copy this into the ticket:

```
[ ] Company created in Super Admin, one-time password saved
[ ] DNS A records set and resolving to our server
[ ] Certificate issued, https:// returns 200, ~89 days remaining
[ ] npm run uptime — storefront and API both ok
[ ] Owner sent URL, username, one-time password
[ ] Owner has logged in and changed the password
[ ] Settings filled in (title, description, contact)
[ ] At least one category renamed and one product added
[ ] npm run ui:check clean on home and a category page
[ ] robots.txt and sitemap.xml on the client's own domain
[ ] Health card in Super Admin shows the store's product count and last login
```

---

## If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| "This domain is not connected to any store" | the `domains` row is missing or the host is spelled differently | Super Admin → company → Domains. `www.` is stripped automatically; do not add both. |
| Site loads but is unstyled/blank | the storefront process is down | `pm2 status`, then `pm2 restart storeforge-storefront` |
| "This store is temporarily unavailable" | the company is suspended | Super Admin → company → **Activate** |
| Certificate errors | DNS has not propagated | wait, re-run certbot |
| Owner cannot log in | password already changed, or the account is inactive | Super Admin → **View as company** → Staff → Reset password |

More: [troubleshooting.md](troubleshooting.md).
