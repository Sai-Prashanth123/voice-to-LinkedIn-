---
description: Go through the drafts waiting on you
---

Call `list_calendar` with status `draft`. Each post comes back with a `gate` block and then its text.

For each one, in turn:

1. **Say what the checks caught, before you read the post.** `gate.flagged` names them and
   `gate.why` gives each one's reason in the check's own words. Read those reasons out — do not
   summarise them into "it needs work".

   This step exists because it was missing. On 26 October Josh wrote that he gives the same
   editorial notes every time, and four of the six were notes the gate had already made on the post
   he was holding. He was not ignoring them: the verdicts live on `drafts` and this list reads
   `posts`, so until now there was nothing here to show him. He read the body, because the body was
   all there was, and worked the rest out by eye every week.

   In one-step mode a failing draft still reaches his calendar — that is what he asked for on
   13 October, and `gate.advisory` says so on each post. It means the verdict is information, not a
   blocked door. Give him the information.

2. **Read it to him in full.** Not a summary, not the first line — the post as it would appear. He
   cannot approve what he has not heard, and approving on your description of it is the one mistake
   that cannot be undone from here.
3. Say which idea it came from and, if it is a rewrite, what changed.
4. Ask what he wants to do with it.

If he gives a note the `gate` block already made, say so plainly — "the gate caught that one too,
here is how it put it" — and then ask whether the rule behind it needs changing rather than the
post. A note he has given more than twice is a library change waiting to be proposed, not a draft
to fix again.

Then whichever he says:

| He says | Call |
|---|---|
| "put it out Tuesday", "send it tomorrow" | `mark_ready` with the date |
| "hold that" | `hold_post` — and if he says why, pass it: a rejection in his own words is the most useful thing the system ever gets |
| "the opening is flat", "that is not what happened" | `push_back_on_draft` with **his** words, not your summary of them |
| "change this line to…" | `edit_post` with the text as he wants it |

`mark_ready` is the only thing in this system that authorises a post to go out. It publishes itself
on the date given and nothing asks him again. So read it first, and never call it on a draft he has
not explicitly approved.

If a draft has not been judged yet, the nine checks run first — `mark_ready` will refuse it, and
that refusal is correct.
