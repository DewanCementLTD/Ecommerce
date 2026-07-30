# Runbook — Deploy, and roll back

Deploying does not take the shops offline. Rolling back is the same procedure
pointed at an older commit, which is why it is one document.

---

## Before you start

- [ ] `npm test` and `npm run test:isolation` are green **against Oracle
      Enterprise Edition**. The isolation suite is the release gate: if it
      fails, nothing ships. On Express Edition it passes without testing
      anything, because XE has no VPD — which is the most dangerous possible
      outcome for a tenant-isolation gate.
- [ ] `npm run lint` is clean.
- [ ] `npm audit --omit=dev` has no *new* high/critical entries. The known,
      accepted ones are listed in [SECURITY-REVIEW.md](../SECURITY-REVIEW.md) §11.
- [ ] You know which commit you are deploying, and which one you would go back to.

---

## Deploy

```bash
cd /srv/storeforge
git fetch --all
git checkout <tag-or-commit>

npm ci                                  # exactly the lockfile, never a resolve
npm run migrate:dry                     # read this before running it
npm run migrate

npm run build --workspace=storefront
npm run build --workspace=admin
npm run build --workspace=superadmin

pm2 reload storeforge-api               # zero downtime, one worker at a time
pm2 reload storeforge-storefront
pm2 save
```

### Why in that order

Migrations run **before** the new code starts, so a worker never meets a schema
it does not know about. This requires migrations to be backwards compatible
with the running version for the length of a reload — additive changes only:
add a column, do not rename one; add a table, do not drop one. A destructive
change needs two deploys (stop writing to it, then remove it) and is not a
thing to discover halfway through.

`pm2 reload` restarts cluster workers one at a time, waiting for each to accept
connections before stopping the next. `pm2 restart` does not — it stops
everything first. Use `reload`.

The storefront runs in fork mode (Next manages its own workers), so its reload
has a gap of a second or two. Nginx retries, and visitors see nothing.

---

## Verify

```bash
curl -s https://<PLATFORM_DOMAIN>/health          # {"status":"ok"}
curl -s https://<PLATFORM_DOMAIN>/ready           # database: ok, redis: ok
npm run uptime -- https://<PLATFORM_DOMAIN>/ready https://<A_CLIENT_DOMAIN>/
npm run ui:check -- https://<A_CLIENT_DOMAIN>/
pm2 status                                        # everything `online`, restarts not climbing
```

Then open the Super Admin dashboard and look at **error rate (1h)**. A deploy
that broke something usually shows there within a minute of real traffic.

---

## Roll back

```bash
git checkout <previous-tag>
npm ci
npm run build --workspace=storefront
pm2 reload storeforge-api storeforge-storefront
```

**Do not roll migrations back.** There is no down-migration mechanism in this
project, deliberately: reversing a schema change under pressure is how data
gets lost. If a migration is the problem, fix forward with a new migration.
This is why migrations must be additive — an additive migration is harmless to
the previous version of the code, so rolling the *code* back is always safe.

---

## Production environment

`.env` on the server, which is never committed:

```
NODE_ENV=production          # not development — this switches on file logging
LOG_LEVEL=info               # never debug in production: it logs request headers
LOG_DIR=/var/log/storeforge
ADMIN_ORIGINS=https://admin.<PLATFORM_DOMAIN>,https://super.<PLATFORM_DOMAIN>
STOREFRONT_URL=http://127.0.0.1:4000
REVALIDATE_SECRET=<a long random string>
SENTRY_DSN=                  # optional; see lib/errorTracker.js
```

`LOG_LEVEL=info` is not a preference. At `debug`, pino-http logs every
request's headers; bearer tokens are redacted (`api/src/lib/logger.js`), but
the volume alone will fill a disk.

First deploy on a new machine only:

```bash
npm run setup:platform-user      # the VPD-exempt DB user withPlatform() uses
npm run migrate
npm run seed:platform-admin      # the first Super Admin login
pm2 start ecosystem.config.cjs --env production
pm2 startup && pm2 save          # survive a reboot
```

---

## If a deploy goes wrong

| Symptom | Do this |
|---|---|
| Workers restart in a loop | `pm2 logs storeforge-api --lines 100`. Usually a missing env var. PM2 gives up after 10 restarts rather than spinning. |
| `/ready` says `database: failed` | Oracle or the network to it. [incident.md](incident.md). |
| Migration failed halfway | Oracle commits DDL per statement, so some objects may exist. Read the error, fix the `.sql`, re-run. The `migrations` table records only files that completed. |
| Storefront 500s, API is fine | almost always a build that did not finish. Re-run `npm run build --workspace=storefront`. |
| Everything looks fine, clients report stale content | the API could not reach the storefront's `/api/revalidate`. Check `STOREFRONT_URL` and `REVALIDATE_SECRET` match on both sides. |
