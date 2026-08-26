# A content system that writes from lived experience

Built for Josh Fryszer (Slingshot GTM) by Thought Pilot, against build specification v2.0 of
20 August 2026.

The job: capture the moments worth writing about while they are still fresh, interview Josh about
them until there is real material, and turn that material into LinkedIn drafts that sound like him.
Four to five posts a week, with his only involvement being one calendar pass.

**The test everything is measured against:** could anyone else have written this? If yes, it fails.

---

## Layout

```
docs/
  00-spec-understanding.md   every clause, restated in build terms
  01-recommendations.md      the clause-16 decisions and the tool list (15.1)
  02-cost-model.md           running cost, confirmed in writing (15.7, 15.8)
  03-runbook.md              how to run it, change it, and fix it (14.4)

supabase/
  migrations/                the schema. The spec's hard rules are enforced here, not in code.
  functions/
    _shared/                 claim ledger, prompts, models, library loader, diff, Telegram, LinkedIn
    telegram-webhook/        the one surface Josh touches on his phone
    worker-dispatch/         the pipeline: transcribe, interview, draft, gate, visual
    worker-select/           what gets written next, and what has already been told
    worker-triage/           calls, Claude Code and Slack — candidates only
    worker-publish/          publishes what Josh marked ready, on his date
    worker-metrics/          engagement at seven days
    worker-learn/            evidenced proposals, for Josh to approve
    worker-ops/              silence alerts, queue warnings, monthly reports
  tests/                     rebuilds the schema and asserts the rules still hold

app/                         the desk: weekly pass, calendar, idea bank, library, proposals
cc-agent/                    runs on Josh's machine; filters Claude Code logs locally
eval/                        regression harness, filter calibration, syntax check
```

## The four rules, and where they are enforced

Three of these are stated in the spec as absolutes and one is stated three times. None of them is
enforced by asking a model nicely.

| Rule | Enforced by |
|---|---|
| **The system never publishes on its own** (11.2) | Check constraints on `posts`. A row cannot reach `published` without `marked_ready_at`. |
| **No fabrication** (5.4, 9.4) | The claim ledger: the drafter must cite a verbatim source span for every claim, verified mechanically in `_shared/claims.ts` before the gate spends a token. |
| **Nothing is ever deleted** (6.3) | DELETE revoked from every role the system runs as. |
| **Candidates only from automatic inputs** (4.3.3) | Triage writes moments at `half_mined`; the selector only reads `mined`, which only the interview produces. |

Plus the one clause 12 singles out: the lived-experience test and the no-fabrication rule are **not
tunable by the learning loop**, whatever the numbers say. They live in a locked library section and a
database trigger rejects any proposal against it.

## Running the tests

```bash
bash supabase/tests/run-migrations.sh              # schema + 13 assertions on the enforced rules
node --test supabase/functions/_shared/*.test.ts   # claim ledger, edit classification
deno check supabase/functions/*/index.ts           # every edge function type-checks
cd app && npx tsc --noEmit && npx next build       # the web app
```

The regression harness (`node eval/regression.mjs --compare`) re-drafts a fixed set of real moments
against the current library and diffs the result against the previous run. Run it before and after any
library change — it is what makes tuning measurable rather than a matter of taste, and it is how
17a's finish line gets reached.

## Status

**Verified by running:** the schema and every guarantee above (13 assertions, rebuilt from scratch),
the claim ledger (16 tests), edit classification (8 tests), the Claude Code filter (calibrated
against a real corpus), the web app (type-checks and builds, 8 routes).

**Written but not yet executed:** the pipeline itself — capture, interview, drafting, the gate,
selection, publishing, metrics, learning, and both automatic inputs. All five ways in exist in code.
None has run against live keys, and a first real run should be expected to find things that static
checking cannot.

**Blocked on Josh**, in the order it blocks work:

1. The **voice guide**, built from a recording of him talking — not his archive (8a). On the critical
   path; until it exists, drafts will be fluent and generic, which is the exact failure the spec is
   written to prevent.
2. The rest of the **reference library** — pillars, frameworks, hooks, closes, audience, prompt set.
   Every section is seeded and empty.
3. The **seeding session** — 20–30 mined moments. Everything downstream is tuned against them, and
   the regression harness has nothing to measure until they exist.
4. **Which call recorder** he uses, **brand guidelines** for visuals, and the **LinkedIn Community
   Management** request for post analytics.

See `docs/01-recommendations.md` §3 for the full list and §4 for two questions that need his answer.
