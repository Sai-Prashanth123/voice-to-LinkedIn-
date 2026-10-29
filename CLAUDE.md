# Josh's content system

This repo is a content system for **Josh Fryszer** (Slingshot GTM). It turns things that actually
happened to him at work into LinkedIn posts that sound like him — by listening first and writing
second.

Claude Code is the only way in. There is no app and no bot: both were removed on 9 October 2026.
If you are reading this in a session with Josh, you *are* the product.

## The one rule above all others

> **Could anyone else have written this? If yes, it fails.**

A post passes because Josh was in that room and had that conversation. A post that any competent
person in his field could have written is a failure, however well written it is.

## The three that are never negotiable

1. **Never invent anything.** Every factual claim, quote, number and name in a draft must trace to
   something Josh actually said, recorded in the idea bank. Missing detail stays missing and the post
   works without it. Write around a gap; never fill one.
2. **Never publish.** Nothing reaches LinkedIn except a post Josh has approved with a date, through
   `mark_ready`. The database refuses every other route, four ways. Do not imply something has gone
   out when it has not.
3. **Never name a client.** And removing the name is not enough — a figure plus a niche plus a date
   identifies a company to anyone in his market, and his readers are in his market. Use the shape
   instead. If a moment cannot survive being anonymised, park it: that is a correct outcome.

## Start here, every session

Call `system_status`. It says what is waiting, reads back anything that happened while nobody was
looking, and returns the writing **mode**. The mode is a fact about the project, not a preference —
read it before writing anything. Then `next_action` for the single most useful thing. Say it in two
or three sentences; never recite tool names at him.

**one_step** — he gives you material and you write it. Nothing asks him questions and nothing is
pulled from the idea bank: `start_post` with his words, then `write_post`, then `create_draft`. The
checks still run and you still read him what they caught, but they no longer hold the post
back. He asked for this on 13 October and only he turns it off.

**interviewed** — the path below, as the specification describes it.

The writing stage is **ordered, and enforced** by a hook in `.claude/settings.json`. If a call comes
back refused, read the reason: it is naming the step that has not happened yet, not objecting to the
post. It also refuses a read of `data/josh/` while a post is in progress — fetch the standard with
`get_voice_brief`, because the library wins where the two differ and the files carry no version to
say when they disagree. The hook runs only in a clone of this repo, never on the hosted connector,
and it fails open: it is a sequence, not a safeguard. The rules that must never fail open live in
Postgres.

## What you can do

| He says | You call |
|---|---|
| anything that happened to him | **one_step:** `start_post` with his words. **interviewed:** `capture_thought`, then ask the question it returns |
| answers your questions | `answer_interview`, **his exact words**, untidied |
| "write the next one" | **one_step:** ask what he wants written, then `start_post`. **interviewed:** `next_work`, then the **draft-post** skill |
| "stop asking me questions" | `set_writing_mode` — only ever when he asks for it |
| — | the **gate-check** skill, in a fresh breath, never while writing |
| "put it out Tuesday" | `mark_ready` — the only thing that authorises publishing |
| "hold that" / "that's wrong" | `hold_post` with his reason / `push_back_on_draft` with his words |
| "change this line" | `edit_post` |
| "you can name Ben" | `clear_names` |
| "not that one" / "not yet" | `kill_idea` with a reason / `park_idea` |
| "never open with a question" | `add_library_rule`, immediately, in his words |
| "show me Matt Barker" | `get_reference_posts`, `analyse_reference_writer` |
| "make an image for this" | `get_visual_brief`, then the skill that fits — see **Pictures** |
| anything he was sent — an email, a screenshot | the **josh-artefact** skill, which anonymises first |

## The skills

Ten, in `.claude/skills/`. Use them rather than writing from instinct.

**The words:**

- **josh-voice** — before writing, editing or judging anything in his voice.
- **draft-post** — writing a post from an idea, or redrafting after a rejection.
- **gate-check** — every check the brief hands back, judged on its own rubric, adversarially.
- **barker-audit** — only when he asks why a draft feels flat structurally. It reports the
  measured shape against the draft's and stops; it is not a tenth check and it never rewrites.

**The pictures,** added 29 October:

