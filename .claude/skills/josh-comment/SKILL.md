---
name: josh-comment
description: Use when Josh wants comments drafted on other people's LinkedIn posts — he pastes a post, or the twice-daily creator poll found one. Drafts only; it never posts, and it never picks whose posts to comment on. Fetches the standard from the system with get_comment_brief rather than writing generic engagement.
---

# Draft a comment in his voice

Josh, 30 October: *"I know I should spend more time commenting, but I already feel like I spend
enough time on LinkedIn as is… I'd be open to it for sure… I'm very keen to see what that looks
like."*

So: the post arrives, this supplies a draft, and he decides. That is the whole scope.

## Two ways a post gets here

- **He pastes one.** The original path, and still the main one. Nothing had to know who he reads.
- **The creator poll found one.** Since 3 November he can name creators with `watch_creator`, and
  `worker-engage` checks them at 07:00 and 15:00 on weekdays, drafting options against anything new.
  `list_comment_options` is what is waiting; `list_creators` is whose posts are being read.

Both end in the same place and are judged by the same standard, which is why that standard lives in
the system rather than in this file — see **Before writing**.

## What this does not do

- **It does not post.** Nothing in this system publishes anything, ever, and a comment is not an
  exception. R2 covers this as much as it covers a post. He pastes the one he picks into LinkedIn
  himself, and there is no code path that could do it for him.
- **It does not choose WHO.** The poll reads `creators`, and the only thing that writes to that
  table is Josh naming someone. Deciding whose posts are worth his time is a judgement about his
  market that he has and this does not — so never add a creator because they look relevant, because
  they came up in conversation, or because they are one of his eight reference writers.
- **It does not decide anything.** A drafted option sits at `offered` until he says. Recording what
  he did with it is `record_comment_used`, and it is the only signal this feature has.

Until 3 November this section also said there was no list of accounts, no cron job and no comments
table. He asked for all three on 30 October; they exist now. The scope that did NOT move is the
first two bullets, which is the half that matters.

## Before writing

**`get_comment_brief`.** It assembles the standard from his live library and it is the same brief
`worker-engage` is given — which is the point. If this file held the rules and the worker held its
own, there would be two standards and nothing to say which one a given comment followed.

It carries `core_rules`, `audience`, `voice_guide`, `banned_phrases` and `gate_rules`, and it names
what it deliberately leaves out and why. Two things worth knowing about what it hands you:

- The voice guide is built from **speech**, and his spoken filler is not his written voice. What
  transfers is the shape of the thinking.
- A comment that opens "Great post!" or closes "Thoughts?" is the slop this exists to avoid, and
  most of what makes a post read as generated makes a comment read as generated faster, because
  there is less of it to hide in.

The rest of this file is why the brief says what it says. Read the brief; it wins where they differ.

## The one test, in this medium

> **Could anyone else have left this comment? If yes, it fails.**

A comment that agrees, summarises the post back, or adds a general observation is worth nothing to
him. It costs him reputation rather than building it, because his market reads these.

What is worth leaving:

- **A number he has and the poster does not.** He measures real things across real companies. "We
  saw 3.4x that when we pulled it from the vendor's own booking pages" is a comment nobody else can
  leave.
- **A disagreement with a reason.** Specific, warm, and about the claim rather than the person.
- **The case the post did not cover.** Where the thing is true and where it stops being true.
- **A question only he would think to ask**, because he has run the thing being described.

## The rules that carry over unchanged

**Never invent anything.** A number in a comment is a claim like any other, and there is no gate
between this and LinkedIn — he pastes it straight in. If you are not certain a figure of his is
real, write the comment without it. Nothing checks these: `create_draft`'s claim ledger, the nine
gate checks and the shingle guard all read drafts, and a comment is none of those. **If you are
writing in a session, you are the only check there is.**

When the poll wrote it there was no writer, so `worker-engage` runs three deterministic checks and
records what they caught in `flags` on the row — a name nobody cleared, a seven-word run lifted from
the post it replies to, and a length outside the band. They are a **floor, not a gate**: nothing is
blocked, and an empty `flags` is not a safety certificate. None of them can catch an invented
number, and none of them can catch the composite that actually identifies a company — a figure plus
a niche plus a date. So when you read him an option from the poll, read the numbers in it as
sceptically as you would read your own.

**Never name a client.** And a figure plus a niche plus a date identifies a company to anyone in his
market. A comment is more exposed than a post here, not less: it sits under someone else's post,
often in the same niche being discussed.

**Take the shape, never the words** still applies to the eight reference writers. It applies to the
person he is replying to as well — do not mirror their phrasing back at them.

## Length

Short. Two to five sentences is the band that gets read; a comment the length of a post reads as an
attempt to hijack the thread, which is the opposite of what he wants from it.

No hook rules here. A comment is a reply, not a post — it does not open a loop, it answers something.

## How to hand them over

Give him the comment and one line on why that one is his to leave rather than anyone's. If the post
has nothing he can genuinely add to, **say that instead of writing something**. He asked for this
because he is short of time, and a comment he has to think about before deciding not to post it has
cost him more than it saved.

Offer two versions at most. More than that is a menu, and he is not short of options — he is short
of time.

When you are reading out what the poll drafted, the same rule applies to the *set*: it files up to
three per post, so pick the two best and say you have. A list of nine is a menu however it arrived.

Then **`record_comment_used`**, for the one he leaves and for the ones he passes over. Until it is
called there is no way to tell a comment he used from one he ignored — which is exactly how
`record_posted_by_hand` went uncalled and left the retelling index empty while he posted every week.
