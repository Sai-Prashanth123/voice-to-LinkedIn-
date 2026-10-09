# The handover walkthrough

Running order for clause 14.5 — *"a walkthrough with Josh, recorded, covering the runbook end to
end."*

About forty minutes. Record it; the recording is the deliverable, not this document.

**Rewritten on 9 October 2026.** The previous version had him send a voice note to a Telegram bot,
open the web app's library page, and run `/review` on his phone. None of those exist. One surface
now: Claude.

## The one rule for whoever runs it

**Josh does everything. We watch.** A walkthrough where he captures the thought, approves the post
and adds the rule himself is one he can repeat next week. A demonstration is one he has to be shown
again.

Every step below is written as something for him to do. If he gets stuck, that is the most valuable
thing the recording captures — note it and fix the system rather than coaching him past it.

---

## Before the call

- [ ] He has the repo URL, and has cloned it
- [ ] He has the two values, sent separately from the repo link
- [ ] `node mcp-server/index.mjs --check` returns `ok` **on his machine**
- [ ] There is at least one draft waiting, so `/review` has something real in it
- [ ] There is at least one idea mid-interview, so `/interview` does too
- [ ] `scripts/smoke.mjs` is clean, so a red light in the call is a real finding

If the first three are not true, stop and fix them before the call. Twenty minutes of setup debugging
is not a walkthrough, and it is the part he should never have to see twice.

---

## 1. He opens it (5 min)

**He runs `claude` in the project folder and types `hello`.**

What should happen: it greets him, says what is waiting, and names the one thing worth doing first.
No tool names, no lists of capabilities.

Then **he types `/waiting`**. If anything has happened while nobody was looking — a parked idea, a low
queue, a failed publish — it reads it out and clears it.

> Say out loud, here, that this is now the only way anything reaches him. Nothing will message him.
> If that is wrong for how he works, this is the moment to hear it.

## 2. He captures something real (8 min)

**He says something that actually happened this week.** Half a sentence. Not a test phrase — the
system is being judged on his material, so use his material.

Watch for:

- It names the idea from his own words, and says the name in passing rather than asking him for one
- It asks **one** question, not five
- His answer goes in untouched. Ask him to check that what came back is what he said

**He answers two or three questions, then stops** — `/interview` or just trailing off. The point to
make: he can leave it half-answered and come back, and nothing is lost or nagging.

## 3. He writes one (10 min)

**He types `/write`.**

While it works, show him what it is reading: `get_drafting_brief` is his own material plus the
reference library, and nothing else. No web access, no other ideas, no archive.

When the draft lands, **he reads it before anything else happens.** The question to ask him, exactly:

> Could anyone else have written this?

If yes, that is the most useful thing in the recording. Do not defend the draft — ask what is missing
and whether the interview should have asked for it.

## 4. The checks run (5 min)

**He asks for the gate.** Eight checks, each judged on its own rubric.

Show him a rejection if there is one to show — including one of the three that were wrong on
5 October, now fixed and kept as a test. The point: a rejection tells him which sentence and why, and
a rewrite carries the reasons forward.

## 5. He decides (7 min)

**He goes through `/review`.** On one draft, each of these at least once:

- `put it out <a day>` — and see that it comes back with the date and nothing else to do
- `hold that one`, with a reason in his words — and see the reason recorded
- an edit to one line — and see the change measured

Say plainly: **marking it ready is the only thing that authorises publishing.** The database refuses
every other route, four ways. Nothing in the system can decide to post for him.

## 6. He changes a rule (5 min)

**He says a rule out loud** — "never use the word journey", or whatever he actually dislikes.

It goes into the library immediately, and the **next** draft is written against it. No deploy, no
waiting, no asking us. Then `get_section_history` shows it, and shows that it can be rolled back if
the posts get worse.

Then the other half: **he reads one of his reference writers.** `/sentinels`, then "show me Matt
Barker's last three posts". Say which two of Matt's moves are deliberately ruled out for him, and
why — that is the part he is most likely to disagree with, and disagreement is useful.

## 7. When it breaks (5 min)

Show him the three things, in this order:

```bash
node mcp-server/index.mjs --check
node scripts/smoke.mjs
```

and in a session, "is it working?".

Then the honest part: **nothing can tell him when something fails.** A post that does not go out
records why and waits for his next session. `/waiting` is how he finds out. If that is not good
enough, email alerts on his own account are about an hour's work.

---

## What to write down afterwards

- Every place he hesitated, and what he expected instead
- Every word he used for something we call by another name
- Anything he asked for that is not there
- Whether the draft passed his own test, in his words

The first two go into the library and the tool descriptions. The third goes on the roadmap. The fourth
is the only measure of whether any of this worked.
