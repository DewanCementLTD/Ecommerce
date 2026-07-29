# Runbook — Incidents

Three scenarios, worst first.

---

# 1. A data leak is suspected

**One client can see another client's data.** Stop and read this whole section
before typing anything. Everything else in this document can wait; this cannot,
and it is also the one where acting fast in the wrong order destroys the
evidence you will need.

## Revoke — first 5 minutes

```bash
# 1. Take the platform out of service. A leak that continues while you
#    investigate is a leak you chose to continue.
pm2 stop storeforge-api storeforge-storefront

# 2. End every session. Access tokens live 15 minutes and refresh tokens 7
#    days; without this, a token minted before you started still works.
redis-cli --scan --pattern 'sf:auth:*'     | xargs -r redis-cli DEL
redis-cli --scan --pattern 'sf:custauth:*' | xargs -r redis-cli DEL
```

Do **not** flush Redis wholesale — the cache keys are evidence of what was
served to whom.

## Isolate — next 15 minutes

```bash
# Preserve the logs before rotation removes them. 14 days is the window.
cp -r /var/log/storeforge /var/log/storeforge-incident-$(date +%F)

# Preserve the audit trail: it is in the database, and it is the record of
# who did what.
npm run backup:company -- --company <suspect-company-id> --out /var/incident/
```

Write down, now, before it is reconstructed from memory: who reported it, what
exactly they saw, the time, the URL, and which account they were logged in as.

## Assess

The question is always **which layer failed**, because this system has three
and they fail differently.

```sql
-- Is VPD still enabled? If any policy is missing or disabled, that is the
-- answer, and it is the most serious one.
SELECT object_name, policy_name, enable
  FROM dba_policies
 WHERE object_owner = 'ECOMM'
 ORDER BY object_name;
```

```bash
# Did anything reach data using the VPD-exempt account outside of the Super
# Admin routes? Every legitimate use is a /platform/* request.
grep -c 'platform db connection borrowed' /var/log/storeforge-incident-*/api*.log

# Impersonation: every "view as company" is logged with the acting admin.
```
Then in Super Admin → **Audit log** → quick filter **impersonate**, and the
date range around the report.

Run the release gate against the live schema — it asserts at the database level
that a connection carrying company B's context cannot read company A's rows,
using SQL with no `company_id` predicate of its own:

```bash
npm run test:isolation
```

If that suite passes and a leak still happened, the failure is above the
database: a cache key without its `co:{id}:` prefix, or an endpoint reading a
company id from a request body. `npm test -- cache.test.js` checks the first
directly; `tests/isolation/escalation.test.js` checks the second.

## Notify

Do not skip this and do not soften it. Tell affected clients what was exposed,
when, for how long, and what you have done. Check your jurisdiction's breach
notification window before deciding the timing — in many, the clock started
when you found out, not when you finished fixing it.

## Only then: restore service

Bring the platform back only when you can name the cause and have a fix
deployed. If you cannot yet, keep it down. A platform that leaks is worth less
than a platform that is offline.

---

# 2. One store is down

The rest of the platform is fine; one client's site is not.

```bash
npm run uptime -- https://<client-domain>/ https://<PLATFORM_DOMAIN>/ready
```

| What you see | Cause | Fix |
|---|---|---|
| `DOWN`, DNS does not resolve | client changed their DNS | [add-domain.md](add-domain.md) |
| `503` + "temporarily unavailable" | company is suspended | Super Admin → **Activate** |
| `404` + "not connected to any store" | no `domains` row for that host | Super Admin → Domains → Add |
| Certificate error | renewal failed | `sudo certbot renew`, then reload Nginx |
| `502` | the storefront or API process is down | see scenario 3 |

Remember the **5-minute cache**: the host→company mapping and the company row
are cached in Redis. After fixing data directly in the database, drop them or
wait:

```bash
redis-cli DEL "sf:host:<host>" "co:<companyId>:company"
```

---

# 3. The platform is down

```bash
curl -s https://<PLATFORM_DOMAIN>/ready     # this tells you which dependency
pm2 status
```

`/ready` names the failing dependency directly, which is the whole reason it is
separate from `/health`.

## Oracle is down

```bash
# On the database host
lsnrctl status
sqlplus / as sysdba
  SELECT status FROM v$instance;
  SELECT name, open_mode FROM v$database;
```

Common, in order of likelihood:

| Symptom | Cause | Fix |
|---|---|---|
| `ORA-12541: no listener` | listener stopped | `lsnrctl start` |
| `ORA-01017: invalid username/password` | credentials changed | fix `.env`, `pm2 restart storeforge-api` |
| `ORA-00257: archiver error` | **archive log destination is full** | free space in the FRA, then `ALTER SYSTEM ARCHIVE LOG ALL;` — this one takes the database down completely and it is nearly always disk |
| `ORA-12514: service not known` | wrong `DB_DSN` service name | check `lsnrctl services` |

The API does not crash when Oracle goes away — `/ready` returns 503 and the
storefront serves errors. Do not restart the API to "fix" this; it will come
back on its own when the database does.

## Redis is down

```bash
redis-cli ping                # PONG
systemctl status redis        # or the Windows service
```

Less severe than it looks. Losing Redis logs everyone out and makes every page
slower — the cache layer degrades to "slower", never to "wrong"
(`api/src/lib/cache.js` swallows its own failures). Nothing is stored only in
Redis.

## Node processes are down

```bash
pm2 status
pm2 logs storeforge-api --lines 100
pm2 restart storeforge-api
```

If PM2 shows `errored` with a climbing restart count, it gave up after 10
restarts — that is deliberate, so a bad deploy does not also peg the CPU. Read
the log before restarting again; it is nearly always a missing environment
variable or a port already in use.

## Disk is full

```bash
df -h
du -sh /srv/storeforge/media /var/log/storeforge /backup
```

Three things grow here: uploaded media, logs (capped at 14 rotated files by
`pino-roll`), and Oracle's archive logs. The third is the one that takes the
database offline.

---

## After any incident

- [ ] Write down what happened, in plain language, the same day.
- [ ] Add the symptom to [troubleshooting.md](troubleshooting.md) if it is not there.
- [ ] If a runbook step was wrong or missing, fix it now.
- [ ] If it could have been caught by a test, write the test.
- [ ] If it could have been caught by monitoring, add the check.
