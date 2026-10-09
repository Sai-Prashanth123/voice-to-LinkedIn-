---
description: Go through the drafts waiting on you
---

Call `list_calendar` with status `draft`. It returns the posts with their text.

For each one, in turn:

1. **Read it to him in full.** Not a summary, not the first line — the post as it would appear. He
   cannot approve what he has not heard, and approving on your description of it is the one mistake
   that cannot be undone from here.
2. Say which idea it came from and, if it is a rewrite, what changed.
3. Ask what he wants to do with it.

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

If a draft has not been judged yet, the eight checks run first — `mark_ready` will refuse it, and
that refusal is correct.
