# Josh's call, 14 October — requirements, fixed, pending

**Internal working document.** Not for Josh; the client-facing version is the setup guide.
Status verified against the live project on 14 October, not against what the code claims.

**Status column:** `DONE` shipped and verified live · `DONE*` shipped but needs a `git pull` on his
side to reach him · `DECIDED` we chose not to do it **and he has not been told** · `OPEN` not done ·
`HIS` waiting on him.

---

## 1. What he actually asked for

His own framing, which should lead any reply to him:

> "I think I over-complicated by saying let's build this whole thing... just going back to the core
> system and getting that right. I do like the interviews, but I don't want to have to do them all
> the time — a toggle on, toggle off would be good."

So the brief from the call is **not** new features. It is: make the core path produce a post he would
publish, and stop making him do things he did not ask for.

---

## 2. Everything he raised, with status

| # | What he said | Status | Where it stands |
|---|---|---|---|
| 1 | "it's not connected to the repository. That is strange." | **DONE** | Confirmed live. His session called **Exa**, which appears nowhere in our codebase — it was his older content system, still on his own drive. `system_status` now returns `reading_from` (project ref, library version, section count), which no other system can produce, and CLAUDE.md says stop if it is absent. **Most of what he judged that morning was not our code.** |
| 2 | "it said I didn't call the voice brief, I read through the voice files on disk instead" | **DONE\*** | Our own skill file said *"Read the law set. All five files are short"* and then told it the library wins where they differ. Step 1 now calls `get_voice_brief`. **Read off his disk — needs `git pull`.** |
| 3 | "your voice instructions say to read all six and I skipped the identity, the receipts and voiceprint files" | **DONE\*** | Same fix. The audit also found two of the six were **not reachable through any tool at all** — his biography and his receipts — both now named in the skill with resource URIs. |
| 4 | "a lack of line breaks... text-heavy... rather than just a wall of text" | **DONE** | Root cause: the rule existed, reached the writer, and was **deliberately withheld from the judge**. None of the eight checks could fail a wall of text. Added a **ninth check (`shape`)**, migration 0049, judged against the writers' measured medians. `measure_draft` now also returns `above_fold_words`, and the one paragraph rule no longer exempts one-block posts. |
| 5 | "a little dry and a little disconnected, like it's jumping thoughts" | **DECIDED** | **We agreed with him and did not build it.** No measurement exists for it, and a check written from our taste is what this build refuses everywhere else. Needs him to mark up one draft first. **He has not been told we skipped it — must be said today.** |
| 6 | "the fresh scraping... needs their database key and an Apify run" | **OPEN** | Correct on both. `CONTENT_MCP_KEY` never issued (needs Pro on the project account); `APIFY_TOKEN` never bought. He is **not blocked** — the connector does everything. But see item 11: the scrape has a worse problem than access. |
| 7 | We offered to **read his previous LinkedIn posts** for context | **DECIDED** | Clause 8a forbids it: his archive was written with heavy AI help and has drifted, so training on it reproduces the exact problem the system exists to solve. **He is expecting this. Must be said today.** |
| 8 | We offered to **mimic the delivery** of Matt and the other writers | **DECIDED** | Clause 8.3: reference writers are **structure only**, never cadence. Our own Matt Barker analysis names his cadence as the one most likely to leak. Same as above — **he is expecting it.** |
| 9 | "would it be worthwhile if I spoke for an extended period and uploaded that?" | **HIS** | **He offered and we said it was not needed. That was wrong.** `voice_transcript` is still empty — which is why drafts kept failing the voice check, because there was nothing to check them against. Go back and accept. |
| 10 | Install it as a skill he invokes | **OPEN** | Agreed on the call. Deliberately not bundled with the quality work — it is a packaging change and belongs in its own commit. |
| 11 | *(not raised — found while checking his report)* | **OPEN** | **Our scraping console strips every line break.** Verified 70/70 on 9 Oct, 66/66 on 13 Oct, and a fresh scrape today. A post reading `I bought:` / `- A calendar tool` comes back as `I bought: -A calendar tool` — the newline became one space and the following space was eaten, i.e. a whitespace collapse. The xpilot client only strips the ends, so it is **server-side at scraping.thought-pilot.co**. Our own `content-agent` data carries 841 newlines per file, so the console is the odd one out. Consequence: structure rests on **51 of 156** posts. |
| 12 | *(not raised — from the kickoff transcript)* | **DONE** | At kickoff we said *"then we keep scraping the Sentinel account... we tend to scrape and keep updating that."* It never happened — collected once on 7 September, nothing for a month. **He noticed before we did.** There are 8 cron jobs on the project and none touched the reference writers. `worker-ops` now alerts after 7 days of silence. |
| 13 | *(not raised — from the kickoff transcript)* | **HIS** | He offered to send **Matt Barker's frameworks, hooks and course prompts** on 1 September. Never arrived, never chased. It is a more direct answer to "lean into Matt Barker" than any amount of scraping, because it is what he *teaches* rather than what we infer. |

---

## 3. Also fixed since his 13 October escalation

His WhatsApp: *"It's still asking me interview questions" / "And referencing the idea bank" / "I want
to scrap all that for the time being" / "It also appears to not be referencing the library
correctly."*

