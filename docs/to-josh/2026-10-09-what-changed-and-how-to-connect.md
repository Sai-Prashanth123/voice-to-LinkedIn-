# What changed, and how to connect

Josh — you tested the system end to end and sent us a list. Every factual claim in it was right, and
we checked each one against the database before touching anything. This is what has changed since,
what you asked for that is now there, and the two things that are now worse.

---

## Your list, point by point

| What you said | What was true | Where it stands |
|---|---|---|
| 30 drafts, 10 ours, 20 from three of my ideas | Exactly that | — |
| None cleared the gate | `gate_passed` was true for none of them | **Both your stuck ideas are through and waiting for you** |
| Nothing published | The only two published rows were August test fixtures | Still nothing. That is yours to start |
| A failed draft cannot be redrafted | The drafting tool accepted three states; a gate failure sets a fourth. It told you to rewrite, then refused | **Fixed** |
| The gate fails drafts for things that aren't in them | Your cold-email post was rejected for "17 campuses" and a named initiative. Neither phrase is in the post — both are in your raw notes | **Fixed, and your draft is now a permanent test** |
| I can't find them in the app, it's super buggy | — | **The app is gone.** See below |
| Sentinels scraped once on 7 September, nothing since | Measured 8 September and never again | **Refreshed, and now repeatable** |
| Matt Barker returned nothing, and I can't get to the posts | True, and by design — we stored no reference text at all | **Fixed. You can read them** |

---

## Three things you asked for

### Matt Barker, readable

You can now read the posts, not just measurements:

- *"show me Matt Barker's last five posts"*
- *"how does he open?"* — a structural read: length, opening, where the turn lands, how he closes
- *"find me posts about distillation"*

138 posts across all eight writers are stored. Incidentally, `adam-treboutat` had returned nothing on
every run and you were asked twice to confirm the handle — it was right all along. The scrape window
was wrong. It returned seven posts.

**Why it returned nothing before.** We had deliberately stored none of their words, so that a draft
could not quote what the system does not hold. That was a defensible call and it cost you the thing
you actually wanted. The posts are stored now, and the protection moved rather than disappearing: the
drafting and judging steps are still given *measurements* of their writing and never their prose. That
split is what stops your posts reading like theirs, which is the thing you are paying for. There is a
test that fails if anything ever reaches across it.

### His frameworks, in your voice

In force as of today. Four things the system now takes from him:

1. Open on someone else's situation with their number in it — which also anonymises, and suits
   material you cannot name.
2. Anchor the point to something mundane and specific: a weekday, an errand.
3. One mechanism per post. A list only when the point *is* a process.
4. Name the audience once, in the middle, where a reader who has stayed is deciding whether this is
   for them.

**And two of his moves are deliberately ruled out.** You should know which, because they are the two
most recognisable things he does:

- **His turn that renames your problem** — "you don't have an ideas problem, you have a distillation
  problem". That is the exact construction your own banned-phrases list forbids, and it is the most
  recognisable AI cadence on LinkedIn. He gets away with it because the substituted problem is one he
  can evidence. We have kept your rule. Say the word and it comes off the list, but it would then be
  allowed everywhere.
- **His close.** He asks in nearly every post; across all eight writers a direct ask appears in 4 of
  51. Your rule rations it to one in five, and your buyer lurks rather than engages.

### One place, not four

Telegram, the web app and the Slack reader are gone — about 6,200 lines. Everything is in Claude now.
`README.md` in the repo is the setup, and it covers Claude Code, the desktop app, and Codex or Cursor
if you prefer those.

**A note on the app.** It had stopped being able to write anything some time ago, so deleting it cost
no capability. It had also lost its login at some point and was serving your entire idea bank and
every draft to anyone with the URL. That is fixed by its removal rather than in spite of it.

---

## Two things that are now worse, stated plainly

**1. Nothing can reach you any more.** There is no bot, so nothing will tap you on the shoulder. A
post that fails to publish, an idea that parks itself, the queue running low — all of it waits until
you next open a session, and then `/waiting` reads it out. On a Saturday that could be two days.

If that is the wrong trade, an email alert on your own account is about an hour's work. Say so.

**2. Capture from your phone has gone with Telegram.** You could talk into it from anywhere and the
audio and transcript were both kept. You now dictate into a session instead, which means a laptop.

This is a change to what we agreed — clause 4.1 of the build spec requires capture from a phone, by
voice, with the audio stored. **We are not pretending otherwise and we are not asking you to overlook
it.** If phone capture matters, the cleanest replacement is a small amount of work on an inbound email
address: you dictate into your phone's notes or mail app and send it, and it lands in the bank the
same way. Tell us and we will cost it.

Everything you have already recorded is untouched: every voice note, every transcript, every answer.

---

## Getting connected

1. Clone the repo we have sent you.
2. `cd` into it, then `cd mcp-server && npm install && cd ..`
3. `cp mcp-server/.env.example mcp-server/.env` and paste the two values we are sending separately.
4. `node mcp-server/index.mjs --check` — you want `ok`.
5. `claude`, then type `hello`.

`README.md` has all of that with the alternatives, and section 10 covers the three failures that look
identical and are not.

---

## What is waiting for you right now

- **Two drafts**, both through the eight checks: the cold email addressed to Ben, and the clinician
  headcount one. Say `/review` and it will read them to you.
- **One library change to approve** — the refreshed measurements across 138 posts.
- **The voice recording.** This is the honest bottleneck. The voice guide is derived from six calls
  where your job was asking questions, so it shows how you ask and not how you argue — and the hook
  and the close are exactly what a conversation cannot show. Fifteen minutes of you making a case for
  something, unprompted, would improve the writing more than anything else available. Paste a
  transcript into any session and say *"add this to the voice interview"*.

Your test was three drafts in a row you would post with only light edits. Two are in front of you.
When you mark them up, the edits themselves are recorded now — a word you cut once is a mood, a word
you cut three times becomes a rule — so reading your changes is how it gets closer.
