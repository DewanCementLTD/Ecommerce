# How to run this with Claude Code

## Setup

```bash
mkdir storeforge && cd storeforge
git init
mkdir docs
```

Copy the files in:

```
storeforge/
├─ CLAUDE.md                        ← root, Claude Code reads this automatically every session
└─ docs/
   ├─ 00-SYSTEM-DESIGN.md
   ├─ 01-PHASE-0-foundation.md
   ├─ 02-PHASE-1-catalog.md
   ├─ 03-PHASE-2-orders.md
   └─ 04-PHASE-3-launch.md
```

`CLAUDE.md` must be at the repo root — that's what makes the rules persistent across every session without re-pasting them.

---

## Kickoff prompt (paste this first)

> Read `CLAUDE.md` and `docs/00-SYSTEM-DESIGN.md` in full, then read `docs/01-PHASE-0-foundation.md`.
>
> Before writing any code: enter plan mode and give me a task-by-task plan for Phase 0 with your estimates. Tell me anything in the brief you think is wrong, risky, or ambiguous — I would rather argue now than refactor later.
>
> Confirm you have understood the three hard constraints: plain JavaScript with no TypeScript, nothing hardcoded per client, and every company-owned query scoped by `company_id`.
>
> Do not start coding until I approve the plan.

---

## Working rhythm

**One phase per session series.** Don't let it run ahead — the phase files exist to stop scope creep.

**Per task:** approve plan → let it build → review the diff → `npm test && npm run lint && npm run test:isolation` → commit. Don't batch five tasks before reviewing.

**Useful mid-flight prompts:**

- `Show me the plan before you code.` — use often.
- `Run the isolation tests and show me the output.` — after any new table or endpoint.
- `Review your own work against docs/01-PHASE-0-foundation.md Task 4. What's missing or half-done?`
- `Use a subagent to review this module for security issues and cross-tenant leaks.`
- `That's outside Phase 1 scope. Note it in docs/BACKLOG.md and carry on.`
- `Take a screenshot at 375px and critique your own design.` — the design bar in Phase 1 is real; make it self-critique.

**At the end of each phase:** have it write the phase report, then start the next phase in a fresh session so context stays clean.

---

## Things to watch for

| Watch for | Why it matters |
|---|---|
| TypeScript creeping in | It will default to `.ts` unless reminded. Correct it immediately. |
| Raw SQL outside `*.repo.js` | Breaks the isolation contract. |
| A new table without a VPD policy | A silent data-leak hole. Check every migration. |
| Payment or shipping "stubs" | Explicitly out of scope. Delete them. |
| Cache keys missing the `co:{id}:` prefix | Cross-tenant leak through Redis. |
| Desktop-first CSS | Most of the traffic is mobile. Check at 375px. |
| Skipped tests to "move faster" | The isolation suite is the release gate, not optional. |

---

## The two things that must never break

1. **No company can ever see another company's data.** Three layers protect this: Oracle VPD, the repository layer, and the isolation test suite. If a test in `tests/isolation/` fails, nothing ships until it's green.
2. **Adding a client requires no code change.** If Claude Code ever proposes "add a config file for this client" or "special-case this store," that's the architecture failing. Push back and make it data-driven.

---

## Order of the files

| File | When |
|---|---|
| `CLAUDE.md` | Always loaded. Never delete. |
| `00-SYSTEM-DESIGN.md` | Read at start; referenced throughout. |
| `01-PHASE-0-foundation.md` | Weeks 1–3 |
| `02-PHASE-1-catalog.md` | Weeks 4–8 |
| `03-PHASE-2-orders.md` | Weeks 9–12 |
| `04-PHASE-3-launch.md` | Weeks 13–15 |
