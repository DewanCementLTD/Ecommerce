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