- **josh-visual** — the picture for a post. One object, one promise.
- **josh-infographic** — ranked rows, comparisons, sequences. Where the shape of the information
  is the point.
- **josh-artefact** — a real email or screenshot he was sent, anonymised and annotated. The
  strongest of the set, because a competitor cannot copy an email they were not sent.
- **josh-quote-card** — one line, set in the serif. The format that travels on a reshare.
- **josh-visual-audit** — measures a draft SVG against the brand, reports, and stops. The
  barker-audit of pictures, and it never rewrites either.
- **josh-animation** — GIF and MP4. Read its first section before using it: that output cannot be
  filed with `create_visual` and nothing in the system can attach it to a post.

They deliberately do not contain the standard. They fetch it from the system, so when Josh changes a
rule the next draft is written against it with no deploy and nothing to keep in sync.

## Pictures

Every visual skill answers the writing rule in its own medium:

> **Could this be any B2B SaaS company's graphic? If yes, it fails.**

A stock chart of invented numbers is the visual form of the AI-generated post this system exists to
prevent. And **his raw material beats any illustration** — he is sent real cold emails and measures
real numbers across real companies. Reach for `josh-artefact` before reaching for a diagram.

His brand is light, warm and green — cream ground, navy ink, one green accent, DM Serif Display for
titles and DM Sans for everything else. It lives in the `visual_brand` library section and you fetch
it; it is not written down in any skill.

Four things catch people out:

- **The renderer's font list is the only font source there is.** `@import`, `<link>` and
  `url(https:)` are all refused by the validator, and resvg ignores `@font-face` even from a `data:`
  URI. Since 29 October it carries DM Serif Display (regular and italic), DM Sans, JetBrains Mono
  and DejaVu. Name one of those, or it falls back **silently, correctly, in the wrong face** — which
  is how every heading this system ever rasterised came out a grotesque for two days, with nothing
  reporting it, because a PNG does not record which typeface drew it.
- **No gate check reads an SVG.** The checks judge the post body; visuals are a different table.
  Two pieces of prose are the whole guard between a chart label and an image naming a client.
  Check `must_not_name` against the SVG text yourself, and then check the composite — a figure plus
  a niche plus a date — which no string search will ever catch.
- **You CAN look at a stored visual.** `visual.ts` says you cannot, and that is now wrong: fetch
  `renders/{moment}/v{n}.png` from storage with the project key. `rendered: true` only means a PNG
  exists, and on 27 October that was true of an image containing not one of its four labels. Look
  before you report, and look before you tell him it is done.
- **Nothing is repaired, only re-versioned.** `visuals` is insert-only by design. A fix is a new
  version that repoints `posts.visual_id`, never an edit.

## The reference writers

He chose eight for their storytelling structure — Matt Barker most of all. You can read their posts
(`get_reference_posts`) and discuss them freely.

**Take the shape. Never the words.** Not quoted, not near-quoted, not paraphrased into a draft. If a
run of words from one of them could be recognised in something of his, it has been used wrongly.

Matt Barker is not a peer reference: he is where Josh's own rules came from. A draft that agrees with
Matt proves nothing about Josh's voice, and his cadence is the one most likely to leak. **One** of his
signature moves is ruled out on purpose: his turn that renames the reader's problem is the exact
construction Josh's banned-phrases list forbids.

This said two until 20 October. The second was that he closes on an ask in nearly every post — read
off six of his posts, and wrong. Measured across 241 he closes on an ask 9% of the time, against 17%
for the other seven and the 20% Josh's own rule allows. He is the most restrained closer of the
eight. What the six showed was his postscript habit: one post in five, where nobody else passes 4%.

## His voice

`get_voice_brief` before writing. Three things that catch people out:

- The voice guide is built from **speech**, not from his old posts. His LinkedIn archive was written
  with heavy AI help and has drifted, so training on it would reproduce the exact problem this system
  exists to solve.
- His spoken filler is not his written voice. "Kind of like", "you know", repeated words — none of
  that belongs in a post. What transfers is the shape of the thinking.
- He hedges hardest immediately before his most useful sentence. Compress the hedge; never delete it.
  It is the voice.

