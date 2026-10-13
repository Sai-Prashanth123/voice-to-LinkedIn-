# What went wrong this morning, and what has changed

Josh — you were right on both counts, and one of them was a real fault in the system rather than a
misreading of it. Here is what your session actually did, from the database, and what is different
now.

---

## Your morning, hour by hour

| Time | What happened |
|---|---|
| 04:27 | You captured a thought. It was filed as "Champion mover outreach value prospect" |
| — | **21 interview questions** were asked and answered |
| 05:02 | A draft was written — **from a different idea**, one from September about building a TAM |
| 05:02 | It failed 4 of the 8 checks, so you received nothing |
| 05:58 | You added a rule to the banned-phrases list yourself |
| 10:00 | "It's still asking me interview questions" |

The idea you captured at 04:27 never moved. You answered 21 questions about it and the system wrote
about something else.

---

## Why it asked you questions

There was no way through capture that did not ask one. The code called for a question
*synchronously* as part of filing your thought — so "capture a thought" and "start an interview"
were a single action with no seam between them. Nothing you could have said would have skipped it.

**Changed.** Capture no longer asks. Your words are filed and that is the end of it.

## Why it wrote about the wrong idea

This one I had wrong until I went looking. A scheduled job runs every four hours and queues up ideas
to be drafted from whatever is sitting in the bank. It had queued the TAM idea earlier. When the
system was asked to write, it took what was in the queue — which was that, not yours.

So the two things were unrelated: your 21 answers went into one idea, and the draft came out of
another, and nothing connected them.

**Changed.** That job does nothing while this mode is on, and the "write the next one" path no
longer reads the queue at all. What gets written is what you just gave it.

## Why the library looked wrong

You were right, and this is the one I would have missed if you had not said it.

Two faults, both real:

**The system could not read your library when recording your answers.** A one-word mistake — passing
a list where a name was expected — meant the step that turns your answers into material was running
with *no library at all*. Not a degraded one. Zero characters where there should have been fifteen
thousand. So all 21 of those answers were processed by something that had never read your pillars,
your audience or your rules.

**The library told you it was full while the writer was handed a gap.** Your voice section — the
transcript of you talking, which everything about your voice is supposed to rest on — was reported
as filled, 1,205 characters of content. Its actual contents are a note *to you*, asking you to
record one. Meanwhile the thing writing your posts was being told "not yet supplied, work without
it". You read a full library; the writer got a hole.

That is why drafts kept failing the voice check. There was nothing to check them against.

**Changed.** Both fixed, and there is now a test that fails if any part of the system invents its own
answer to "is this section filled in" — which is how the two drifted apart in the first place.

---

## What is different when you open it

**Nothing asks you questions.** You say what happened, and it writes. No interview, nothing pulled
from the idea bank, no queue.

**A draft reaches you even when the checks flag it.** This morning four checks failed and you got
silence. Now the post lands in your calendar with the flags attached, it tells you which checks
caught what, and you decide. The checks still run and still record honestly — a failure is still
recorded as a failure, because the moment that stops being true there is no way to tell whether any
of this is working. What changed is that it is your call rather than the system's.

**It is a switch, not a demolition.** You said "for the time being", so nothing was deleted. Every
idea, answer and draft you have ever given it is still there. Say the word and the interview comes
back exactly as it was.

## What is still true, and I would not change without asking

- **Nothing publishes without you.** Still the only thing that authorises a post, still enforced by
  the database rather than by good behaviour.
- **Nothing is invented.** Every claim in a post is still checked back against your own words, span
  by span, before it is stored. That is the one thing the idea bank is still doing underneath — it
  is where your words live so a draft cannot quietly make something up. You never have to go near
  it.
- **No client gets named** unless you have said that name is fine.

---

## The one thing I would still ask you for

Fifteen minutes of you talking — making a case for something, not answering questions. The voice
section is empty, which the system has now admitted for the first time, and it is the single biggest
reason drafts come back sounding like anyone. Six recorded calls exist, and in five of them your job
was to ask questions, so it knows how you ask and not how you argue. The opening and the close are
exactly what a conversation cannot show.

Paste a transcript into a session and say "add this to the voice interview".
