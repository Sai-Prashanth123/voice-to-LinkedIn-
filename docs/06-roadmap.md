# What happens next

Six phases. Written 1 September 2026.

Each one below says, in plain words, **what we are actually doing** — then the
list of jobs inside it.

Phases 1, 2, 4, 5, 6 run in order; each needs the one before it.
**Phase 3 runs alongside all of them** and is the only phase not in our hands.

---

## Phase 1 · MCP connectors

> **In simple terms:** right now Claude Code and the content system are two
> separate things that cannot talk to each other. We are building the doorway
> between them — so Claude Code can look at your ideas and hand back a draft
> without anyone opening a website or a database.

Why first: everything in Phase 2 comes through this door. Until it exists, the
writer has nowhere to write to.

- [ ] Build the connector — the idea bank, the library, the work queue
- [ ] Reading: waiting moments, drafts, library sections, where each test stands
- [ ] Writing: create a draft, record a check result, propose a library change
- [ ] One key, limited to only what it needs, cancellable at any time
- [ ] Prove it against the live system, not a copy

**Done when:** Claude Code can list what is waiting and write a draft back, on its own.

---

## Phase 2 · Writing skills — add, then tweak

> **In simple terms:** this is the writer, and the eight checks that judge it.
> Today the system writes with a free model that is not good enough — it invents
> things, and the checks correctly throw the drafts away. We are moving that work
> onto Claude Code, which you already pay for, so the writing is finally good
> enough to survive its own checks.

Why it matters: **four of the twelve acceptance tests and the finish line are
waiting on nothing else.**

- [ ] The writing skill — reads your library and one idea, and shows where every fact came from
- [ ] The checking skill — the eight checks, each able to reject a draft on its own
- [ ] Route both through Phase 1 instead of buying model credits
- [ ] First run all the way through: one idea → one draft → eight checks
- [ ] **Then tweak** — read what comes out and adjust, until drafts pass for the right reasons

**The rule for this phase:** if a draft fails, we fix the writer — never the checks.
The checks are currently catching real invention. Loosening them to make the
numbers look better would throw away the only thing protecting your name.

---

## Phase 3 · Josh's additions — runs alongside everything

> **In simple terms:** the parts only you can give us. The system can be perfect
> and still write like nobody in particular until it knows how you sound and what
> you care about.

**Start this now.** It does not wait for Phase 1 or 2.

- [ ] **The voice guide** — about 400 words of you simply talking. Highest value thing on this page.
- [ ] The other six library sections: pillars, audience, check rules, visual style, reference posts
- [ ] Answer the five questions already sitting unanswered
- [ ] Connect LinkedIn — this starts two four-week clocks
- [ ] 19 more voice notes, 2 more sessions, and pick which call recorder you use
- [ ] Run `node cc-agent/install.mjs` once — starts another two-week clock

---

## Phase 4 · Creative testing

> **In simple terms:** we use it hard ourselves before you ever see it. Ten or
> more real drafts, every rejection read one at a time, to find the things that
> only show up in real use.

- [ ] 10+ drafts all the way through the checks, rejections read individually
- [ ] Turn one of your images into your own version, for real
- [ ] Watch it choose what to write across several rounds — does it balance topics, does it spot a repeat
- [ ] Re-run the scoreboard and watch rows change from "waiting" to "passed"
- [ ] Anything that turns a row to **failed** stops this phase — that is a real fault

**Done when:** the drafts are good enough that showing them is not embarrassing.

---

## Phase 5 · First round sharing

> **In simple terms:** the first time you see the system's actual work instead of
> a report about it. Real drafts, for your verdict.

- [ ] **Change every development password first** — required before any real material goes in
- [ ] Move every account into your name, so the system is yours and not ours
- [ ] Record the walkthrough — the running order is already written
- [ ] Send the first real batch of drafts
- [ ] An updated build report showing where the twelve tests actually stand

---

## Phase 6 · Feedback round changes

> **In simple terms:** you tell us what is wrong with them, and we change it —
> mostly by editing your library rather than by rewriting code, because that is
> the part you can keep changing yourself afterwards.

- [ ] Apply your feedback to the library wherever it can be done there
- [ ] Go through the changes the system proposes itself — approve or reject each
- [ ] Re-run the scoreboard and record which tests genuinely moved
- [ ] Anything asked for beyond the original specification gets quoted, not quietly absorbed

---

## The one honest constraint

Five of the twelve tests need two to four weeks of the system simply *running* —
no amount of building shortens them. Those clocks start in **Phase 3**, not in
Phase 5. Every day Phase 3 waits is a day added to the end, however fast phases
1, 2 and 4 go.
