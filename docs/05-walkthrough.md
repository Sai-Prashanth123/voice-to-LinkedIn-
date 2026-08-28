# The handover walkthrough

Running order for clause 14.5 — *"a walkthrough with Josh, recorded, covering the runbook end to
end."*

About forty minutes. Record it; the recording is the deliverable, not this document.

## The one rule for whoever runs it

**Josh does everything. We watch.** A walkthrough where he sends the voice note, edits the rule and
taps the button is one he can repeat next week. A demonstration is one he has to be shown again.

Every step below is written as something for him to do. If he gets stuck, that is the most valuable
thing the recording captures — note it and fix the system rather than coaching him past it.

---

## Before the call

- [ ] The desk is reachable and he can sign in — his address, not ours (15.4)
- [ ] Telegram bot responds to `/status` from his phone
- [ ] At least one draft is sitting in the calendar, so the weekly pass has something in it
- [ ] `node eval/acceptance.mjs` run that morning, so the numbers in section 7 are current
- [ ] Screen sharing on his machine, not ours

---

## 1 · What this is, in one minute (2 min)

Say it once, plainly, and do not repeat it later:

> It turns things you already say into posts only you could have written. You talk; it asks; it
> writes; nothing goes out without you.

Then show the shape — five ways in, one idea bank, one calendar — and move on. The rest of the call
is him using it.

Runbook: §1 What each part does.

---

## 2 · Capture, from his phone (6 min)

**He sends a voice note to the bot.** A real one, about something that actually happened this week.
Not a test sentence — the system's whole quality argument rests on lived experience, and a fake one
teaches him the wrong habit.

Then, while it transcribes:

- He sends a **typed** thought
- He sends a **photo** of a diagram, and answers the two questions it asks

**What to point out:** it comes back with a question, not a post. That is 5.5 — the interviewer never
writes. And he can ignore the question for a day; 4.1.3 means a two-minute session is a complete one.

**What he should take away:** capture costs seconds and never blocks him.

---

## 3 · The interview, and being allowed to stop (5 min)

**He answers the question.** Then another. Then he types `/stop` mid-way.

**What to point out:** parking is a real outcome, not a failure. 5.8 caps the questions, and a moment
that will not open is kept rather than padded (6.3 — nothing is ever deleted). Show him the parked
moment in the bank and the **Add to this one** button that brings it back.

---

## 4 · The library — the part that matters most (8 min)

This is the section to spend time on. If he changes nothing else himself, it should be this.

**He opens The desk → Library**, and:

- Reads `core_rules`, which is locked. Explain why: the lived-experience test and the no-fabrication
  rule are the two things the learning loop structurally cannot touch, whatever the numbers say.
- Edits **one hook rule**, saves, and sees the version go up.
- Rolls it back, and sees the reason and date on each version (12.12).
- From Telegram, sends `/rule never use the word journey` and picks the section — a rule added in
  under a minute, from his phone (8.8).

**What to point out:** seven sections are still empty and waiting on him, and the voice guide is the
one that carries everything. Show him the proposal the system has already written from his recording,
if there is one.

Runbook: §5 How to change things.

---

## 5 · The weekly pass (7 min)

**In Telegram, he runs `/review`.** He should:

- Answer the conversation question, or skip it — and be told plainly that skipping is fine and it
  stops asking after twice (12.8)
- Schedule one draft with a tap
- Reject one with **Not this one**, and leave the one-line verdict it asks for
- Open the rewrite link and edit a post properly in the calendar

**What to point out:** nothing published. Marking ready is his authorisation and the only one — and
the database refuses to store a published post without it, so it is not a promise about our code.

---

## 6 · When it breaks (5 min)

**Show him a real daily message.** Then:

- Where the queue-low warning comes from, and why running short is sometimes the correct answer (7.7)
- That errors surface once and do not repeat every morning
- That the system tells him if it starts using a service he was not told about (15.3)
- The four checks in the runbook when something looks wrong

**What he should take away:** silence is not the same as nothing happening, and the system knows the
difference.

Runbook: §4 What to check first when something breaks.

---

## 7 · What it costs, and where it stands (5 min)

- The month's spend, from the monthly message he already receives
- The two decisions that cost money and why we would not economise on either: the eight-check gate,
  and Supabase Pro for backups
- **The acceptance scoreboard** — the twelve component tests, what each is waiting on, and 17a. Be
  straight about the number. Today it is zero of twelve and none of them are failing.

Runbook: §4b What it costs · §6b Where the build stands.

---

## 8 · It is yours, and it runs without us (5 min)

**He clicks Export**, and opens the file. Twenty-two tables, his data, no lock-in.

Then walk `OWNERSHIP.md` and `docs/04-handover.md`:

- Everything transfers on payment, including the prompts and the library
- No component needs a licence from us
- The migration into his accounts has been rehearsed, not just written — and the two steps that have
  not been proven are named in the document rather than glossed

**Close on the honest position:** until the accounts are in his name, 14.3 is not met. That is the
next thing, and it is a checklist rather than a project.

---

## After the call

- [ ] Recording saved somewhere he owns
- [ ] Anything he got stuck on written down as a fix, not a coaching note
- [ ] Any question he asked twice — that is a documentation gap, not his fault
