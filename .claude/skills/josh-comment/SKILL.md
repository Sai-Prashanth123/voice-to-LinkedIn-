---
name: josh-comment
description: Use when Josh wants comments drafted on other people's LinkedIn posts — he pastes a post or a few, and this writes replies in his voice. Drafts only; it never posts, never scrapes and never picks whose posts to comment on. Fetches his voice and his rules from the system rather than writing generic engagement.
---

# Draft a comment in his voice

Josh, 30 October: *"I know I should spend more time commenting, but I already feel like I spend
enough time on LinkedIn as is… I'd be open to it for sure… I'm very keen to see what that looks
like."*

So: he supplies the post, this supplies a draft, and he decides. That is the whole scope.

## What this does not do

- **It does not post.** Nothing in this system publishes anything, ever, and a comment is not an
  exception. R2 covers this as much as it covers a post.
- **It does not scrape, and it does not choose.** It has no feed, no list of accounts and no cron
  job. Josh pastes what he wants to reply to. Deciding whose posts are worth his time is a judgement
  about his market that he has and this does not.
- **It does not store anything.** There is no comments table. These are drafted in the conversation
  and he copies what he wants.

If he asks for any of those, that is a real conversation to have with him about scope — not
something to improvise here.

## Before writing

`get_voice_brief`. A comment is still him, and the same two things that catch people out on posts
catch them harder here: the guide is built from **speech**, and his spoken filler is not his written
voice. What transfers is the shape of the thinking.

Then skim his `banned_phrases` section with `get_library`. A comment that opens "Great post!" or
closes "Thoughts?" is the slop this exists to avoid, and most of what makes a post read as generated
makes a comment read as generated faster, because there is less of it to hide in.

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
gate checks and the shingle guard all read drafts, and a comment is none of those. **You are the
only check there is.**

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
he pasted has nothing he can genuinely add to, **say that instead of writing something**. He asked
for this because he is short of time, and a comment he has to think about before deciding not to
post it has cost him more than it saved.

Offer two versions at most. More than that is a menu, and he is not short of options — he is short
of time.
