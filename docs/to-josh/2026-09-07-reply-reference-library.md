# Reply to Josh — his reference library inputs v1.0

Draft, 7 September 2026. Not sent.

---

Josh,

All of it landed and all of it is in. Thirteen of the fourteen library sections were placeholders or
our own starter text this morning; every one of them now holds your material. Here is what changed,
what I added, where I disagreed, and the six things I need back from you.

## Your two questions

**Do we already screen for machine-generated writing?**

Yes. It is check 8 of 8 at the gate, judged against a banned-phrases section covering the AI
cadences, the structural tells and the habits. Any single check failing fails the draft, so it is not
a score that a good hook can offset.

**How are the two feedback signals weighted?**

This one deserves a straight answer rather than a reassuring one, because your instinct is right.

There is no numeric weight. The learning loop is *told*, in the prompt: weigh the edit class and your
verdict above engagement numbers, because a post you published almost untouched worked whatever its
impressions did, and one you rewrote failed however well it performed.

What protects it structurally is that the finish line, 17a, is computed from how much you edited and
not from engagement. Whether a post started a conversation is also recorded per post. But the
ranking itself is an instruction to a model, not arithmetic. A model told to prefer one signal can
still drift toward the one that arrives every week. You should know that is where it stands rather
than assume it is solved.

## Where I added meat, since you asked

You said to tell you. Everything I added is marked "Thought Pilot:" in the section itself, so you can
delete it without hunting for it.

**Hook rules** gained your coaching brief 4 in full: a curiosity gap works by building investment
first and then cutting at the reveal, and the three sources of investment are specificity, a real
emotion and clear stakes. Plus the three ways a gap fails, so a critique can name which one rather
than saying the hook is weak. This section is one the gate reads, so it changes judgements and not
only drafting.

**Gate rules** gained a note on which of your rules are mechanical and which are judgements. Your
no-client-naming rule is already two separate mechanisms on purpose: a literal string search that
runs before any model does, and a model reading for whether the figure, the niche and the timeline
identify someone anyway. You were describing the second. The first cannot have an off day.

**The prompt set** needed a change I want to flag rather than bury. Five of your thirty prompts are
written as instructions rather than as questions, and our parser only ingests a line that contains a
question mark. As sent, thirty went in and twenty-five would have come out, with no error anywhere.
I added a closing question to those five and marked each one in the text. The parser is what is at
fault, not your writing, and fixing it is on my list.

## Where the data disagreed with something, or confirmed it

I scraped and measured the eight accounts you sent: fifty-nine posts across seven of them. Their
words are not stored anywhere in your system and never will be, per 8.3. Only the measurements are.

**Three of your rules turn out to be what those writers already do.**

- Four of fifty-nine posts open with a question. Your never-open-with-a-question rule is what 93 per
  cent of them already practise.
- Two of fifty-nine ask for engagement.
- Five of fifty-nine carry a direct ask, about one in twelve. Your ration of one in five is more
  permissive than what they actually do.

**There is no house length.** Median post length across the eight runs from 53 words to 408. An
eightfold spread, and all of it works. Your "no word count, the moment decides the length" is now
evidenced rather than asserted, and the drafter is told never to aim at a target length.

**They split into two modes.** Some open in six to eight words and put almost nothing above the fold,
carrying everything below it in lists. Others spend sixty to seventy words before the fold and rarely
use a list at all. Every rule you sent points at the second mode, so four of the accounts are the
useful structural reference and three are mainly a contrast.

**One caution.** Matt Barker is not a peer reference in this set. He is the origin of your rules. His
3 September post states the lived-experience test, "lessons not advice" and the frame-then-reveal
structure in almost the words you sent me. That makes his cadence the one most likely to leak into a
draft, precisely because the system is already aligned to his thinking. It is flagged in the library
so the drafter is warned.

## Where I disagreed with you

**Leverage.** Our banned-phrases list bans it as an AI tell. You use it naturally three times in the
recordings. I have left the ban in place rather than quietly carving out an exception, on the
reasoning that an over-strict gate fails visibly and is easy to correct, while a missed AI tell is
invisible. It is your word. Say so and it comes out.

