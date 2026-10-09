# Your content system

Josh — this turns things that actually happened to you at work into LinkedIn posts that sound like
you. You talk, it asks a few questions, it writes, it checks the draft eight ways, and then you
decide. It never publishes anything you have not approved.

**The test every post has to pass:** could anyone else have written this? If yes, it fails. A post
earns its place because you were in that room and had that conversation.

Everything happens in Claude Code. There is no app to open and no bot to message.

---

## Setting it up, once

**1. Install Claude Code** — <https://claude.com/claude-code>

**2. Get this repo onto your machine**

```
git clone <the repo URL we send you>
cd josh-content-system
```

**3. Fill in one file**

```
cp mcp-server/.env.example mcp-server/.env
```

Open `mcp-server/.env` and paste the two values we send you separately: the project URL and the key.

> That key is the key to your idea bank. Do not paste it into a chat, a ticket or a screenshot. If it
> ever gets out, tell us and we will issue a new one — it takes a minute.

**4. Install the one dependency**

```
cd mcp-server && npm install && cd ..
```

**5. Open Claude Code in this folder and say hello**

```
claude
```

It will ask you once to approve the content system. Say yes. Then just type `hello` — it will tell
you what is waiting and what is worth doing first.

---

## The five things to say

You can talk to it normally. These are the shortcuts when you know what you want:

| Type this | What happens |
|---|---|
| `/waiting` | What is waiting on you, and the one thing worth doing next |
| `/capture` | Save something that just happened, and start asking about it |
| `/interview` | Answer the questions on an idea that is already waiting |
| `/write` | Write the next post that is ready |
| `/review` | Go through the drafts, approve or reject them |
| `/sentinels` | Read Matt Barker and the other writers you chose |

Or in plain English: *"something just happened"*, *"write the next one"*, *"show me the drafts"*,
*"how does Matt Barker open his posts"*, *"put that one out Tuesday"*.

---

## How a post actually gets made

1. **You say what happened.** Half a sentence is enough. "Cold email landed addressed to Ben."
2. **It asks a few questions,** one at a time — what happened before, who was there, their actual
   words, what changed. You can answer three and stop; it will wait.
3. **It writes the post** from your answers and nothing else. Every fact in it traces back to
   something you said. If a detail is missing, the post works around it rather than inventing it.
4. **It checks the draft eight ways** before you see it — including whether anyone else could have
   written it, and whether every claim traces to your material.
5. **You decide.** Approve it with a date, ask for a rewrite in your own words, change a line
   yourself, or drop it.

Nothing goes to LinkedIn except a post you have approved with a date. The database refuses every
other route.

---

## Two things worth knowing

**It will sometimes write nothing, and that is correct.** If the material is not there in a given
week, fewer posts is the right outcome. It is built to run short rather than pad.

**The thing that would improve it most is a recording of you talking.** Not about how you write —
just you making a case for something, for fifteen minutes, unprompted. The voice guide is currently
built from calls where your job was asking questions, which shows how you ask and not how you argue.
Paste a transcript into a session any time and say "add this to the voice interview".

---

## When something looks wrong

Say *"is it working?"*. If you want to check from a terminal:

```
node scripts/smoke.mjs      # thirty seconds, reads only, changes nothing
```

If a post was due and did not go out, say *"what happened to the post that was scheduled"* — it will
have been recorded, and the reason with it.

---

## What is where

```
.claude/skills/       how it writes, how it judges, how it keeps your voice
.claude/commands/     the shortcuts above
mcp-server/           the tools Claude uses to reach your idea bank
supabase/             the database and the jobs that run on a schedule
scripts/              refreshing the reference writers, rebuilding the voice guide
data/josh/            your voice law set and the measured voiceprint
docs/                 the runbook, the handover, and the spec as we read it
```

`docs/04-handover.md` is the one to read if you ever want to take this over entirely, or hand it to
someone else. Everything runs in accounts you own.
