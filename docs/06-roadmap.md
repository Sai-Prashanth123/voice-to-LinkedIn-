# What happens next

Six phases. Written 1 September 2026.

Phases 1, 2, 4, 5, 6 run in order — each needs the one before it.
**Phase 3 runs alongside all of them** and is the only one not in our hands.

Tick a box when it is done and verified, not when the code is written.

---

## Phase 1 · MCP connectors

*Give Claude Code a door into the system. Nothing else can start until it can reach in.*

- [ ] MCP server exposing the idea bank, the reference library and the job queue
- [ ] Read tools: moments, drafts, library sections, where each test stands
- [ ] Write tools: create a draft, record a gate verdict, propose a library change
- [ ] Auth — one key, scoped, revocable, not the service-role key
- [ ] Register it in Claude Code and prove a real read against live data

**Done when:** Claude Code can list waiting moments and write a draft back without
the browser or the database being opened.

---

## Phase 2 · Writing skills — add, then tweak

*The actual writer and the actual gate. This is what four acceptance tests are waiting on.*

- [ ] Drafting skill — reads the library and one bank entry, emits claims with sources
- [ ] Gate skill — the eight checks, each able to reject alone
- [ ] Wire both to run through Phase 1 rather than through paid API credits
- [ ] First real run end to end: one moment → one draft → eight checks
- [ ] **Tweak** against what comes out, until drafts clear the gate for the right reasons

**Careful here:** the gate is not broken and must not be loosened to make this pass.
It currently rejects genuine invention. If drafts fail, fix the writer.

**Unblocks:** tests 6, 7, 8, 10 and the finish line.

---

## Phase 3 · Josh's additions — runs in parallel

*Not ours. Everything below is blocked on him and nothing we build shortens it.*

- [ ] Voice guide — ~400 words of him talking. **First, and highest value.**
- [ ] The other six library sections: pillars, audience, gate rules, visual brand, reference posts
- [ ] Answer the five moments already asked and left
- [ ] Connect LinkedIn — starts two four-week clocks
- [ ] 19 more voice notes, 2 more sessions, pick a call recorder
- [ ] Run `node cc-agent/install.mjs` — starts a two-week clock

---

## Phase 4 · Creative testing

*Drive it hard before anyone else sees it.*

- [ ] 10+ drafts through the full gate, rejections read one by one
- [ ] Image rebuild run for real (test 10)
- [ ] Selection watched across several cycles — does it balance pillars, does it catch a retelling
- [ ] Re-run `node eval/acceptance.mjs` and see rows move off `----`
- [ ] Anything that moves a row to `FAIL` stops this phase

**Done when:** drafts are good enough that showing them is not embarrassing.

---

## Phase 5 · First round sharing

*The first time Josh sees output rather than a report.*

- [ ] **Rotate every development key first** — required before real material enters
- [ ] Move accounts into Josh's name (clause 14.1)
- [ ] Record the walkthrough using `docs/05-walkthrough.md` (clause 14.5)
- [ ] Send the first real batch of drafts for his verdict
- [ ] Updated build report with the scoreboard as it stands

---

## Phase 6 · Feedback round changes

*What he says back, applied.*

- [ ] Apply his edits to the library, not to the code, wherever possible
- [ ] Read the learning loop's proposals and approve or reject each
- [ ] Re-run acceptance and record which tests actually moved
- [ ] Anything he asks for that is outside the specification gets quoted, not absorbed

---

## The one honest constraint

Five acceptance tests need two to four weeks of the system simply running.
Those clocks start in **Phase 3**, not in Phase 5. Every day Phase 3 waits is a
day added to the end, regardless of how fast phases 1, 2 and 4 go.
