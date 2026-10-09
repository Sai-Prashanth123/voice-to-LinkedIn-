# Your content system

Josh — this turns things that actually happened to you at work into LinkedIn posts that sound like
you. You talk, it asks a few questions, it writes, it checks the draft eight ways, and then you
decide. **It never publishes anything you have not approved with a date.**

**The test every post has to pass:** could anyone else have written this? If yes, it fails. A post
earns its place because you were in that room and had that conversation.

Everything happens through Claude. There is no app to open and no bot to message — both were removed
on 9 October 2026 because they were two more places for things to go wrong.

---

## Contents

1. [What you need before you start](#1-what-you-need-before-you-start)
2. [Setup — Claude Code](#2-setup--claude-code-recommended) *(recommended)*
3. [Setup — Claude desktop app or claude.ai](#3-setup--claude-desktop-app-or-claudeai)
4. [Setup — Codex, Cursor, or any other MCP client](#4-setup--codex-cursor-or-any-other-mcp-client)
5. [Checking it works](#5-checking-it-works)
6. [How to use it](#6-how-to-use-it)
7. [How a post actually gets made](#7-how-a-post-actually-gets-made)
8. [The reference writers, and Matt Barker](#8-the-reference-writers-and-matt-barker)
9. [What makes it sound like you](#9-what-makes-it-sound-like-you)
10. [When something looks wrong](#10-when-something-looks-wrong)
11. [What is where](#11-what-is-where)
12. [What it costs and who owns it](#12-what-it-costs-and-who-owns-it)

---

## 1. What you need before you start

| | |
|---|---|
| **Node.js 20 or newer** | `node --version`. If it is missing: <https://nodejs.org> |
| **Git** | `git --version`. If it is missing: <https://git-scm.com> |
| **A Claude subscription** | Any paid plan. Claude Code is included. |
| **Two values from us** | A project URL and a key. We send these separately, never in the same message as the repo link. |

> **About that key.** It is the key to your idea bank — every thought you have captured, every draft,
> every answer you have given. Keep it in the `.env` file this guide creates and nowhere else. Do not
> paste it into a chat, a ticket, a screenshot or an email. If it ever gets out, tell us: issuing a new
> one takes a minute and costs nothing.

---

## 2. Setup — Claude Code (recommended)

This is the one to use. It gives you every tool, the three writing skills, the shortcut commands, and
the ability to run the maintenance scripts. The others are for when you are away from your laptop.

### Step 1 — get the code

```bash
git clone <the repo URL we send you> josh-content-system
cd josh-content-system
```

### Step 2 — install the one dependency

```bash
cd mcp-server
npm install
cd ..
```

This installs the MCP server's packages. Nothing else in the project needs installing.

### Step 3 — create your environment file

```bash
cp mcp-server/.env.example mcp-server/.env
```

Open `mcp-server/.env` in any text editor and fill in the two values we sent:

```
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
CONTENT_MCP_KEY=<the key we sent>
```

Save it. That file is already excluded from git, so it cannot be committed by accident.

### Step 4 — check the connection before going further

```bash
node mcp-server/index.mjs --check
```

You want `ok`. If you get an error, jump to [section 10](#10-when-something-looks-wrong) — it
distinguishes three failures that look identical and are not.

### Step 5 — open Claude Code and approve the server

```bash
claude
```

The project already contains `.mcp.json`, so Claude Code finds the content system on its own. The
first time, it asks whether you trust it. Say yes.

Then type:

```
hello
```

It will tell you what is waiting and the one thing worth doing first. That is the whole setup.

---

## 3. Setup — Claude desktop app or claude.ai

Use this when you are away from your laptop — on a phone, or on a machine without the code. You get
the tools but not the skills, the shortcut commands or the scripts, so it is for capturing a thought
and reviewing drafts rather than for a working session.

Nothing to install. In **Settings → Connectors → Add custom connector**, give it:

- **Name:** `Content system`
- **URL:** `https://<your-project>.supabase.co/functions/v1/mcp?token=<the connector token we send>`

That token is a different one from the key in section 2 — ask us for it and we will send it.

> It goes in the URL because the connector dialog has no field for a header, which is a limitation of
> the dialog rather than a choice. A token in a URL ends up in browser history and in logs, so treat
> it as the more exposed of the two and tell us if you want it rotated.

---

## 4. Setup — Codex, Cursor, or any other MCP client

Anything that speaks MCP can drive this. There are two ways in, and which you want depends on
whether the client runs on your machine.

### Option A — local, over stdio (full surface)

For clients that can start a local process: **Codex CLI, Cursor, Zed, Windsurf, Continue.**

Follow steps 1 to 4 of [section 2](#2-setup--claude-code-recommended) first, so the code and the
`.env` exist. Then point the client at the server.

**Codex CLI** — add to `~/.codex/config.toml`:

```toml
[mcp_servers.content_system]
command = "node"
args = ["/absolute/path/to/josh-content-system/mcp-server/index.mjs"]
```

**Cursor** — `.cursor/mcp.json` in the project, or the global one:

```json
{
  "mcpServers": {
    "content-system": {
      "command": "node",
      "args": ["/absolute/path/to/josh-content-system/mcp-server/index.mjs"]
    }
  }
}
```

**Anything else that takes a command:** the pattern is always `node <path>/mcp-server/index.mjs`,
with no arguments. It reads `mcp-server/.env` itself, so no environment needs passing in.

Use an **absolute path**. A relative one resolves against whatever directory the client happened to
start in, which is the single most common reason one of these refuses to connect.

### Option B — remote, over HTTP

For clients that take a URL instead of a command:

```json
{
  "mcpServers": {
    "content-system": {
      "type": "http",
      "url": "https://<your-project>.supabase.co/functions/v1/mcp",
      "headers": { "Authorization": "Bearer <the connector token we send>" }
    }
  }
}
```

Send the token as a header where the client allows it — the `?token=` form in section 3 exists only
for dialogs with nowhere to put one.

### What you lose outside Claude Code

| | Claude Code | Desktop / claude.ai | Local MCP client | Remote MCP client |
|---|---|---|---|---|
| All the tools | yes | yes | yes | yes |
| The three writing skills | yes | no | depends on the client | no |
| `/waiting`, `/write`, `/review` shortcuts | yes | no | no | no |
| Prompts and resources | yes | no | yes | no |
| Reading your Claude Code sessions for ideas | yes | no | yes | no |
| Running the scripts | yes | no | yes | no |

The skills are what hold the writing standard, so a session without them will draft noticeably worse.
Capture and review anywhere; write in Claude Code.

---

## 5. Checking it works

Three things, in order of how much they tell you.

```bash
node mcp-server/index.mjs --check      # can it reach the database, is the key accepted
node scripts/smoke.mjs                 # thirty seconds, reads only, changes nothing
```

And in a session, just ask: **"is it working?"** — that calls `health` and then `system_status`, and
answers in a sentence.

---

## 6. How to use it

Talk to it normally. These are the shortcuts for when you know what you want:

| Type | What it does |
|---|---|
| `/waiting` | What is waiting on you, and the one thing worth doing next |
| `/capture` | Save something that just happened, and start asking about it |
| `/interview` | Answer the questions on an idea already in the bank |
| `/write` | Write the next post that is ready |
| `/review` | Go through the drafts, approve or reject them |
| `/sentinels` | Read Matt Barker and the other writers you chose |

Or in plain English — all of these work:

- *"something just happened — a cold email came in addressed to the wrong name"*
- *"write the next one"*
- *"show me the drafts"*
- *"that opening is flat, do it again"*
- *"put that one out Tuesday"*
- *"how does Matt Barker open his posts?"*
- *"never open a post with a question"* — it adds that to your rules immediately
- *"give me everything you have"* — exports the whole bank as one file

### The decisions that are only yours

Nothing below happens unless you say so:

| You say | What happens |
|---|---|
| "put it out Tuesday" | The post is approved and dated. **This is the only thing that authorises publishing.** |
| "hold that one" | Off the calendar. If you say why, the reason is recorded — that is the most useful signal the system gets |
| "that's not what happened" | Back for a rewrite, carrying your words |
| "change this line to…" | Your text replaces it, and the difference is measured |
| "you can name Ben" | That name is cleared for that post only |
| "not that one" | Killed, with your reason. Nothing is deleted — it stops being chosen |

---

## 7. How a post actually gets made

1. **You say what happened.** Half a sentence is enough.
2. **It asks a few questions,** one at a time — what happened before, who was there, their actual
   words, how it felt, what changed. Answer two and stop if you like; the rest can wait.
3. **It writes the post** from your answers and the reference library, and nothing else. Every fact
   traces back to something you said. Where a detail is missing it writes around the gap rather than
   inventing one.
4. **It checks the draft eight ways** before you see it: could anyone else have written this, does
   every claim trace to your material, does the hook open a loop, is it aimed at a specific reader,
   does it sound like you, are the names cleared, is anyone identifiable, and are there any AI tells.
   A draft that fails comes back with the reasons. Three failures and the idea parks itself.
5. **You decide.** Approve with a date, ask for a rewrite, edit a line, or drop it.
6. **On the date, it publishes** — and seven days later it collects what happened, so the system
   learns from what worked rather than from what it assumed.

**It will sometimes write nothing, and that is correct.** If the material is not there in a given
week, fewer posts is the right outcome. It is built to run short rather than pad.

---

## 8. The reference writers, and Matt Barker

You chose eight writers for their storytelling structure. All of their recent posts are stored and
you can read them:

- *"show me Matt Barker's last five posts"*
- *"how does Jen Allen-Knuth close a post?"*
- *"find me posts about distillation"*
- *"how does Matt build a post?"* — a structural read: how long, how he opens, where the turn lands,
  how often he uses a list

**What the system takes from them is the shape, never the words.** Not quoted, not near-quoted, not
paraphrased into a draft. If a run of words from one of them could be recognised in something of
yours, it has been used wrongly — and the drafting and gate steps are deliberately given measurements
rather than their prose, so a draft cannot borrow a sentence it has never seen.

**Matt Barker is a special case and it is worth knowing why.** He is not a peer reference — he is
where your own rules came from. His 3 September post states the lived-experience test and "lessons not
advice" in almost the words you sent us. So a draft agreeing with Matt proves nothing about your
voice, and his cadence is the one most likely to leak in.

Two of his signature moves are ruled out on purpose:

- **His turn that renames the reader's problem** — "you don't have an ideas problem, you have a
  distillation problem". That is the exact construction your banned-phrases list forbids, and the most
  recognisable AI cadence on LinkedIn.
- **His close.** He asks in nearly every post. Your rule rations a direct ask to one in five, and your
  buyer lurks rather than engages.

What does transfer: open on someone else's situation with their number in it (which also anonymises,
and suits material you cannot name); anchor the point to something mundane and specific; one mechanism
per post; name the audience once, in the middle.

---

## 9. What makes it sound like you

Three things, and one of them needs you.

**The voice guide** is built from recordings of you *talking*, not from your old posts. Your LinkedIn
archive was written with heavy AI help and has drifted, so training on it would reproduce the exact
problem this exists to solve.

**The voiceprint** is the measured half: sentence lengths, how often you hedge, the words you use that
your peers do not, the words you never use. Your count of em dashes across 11,022 words of speech is
zero, which is why a draft never has one.

**The voice interview is currently empty, and it is the biggest gap in the system.** What exists was
derived from six calls where your job was asking questions — so it shows how you ask and not how you
argue, and the hook and the close are exactly what a conversation cannot show.

> Fifteen minutes of you making a case for something, unprompted, would improve this more than
> another six calls. Paste a transcript into any session and say *"add this to the voice interview"*,
> or just talk and let the session transcribe it.

---

## 10. When something looks wrong

Ask: **"is it working?"**. If you want to check yourself:

```bash
node mcp-server/index.mjs --check
node scripts/smoke.mjs
```

| Symptom | Likely cause | What to do |
|---|---|---|
| `CONTENT_MCP_KEY is not set` | `mcp-server/.env` missing or empty | Redo [step 3](#step-3--create-your-environment-file) |
| `401` or `invalid token` | The key is wrong or has been rotated | Ask us for a new one |
| Connects, but every list is empty | The key is valid but has no grants | Tell us — that is ours to fix |
| Claude Code does not see the tools | Not opened in the project folder | `cd josh-content-system` first, then `claude` |
| A local MCP client refuses to start it | A relative path in the config | Use the absolute path to `mcp-server/index.mjs` |
| A post was due and did not go out | The publish step failed and recorded why | Ask *"what happened to the post that was scheduled?"* |

Those first three look identical from the outside and are not, which is why `--check` tells them
apart rather than just saying "failed".

**One thing to know about how it tells you things.** Nothing can send you a message any more — there
is no bot. So anything that happens while you are away, including a post that failed to publish,
waits until you next open a session. Say `/waiting` or *"what did I miss?"* and it reads them out. If
that trade is wrong for you, email alerts are about an hour's work — say so.

---

## 11. What is where

```
CLAUDE.md             the rules a session reads before it does anything
.claude/skills/       how it writes, how it judges, how it keeps your voice
.claude/commands/     the shortcuts in section 6
mcp-server/           the tools Claude uses to reach your bank. Your .env lives here
supabase/
  migrations/         the database. The hard rules are enforced here, not in code
  functions/          the server: the write door, the scheduled jobs, the connector
scripts/              refresh the reference writers, rebuild the voice guide, smoke test
data/josh/            your law set and your measured voiceprint
docs/
  03-runbook.md       how to run it, change it and fix it
  04-handover.md      taking it over entirely
  00-spec-understanding.md   every clause of the build spec, restated
eval/                 the test harness that proves the rules still hold
```

---

## 12. What it costs and who owns it

It runs in accounts in your name and the work is yours — `docs/04-handover.md` is the full
ownership and transfer document, and *"give me everything you have"* exports the bank as one file at
any time, so nothing is ever held hostage.

Running cost is in `docs/02-cost-model.md`. The parts that cost anything are the database, the
language-model calls behind the interview questions, and a scrape of the reference writers if you want
that refreshed on your own key rather than ours.
