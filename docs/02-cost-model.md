# Running cost

For Josh Fryszer, from Thought Pilot. Satisfies clause 15.7 — "the expected monthly running cost must
be confirmed in writing before the build starts. Josh's current understanding is around fifty dollars
a month, which is fine, and it needs confirming rather than assuming."

This is the confirmation. **Expect $45–70 a month at four to five posts a week**, with a typical
month around **$53**.

---

## What drives it

The system's cost is dominated by two things: how many moments get mined, and how many drafts get
written and re-written. Everything else is rounding.

Assumptions, stated so you can check them against reality:

- 4–5 posts published a week (~19/month)
- ~30 moments drafted a month, at an average of 1.6 attempts each (the gate rejects and rewrites)
- ~120 moments interviewed a month, averaging 6 turns
- ~700 Claude Code sessions a month reaching the server after local filtering
- ~40 recorded calls a month
- ~200 minutes of voice notes a month

## The numbers

Anthropic pricing per million tokens: Opus 5 $5 in / $25 out, Sonnet 5 $3 / $15, Haiku 4.5 $1 / $5.

| Item | Model / service | Monthly |
|---|---|---|
| Drafting (~48 generations including rewrites) | Opus 5 | $3 |
| The gate (8 independent checks per draft) | Opus 5 | $6 |
| The interview (~120 moments) | Sonnet 5 | $8 |
| Call transcript triage (~40 calls) | Sonnet 5 | $3 |
| Claude Code triage (~700 sessions) | Haiku 4.5 → Sonnet 5 | $2 |
| Learning loop and monthly reports | Opus 5 | $2 |
| Transcription (~200 minutes) | Deepgram | $2 |
| Embeddings for dedup | OpenAI | $1 |
| Visuals (only when you send an image) | Opus 5 | $1 |
| **Model and service subtotal** | | **~$28** |
| Supabase Pro | | $25 |
| Vercel, Telegram, LinkedIn, GitHub | | $0 |
| **Total** | | **~$53** |

## Why the gate costs twice what the drafting does

Because it runs eight separate checks per draft rather than one blended judgement. That is
deliberate, and it is the difference between a gate and a formality: asked to weigh eight criteria in
one prompt, a model averages across them and lets marginal work through. Acceptance test 8 requires
that at least 9 of 10 deliberately generic drafts get rejected, and a single-call gate does not
reliably do that.

It is $6 a month to make the quality mechanism actually work. We would not economise here.

## Why Supabase Pro rather than the free tier

Two reasons, and the first is the real one:

1. **Backups.** The free tier has none. The idea bank is described in your own spec as "the asset"
   and the thing that has to survive every tool around it. Running it without backups would be
   negligent.
2. **Storage.** 4.1.2 requires keeping the audio as well as the transcript. At your volume that is
   roughly 2 GB a year, against a 1 GB limit on the free tier.

The free tier also pauses a project after a week of inactivity, which would silently stop the
calendar during a holiday.

## If you want it firmly under $50

Three levers, in the order we would pull them:

1. **Start on the Supabase free tier** for the first month or two while the bank is small. Saves $25.
   Move to Pro before the audio matters.
2. **Sonnet 5 for the interview instead of drafting-grade quality** — already the case, so no change.
3. **Drop the gate to Sonnet 5.** Saves ~$4. We would advise against it: the gate is what stops
   generic posts reaching your name.

We would not recommend moving drafting off Opus 5. It is $3 a month and it is the entire product.

## Where the number could move (15.9)

We will raise these with you rather than letting them appear on a bill:

- **Volume.** The model above assumes ~30 moments drafted a month. If capture goes well and that
  doubles, model costs roughly double — to about $56 in models, $81 all in. That is a good problem,
  but it is a change.
- **Gate rejection rate.** If early drafts fail the gate often, each moment costs up to three drafts
  and three full gate passes. Expect this to be higher in the first weeks and to fall as the library
  is tuned.
- **Claude Code volume.** Budgeted at ~700 sessions a month reaching the server. The local agent
  filters hard before anything is sent, and we will calibrate it against your actual machine
  (`node eval/calibrate-cc.mjs`) rather than assumed thresholds.
- **Storage growth.** Audio accumulates and is never deleted, because 6.3 forbids it. Around 2 GB a
  year. Well inside Pro's 100 GB, but it is a line that only goes up.

## Maintenance (15.8)

**What tuning covers, at no additional cost, until acceptance:** changes to the reference library,
the prompt set, the gate rules and the drafting instructions — everything needed to reach five of the
last six drafts needing only light editing (17a). That is our obligation, not an extra.

It does not cover new inputs, new outputs or new features, which 17a excludes explicitly.

**After acceptance**, ongoing maintenance would cover: keeping the integrations working when
LinkedIn, Telegram or a model provider changes something; the LinkedIn token rotation; watching cost;
and fixing anything that breaks. To be agreed separately — and per clause 14.3, you are not obliged
to buy it. The system runs without us, and the runbook (`docs/03-runbook.md`) is written so someone
else could pick it up.
