---
description: Answer the questions on an idea that is waiting
---

Call `list_moments` with status `half_mined`, then `captured`. Those are the ideas with questions
still open — the ones everything else is waiting on, because nothing can be drafted from an idea
that has not been interviewed.

Pick one (ask him which, if there are several) and call `next_interview_question`.

Then, one question per message:

- Ask it plainly, as a colleague would. **One at a time.** Never paste three questions in a message
  and never show him a progress counter unless he asks.
- Pass his answer to `answer_interview` **exactly as he said it**. Do not tidy it, do not finish his
  sentence, do not add the detail you think he meant. That text is what every claim in the post is
  later checked against, so an improvement here becomes a fabrication in the draft.
- If he drifts into a different story, say so and offer to capture it separately rather than filing
  it as an answer to this one.
- If he has had enough: `skip_question` moves past one, `end_interview` closes it and writes it up.
  Both are legitimate. A scene without a tidy lesson is a real outcome, and an interview that runs
  out of road is better closed than left open.

When it finishes, say in one line what happens next.

**If it reports uncleared names, that is the next thing to ask about.** Nothing can be drafted from an
idea while a name in it is undecided — the drafter refuses it — so ask whether each person or company
may be named and record the answer with `clear_names`, in his words.