Reconstructed from live rows: at 04:27 he captured a moment, answered **21 interview questions**, and
at 05:02 the system drafted a **different, older idea**. That draft failed 4 of 8 checks and he never
saw it. At 05:58 he edited the banned-phrases list himself.

- **One-step mode** — migration 0047, `set_writing_mode`. The culprit was a 4-hourly cron
  (`worker-select`), not the tool we first assumed.
- **Advisory gate** — a failing draft now reaches him instead of vanishing. He asked for this.
- **Two real library defects** — the extractor ran on **0 characters** of library where 15,635 were
  expected (an array passed where a string was wanted), and `get_library` reported `voice_transcript`
  as full when its body is a note *to him* asking him to record one.
- Also: `next_action` was not mode-aware, and pointed at a tool that has never existed · a parked
  idea could never come back · `write_post` ignored a park · the automatic write-up dropped his
  numbers (his own PR, merged, then narrowed — his detector fired on dates and the word "two", 3 of
  5 real entries, all false) · the gate was reading his private notes in **five of eight checks** ·
  `.claude/settings.local.json` was committed with pre-approved SQL and deploy against his live
  project.

---

## 4. Decisions we took that he has not confirmed

**Settle these today.** Each is us overriding something said on the call.

1. **His archive stays out of drafting** (item 7). Clause 8a.
2. **Reference writers stay structure-only** (item 8). Clause 8.3.
3. **The "disconnected prose" check is not being built yet** (item 5), pending one marked-up draft.
4. **The gate is advisory, not blocking** — he asked for this on the 13th. Worth re-confirming,
   because it means a flagged post can be published.
5. **We are not buying Apify.** Our console works; the line-break fix is ours and small.

---

## 5. Pending — ours

| Item | Note |
|---|---|
| **Console line-break collapse** | Highest-value item on this list. One normalisation, server-side. Unblocks Matt Barker's structure (51 → 156 posts), the ninth check's targets, and the mid-post patterns currently unmeasurable. |
| Console 407 on post-by-post fetches | `CONNECT tunnel failed, 520/407` proxy auth. 4 jobs, 2 keys, 2 writers. Separate fault from the line breaks. |
| Profile scrapes return other authors | A `mattjbarker1` scrape returned two other writers under `subject_handle`. |
| `CONTENT_MCP_KEY` | Needs Pro on the project account. Decide: buy it, or document that the write boundary is `cc-submit`. |
| **Docker not started** | **103 of 109 e2e cases have never run.** The biggest blind spot behind every "verified" claim we make. One click. |
| Receipts is a placeholder | `load-receipts.mjs --apply` never run. Read the 3,169 characters first — every line becomes assertable fact under his name. |
| Clause 4.1 phone capture | Gone with Telegram, unreplaced. Spec item: rebuild, or get his sign-off to drop it. |
| 3 Telegram functions still deployed | `docs/closeout.md`. We are permission-blocked from removing them from here. |
| 2 tokens unrotated | Connector write and read. |
| stdio path drops unknown arguments silently | Only safe today because he cannot reach that path without the key. |
| Gate shows all 9 checks 6 library sections incl. `gate_rules` | Narrow it per check, as was done for his private notes. |
| No one-step e2e suite | The mode he actually uses has no end-to-end coverage. |
| Install as a skill | Item 10. |

---

## 6. Pending — his

1. **15 minutes of recorded audio** — arguing for something, not answering questions. The single
   highest-value input available. We told him no; go back and retract that.
2. **One marked-up draft** — not yes/no. Which line is wrong, where it stops sounding like him.
   Unblocks item 5, and teaches more than an approval does.
3. **Matt Barker's course material** — offered 1 September, never sent, never chased.
4. **Verdicts** — 8 posts waiting. He has approved **zero**.
5. **Two library proposals** — one flags a live contradiction: his `frameworks` section asks the
   writer to "name what most people believe" while his `banned_phrases` calls that the single most
   recognisable AI cadence. A drafter reads both.
6. **LinkedIn connection** — nothing can publish even once he approves it.
7. **`git pull`** — items 2 and 3 are read off his disk and nothing will tell him they changed.
8. **The 14 October call transcript** — he said he would send it. It has not arrived.

---

## 7. Where the numbers actually are

Live, with fixtures and killed moments excluded:

- **32** drafts written · **2** have ever passed every check · **8** waiting on his verdict ·
  **0** approved · **0** published
- Library: **13 of 15** sections filled (`voice_transcript` empty, `receipts` a placeholder)
- Reference corpus: **156** posts, 8 writers, **51** with line breaks
- Mode **one_step** · migrations through **0049** applied · **195** deno + **76** node tests green

**His acceptance test is three consecutive posts he would publish with light edits. We are not
close.** The two things most likely to change that are the recording and one marked-up draft —
neither is code, and both have been waiting since September.

---

## 8. What to finalize with him today

1. Confirm the three decisions in section 4 that override the call — especially the archive and
   mimicking delivery, which he is expecting us to have done.
2. Ask for the recording and for one marked-up draft, and explicitly retract "it isn't needed".
3. Chase the Matt Barker course material from the kickoff.
4. Tell him to `git pull`.
5. Own the two that are ours: the line breaks, and the month the Sentinels sat still.
