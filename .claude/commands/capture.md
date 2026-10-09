---
description: Save something that just happened, and start asking about it
---

Take what Josh just said and call `capture_thought` with **his words**, not a tidied version of them.

Do not ask what to call it. The reply names it from what he said and carries the first question, so:

1. Say the name in passing — `Filed that as "CFO first line"` — so he can correct it if it is wrong.
   If he does, call `name_idea` with what he says instead.
2. Ask the question it returned. One question, in plain conversation.
3. Carry on with `answer_interview` and `next_interview_question` until he has had enough or it
   closes itself.

Half a sentence is enough to capture. He can talk for two minutes and stop — the questions can wait
for another time, and an idea sitting half-answered is normal rather than a problem.

What not to do: do not "improve" what he said on the way in. The captured text is the source every
claim in the eventual post is checked against, so a helpful addition here becomes a fabrication three
steps later, in a post with his name on it.