**Your checklists are not all enforced, and I would rather say so than imply coverage.** Your master
test is the gate's first check. Of the six retention criteria, the hook and the audience question are
covered, but "thought leadership or just content" and "lesson or advice" are not. The formatting
checklist and the four-level scale are not gate checks at all. Neither is the depth grading on a
pass, although the same three depths already exist inside the interview. That is four concrete
additions available. Tell me if you want them and I will build them.

## The voice guide

Built from the six calls, and it is a reading rather than a fact, so cut anything you do not
recognise. The parts you delete are as useful to me as the parts you keep.

It separates how you think from how you talk, deliberately. You say "kind of like" ten times across
six calls, and none of that belongs in a post; a guide that recorded it faithfully would teach the
gate to demand filler. What it keeps is the shape underneath. That you narrow a word in public
instead of arriving with the right one. That you define by saying what you are not. And that you
hedge hardest immediately before the most useful sentence in the call, which is the pattern a drafter
would be most likely to tidy away, and it should not.

Its weakness is stated in the section itself: all six recordings are conversations, five of them ones
where your job was to ask. There is very little of you making an argument unprompted, which is
exactly the hook and the close. One fifteen-minute recording of you making a case for something would
improve that section more than another six calls of discovery.

## LinkedIn, which is the longest pole

Two of the twelve component tests — nothing publishes without your action, and the learning loop —
cannot start their four-week windows until LinkedIn is connected. So this is worth starting before
you need it.

The connect flow is now built on our side and waiting. What it needs is a developer app in **your**
name, because clause 14.1 puts every account in your name and this one holds a publishing identity.

Four steps, in order:

1. **A LinkedIn Page for Slingshot GTM, if there is not one already.** LinkedIn will not let you
   create a developer app that is not associated with a Page. This is the step that most often
   stalls, so it is worth checking first rather than last.
2. **Create the app** in the LinkedIn developer portal, associated with that Page.
3. **Add two products.** "Share on LinkedIn" gives the posting permission and is self-serve — no
   review, granted immediately. "Sign In with LinkedIn using OpenID Connect" is needed only so the
   system can read your member id, which becomes the author on every post.
4. **Send me the Client ID and Client Secret.** They go into the encrypted vault in your own
   database, not into a config file, so you can rotate them yourself later with one statement.

Then one click connects it.

**Separately, and much slower: post analytics.** Impressions, reach and reactions sit behind
LinkedIn's Community Management API review, which needs a registered company and a Page admin and
takes weeks. Publishing does not wait for it. The system is built to publish from day one and record
the numbers as unavailable, because your spec says the two automatic signals have to be enough on
their own. Apply if you want the numbers, but nothing is blocked on the answer.

**One thing to expect.** LinkedIn does not issue every app a refresh token. If yours does not get
one, the connection lasts about 60 days and then needs redoing. That is a known chore rather than a
surprise: the expiry is watched and you will be warned well before it lapses. I mention it now so it
is not a mystery in November.

## Seven things I need back from you

1. **The transcripts.** Your README flags that the 31 August call keeps its clinical vertical
   language, and anyone in that market could infer the client. Four calls or five is your call. I
   have kept all six out of version control until you answer.
2. **adam-treboutat.** That account returned zero posts. The fetch succeeded and found nothing, which
   usually means the handle has changed. Can you confirm it?
3. **Leverage** — in or out.
4. **The four gate additions** — do you want them.
5. **Visual brand.** The one section your document does not reach. Five one-line answers replace
   everything I have put there as a default: colours, type, shape, density, and what you would never
   post. If you have a deck or a site with the colours already on it, sending that is faster than
   answering.
6. **A recording of you making a case for something**, unprompted, fifteen minutes.
7. **The LinkedIn app** — the Page, then the two products, then the Client ID and Secret. Start with
   whether a Slingshot GTM Page exists, because everything else waits on it.

## What the system is waiting on

One of twelve component tests is passing. None are failing. The other eleven are waiting on inputs
and on elapsed time rather than on code.

The largest single blocker is a paid model for the gate. It blocks the fabrication audit, the names
audit and 17a, which is the finish line the engagement is judged on. The free tiers fabricate, which
is the one thing this build exists to prevent, so I will not run your audits on them.

After that it is you using it: twenty voice notes, two more prompted sessions, and eight moments you
actually answer. Six were asked and left unanswered, and those measure nothing about the interview.

Naga
