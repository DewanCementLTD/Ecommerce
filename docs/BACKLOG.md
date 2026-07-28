# Backlog

Items explicitly out of the current phase's scope, parked here instead of built.

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

## Client admin SPA — Task 7 of Phase 1 (not built)

Not a backlog item by choice: it is unfinished phase work, recorded here so it is not
lost. `admin/` is still the Task 1 placeholder. Every endpoint it needs exists and is
tested — see `docs/PHASE-1-REPORT.md` for the endpoint-to-screen mapping and the
5–6 day estimate. Two Phase 1 exit criteria cannot be met until it is built.

---

## Storefront performance headroom (Phase 1 → Phase 3)

Lighthouse mobile performance sits on the 85 line (82–89 depending on the run). The
work that would settle it is already scheduled as Phase 3 Task 2 — Redis caching per
`00-SYSTEM-DESIGN.md §7`, every key prefixed `co:{id}:`. Deliberately not pulled
forward. The storefront currently relies on Next's own `revalidate` only.

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