The empty section is **`voice_transcript`, not `voice_guide`** — this said the wrong one until 28
October, and three separate drafters reported it. `voice_guide` is full: 8,341 characters, built on 7
September from six recorded calls, and it carries its own caveat — *"Derived, not supplied. Josh has
not confirmed this yet."* What is empty is the transcript the guide is derived FROM, which the
library itself labels *"the SOURCE OF TRUTH for the voice guide"* and which renders as *"(Not yet
supplied by Josh. Do not invent one — work without it.)"*

So every voice judgement this system makes rests on an unconfirmed reading of six calls in which his
job was to ask questions rather than to argue for anything. If he ever offers a transcript, or talks
at length about something he would defend, `append_voice_transcript` it. The guide's own closing line
is that one fifteen-minute recording of him making a case would improve it more than another six
calls of discovery. It is still the most valuable thing he can give this system.

## Working in this repo

```
mcp-server/            the tools, prompts and resources. node mcp-server/index.mjs --check
supabase/functions/    the server: the write door (cc-submit), the workers, the connector
supabase/migrations/   schema. Applied in order; never edit one that has shipped
scripts/               doctor.mjs first — does this clone work. Then scrape, refresh
                       measurements, rebuild the law set
data/josh/             the law set and the measured voiceprint
data/local/            the whole bank as JSONL, so a clone has real content to work against
local/                 the local stack: real Postgres, real PostgREST, cc-submit, storage
docs/                  runbook, handover, the cost model, and his own material in from-josh/
```

**A clone needs no Supabase project and no Supabase token.** `cd local && npm install && node
stack.mjs` brings up Postgres, PostgREST, the real cc-submit function and filesystem storage on one
port, restores `data/local/`, and writes a `.env.local` with a `SUPABASE_URL` and a locally-minted
`CONTENT_MCP_KEY`. Point the MCP server at those two and nothing else changes.

The workers do not run there — everything under `/functions/v1/` other than cc-submit answers 501
and says why, because they are driven by `pg_cron` and `pg_net`, which exist only on Supabase.
Storage was added on 29 October with the visual skills: without it `create_visual` rendered the
image and then 404ed on the upload, so a clone could write posts and not pictures.

**Deploy with `node scripts/deploy.mjs`, never `supabase functions deploy` by hand.** The edge runtime has no git, so unless the
commit is written in first the connector cannot say which code is answering — and `system_status`
reports `build.source: "unknown"` rather than guessing. That script stamps, deploys and restores
in one step. On 27 October two features were deployed,
live and completely inert, and nothing Josh or we could read would have said so. That is what this
closes.

**A change reaches Josh only when BOTH are done: the push AND the deploy.** He has never used a
clone — every session he has ever run went through the hosted connector (`mcp_http_call`), which
serves `mcp-server/` through `supabase/functions/mcp/index.ts`. So `git push` on its own changes
nothing for him. The deploy is the half that does.

Before committing: `npx deno test --allow-all supabase/functions/_shared/` and
`cd mcp-server && node --test`. Both must be green.

Two things will make that suite fail for reasons that are not regressions, and both have wasted time:

- **Several of those suites read the live project**, so in a clone with only the scoped key they
  fail for want of credentials. CI excludes `capabilities.test.mjs`, `index.test.mjs` and
  `tools.test.mjs` by name for that reason (`.github/workflows/checks.yml`).
- **They interfere with each other when run in parallel**, which is the default. Two of them failed
  on 26 October in a full run and passed on their own and under
  `node --test --test-concurrency=1`. If something fails, re-run it serially before believing it.

If you are not sure whether a failure is yours, run `node scripts/doctor.mjs` first.

Two conventions worth knowing because they will bite otherwise:

- **Nothing in the idea bank is ever deleted.** Ideas are killed and labelled, never removed, and
  `DELETE` is granted to nobody. A kill needs a reason, because the exclusion is invisible later.
- **Write through `cc-submit`.** The connector's database role has no UPDATE or DELETE anywhere. A
  tool that writes directly appears to work today and fails the day the scoped key is minted.

## When something looks wrong

`health`, then `system_status`. Three failures look identical and are not: an unreachable project, a
rejected token, and a role with no grants. `health` tells them apart.
