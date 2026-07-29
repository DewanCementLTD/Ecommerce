# Runbook — Backup and restore

There are two different disasters here, and one plan does not cover both.

| Disaster | How likely | Covered by |
|---|---|---|
| One client's data is wrong — a bad import, a mistaken bulk delete, "can we have yesterday back" | often | **Per-company export/restore**, below. Runnable by anyone on the team. |
| The database or the server is lost | rare | **RMAN + Data Pump**, below. Requires a DBA. |

The application's database users (`ecomm`, `ecomm_platform`) hold `CREATE
SESSION` and `EXEMPT ACCESS POLICY` and nothing else. They cannot take or
restore an instance backup, and they should not be able to — an application
account that can read and write every datafile is a much bigger risk than the
inconvenience of needing a DBA once.

---

## Per-company export and restore

### Take an export

```bash
npm run backup:company -- --company 352
# → backups/company-352-2026-07-28T17-34-03-710Z.json
```

One JSON file with every row the company owns across 23 tables, plus its
domains, staff and roles. It does **not** contain media files — those are on
disk and are covered by the file backup below — but it does contain the media
*rows*, so a restore knows which files it expects.

`logs` is deliberately excluded. An audit trail belongs to the platform, and
re-inserting it under new ids would be forging history.

### Restore it

```bash
npm run restore:company -- --file backups/company-352-….json --name "Northfield (restored)"
```

The restore creates a **new, suspended company** rather than overwriting the
original. That is on purpose: a restore that overwrites cannot be checked
before it is trusted, because the thing you would compare against is gone.
Restoring alongside means you can look at the result, verify it, and only then
repoint the domain — which takes seconds and is reversible.

Every `id` is `GENERATED ALWAYS AS IDENTITY`, so the restore assigns new ids
and rewrites every foreign key as it goes.

The command prints the file-copy for the media:

```bash
robocopy media\352 media\7734 /E        # Windows
cp -r media/352 media/7734              # Linux
```

Do it. Row counts will pass without it and the store will be full of broken
images.

### Verify it — this is the step that makes it a backup

```bash
npm run restore:company -- --file backups/company-352-….json --name "…" # prints the id
node scripts/verify-restore.js --file backups/company-352-….json --company 7734
```

Expected:

```
PASS  company 7734 matches backups/company-352-….json
      15 non-empty tables, 42 rows compared by content, no orphans
```

It compares row counts per table, then compares the content of the rows a
store is judged by — product names, slugs, prices, stock, category names, page
titles, order totals — and finally checks that no restored row points at a
parent that does not exist. "The script ran without errors" is not evidence: a
script that inserted half the rows and committed also runs without errors.

### Put it live

1. Look at the restored store. Impersonate it from Super Admin
   (**View as company**) — it is suspended, so the storefront will not serve it,
   but the admin panel will.
2. When you are satisfied: move the domain from the broken company to the
   restored one ([add-domain.md](add-domain.md)), activate the restored
   company, and suspend the old one.
3. Keep the old one for a week before deleting anything.

### Clean up a drill

```bash
npm run restore:company -- --file backups/company-352-….json --name "…" --drop
rm -rf media/7734
```

---

## Drill results

**Performed:** 2026-07-28, on the live Oracle 19c EE instance.

| Step | Result |
|---|---|
| Export company 352 (Demo Store A) | 15 non-empty tables: langs 2, settings 2, media 17, cats 7, products 9, variants 9, prod_imgs 9, prod_cats 8, pages 4, sections 5, banners 2, menus 2, menu_items 6, trans 17, order_seq 1 |
| Restore into a new company | Succeeded, suspended, new ids throughout |
| Copy media files | 104 files |
| Verify | **PASS** — 42 rows compared by content, no orphans |
| Drop the restored copy | Clean; original untouched |

Three real defects were found *by running it*, none of which a code review
would have caught:

1. **Dates.** JSON has no date type, so every `TIMESTAMP WITH TIME ZONE` came
   back as a string, and Oracle tried to parse it with the session's NLS
   format — `ORA-01843: not a valid month`.
2. **`media.storage_key` is globally unique.** The restored rows cannot reuse
   the original keys; they are rewritten into the new company's namespace,
   which is also what makes the file copy a plain directory copy.
3. **A wrong column name in the foreign-key map** (`media_mobile_id`, not
   `mobile_media_id`) left banner images pointing at the *source* company's
   media, and Oracle refused the insert. Silent data corruption if the
   constraint had not been there — which is a good argument for the composite
   `(company_id, id)` foreign keys this schema uses everywhere.

**Re-run this drill quarterly, and after any migration that adds a table.** A
new company-owned table that is missing from `COMPANY_TABLES` in
`scripts/backup-company.js` will be silently absent from every export.

---

## Instance-level backup (DBA)

### Nightly RMAN

```
RUN {
  CONFIGURE CONTROLFILE AUTOBACKUP ON;
  CONFIGURE RETENTION POLICY TO RECOVERY WINDOW OF 14 DAYS;
  BACKUP INCREMENTAL LEVEL 0 DATABASE PLUS ARCHIVELOG
    FORMAT '/backup/oracle/full_%d_%T_%s.bkp'
    TAG 'STOREFORGE_NIGHTLY';
  DELETE NOPROMPT OBSOLETE;
}
```

Archived redo logs must be shipped too, or the recovery window is "since the
last full backup" rather than "to the minute".

### Schema-level Data Pump

Faster to restore than RMAN when the problem is the *schema* rather than the
instance:

```bash
expdp system/**** schemas=ECOMM directory=DMP_DIR \
  dumpfile=ecomm_%U.dmp logfile=ecomm_exp.log compression=ALL
```

`DMP_DIR` already exists on this instance (`C:\oracle_dmp`).

### Media files

The database knows nothing about the image bytes. `media/{company_id}/…` must
be backed up separately:

```bash
rsync -az --delete /srv/storeforge/media/ backup@offsite:/backup/storeforge-media/
```

### Verify the DBA backups too

An RMAN backup that has never been restored is in exactly the same position as
the per-company export was before the drill above.

```
RESTORE DATABASE VALIDATE;
RESTORE ARCHIVELOG ALL VALIDATE;
```

`VALIDATE` reads every block and reports corruption without writing anything.
It is not the same as a real restore onto a spare host — that is the drill to
schedule with the DBA, and it has **not** been performed. Recorded honestly in
[BACKLOG.md](../BACKLOG.md) rather than ticked off.

---

## What is not backed up

| Thing | Why it does not matter |
|---|---|
| Redis | Every key is a cache, a session, or a rate-limit counter. Losing it logs everyone out and makes the next page load slower. Nothing is only in Redis. |
| `logs` (per-company export) | Platform-owned; covered by the instance backup. |
| `node_modules`, builds | Reproduced by `npm ci` and `npm run build`. |
