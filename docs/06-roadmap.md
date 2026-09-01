# What we build next

Six phases. Written 1 September 2026.
Each lists **the actual things to build** — files, tables, functions.

Phases 1, 2, 4, 5, 6 run in order. **Phase 3 runs alongside** and is not ours.

---

## The constraint that shapes phases 1 and 2

Edge Functions run in Supabase's cloud. Claude Code runs on Josh's laptop.
**The cloud cannot call the laptop.** So the laptop pulls: it asks what needs
writing, writes it, and posts the result back.

That means we do *not* add a `claude-code` provider inside `llm.ts` — a cloud
function would sit there waiting for a machine it cannot reach. The drafting and
gate handlers stay where they are; the laptop drives them from outside.

---

## Phase 1 · MCP connectors

**Build a new `mcp-server/` package** — a stdio MCP server in Node, talking to
Supabase over PostgREST.

| Build | Detail |
|---|---|
| `mcp-server/index.mjs` | Server entry, stdio transport, tool registration |
| `mcp-server/tools/read.mjs` | `list_moments` · `get_moment` · `get_library` · `list_drafts` · `get_acceptance` |
| `mcp-server/tools/write.mjs` | `create_draft` · `record_gate_verdict` · `propose_library_change` |
| `mcp-server/auth.mjs` | Reads one key from env, never the service-role key |
| `supabase/migrations/0028_mcp_role.sql` | A Postgres role with select on the bank and library, insert on drafts and verdicts, **no delete anywhere** |
| `.mcp.json` | Register the server so Claude Code loads it |
| `mcp-server/index.test.mjs` | Every tool called against live data once |

**Reuses:** `db.ts` query shapes, the existing RLS. Adds no new access path —
the new role sits under the same rules everything else does.

**Done when:** `list_moments` returns the real waiting moments and `create_draft`
writes a row that appears in the calendar.

---

## Phase 2 · Writing skills — add, then tweak

**Build two Claude Code skills and the loop that feeds them.**

| Build | Detail |
|---|---|
| `.claude/skills/draft-post/SKILL.md` | Reads library + one moment via Phase 1, emits a draft **and a claim per source span** — the format `claims.ts` already verifies |
| `.claude/skills/gate-check/SKILL.md` | Runs the eight checks **read from `GATE_CHECKS`** — it does not restate them. One verdict per check, each independent |
| `cc-agent/work.mjs` | The pull loop: ask what is waiting → run the skill → post back through Phase 1 |
| `cc-agent/install.mjs` | Extend: schedule `work.mjs` alongside the existing session reader |
| `supabase/migrations/0029_draft_source.sql` | Mark which drafts came from Claude Code, so test 8 can tell them apart |
| `eval/gate-acceptance.mjs` | Re-point at Claude Code drafts and re-run |

**Reuses unchanged:** `prompts.ts` — `GATE_CHECKS` is `anyone_else`,
`claims_trace`, `hook_opens_loop`, `aimed_at_someone`, `voice_guide`,
`names_cleared`, `identifiable`, `banned_phrases`. Also `claims.ts` (verification
is mechanical and stays server-side), `library.ts`, and the drafts table.

**Already solved — do not rebuild:** `handlers/gate.ts` writes each verdict the
moment it is reached and skips checks that already have one, so an interrupted
run resumes rather than paying twice. It also drops to serial when the provider
throttles. Both were built for Groq’s ceiling and both still apply.

**Then tweak** — read the rejections and fix the skills, not the checks.
`prompts.ts` and the gate thresholds do not move in this phase.

**Unblocks:** component tests 6, 7, 8, 10 and the finish line 17a.

---

## Phase 3 · Josh's additions — parallel, not ours

Nothing to build. Everything here is data he provides.

- [ ] Voice guide — ~400 words of him talking. **Start here.**
- [ ] Six remaining library sections: pillars, audience, gate rules, visual brand, reference posts
- [ ] The five moments already asked and unanswered
- [ ] LinkedIn connected — starts two four-week clocks
- [ ] 19 voice notes, 2 sessions, a call recorder chosen
- [ ] `node cc-agent/install.mjs` — starts a two-week clock

---

## Phase 4 · Creative testing

Mostly running things, not building. What gets built is what the running exposes.

| Build | Detail |
|---|---|
| `eval/soak.mjs` | Drive 10+ moments end to end, record every rejection reason |
| `handlers/visual.ts` | First real run — the rebuild path has never executed |
| `eval/acceptance.mjs` | Re-run; rows should move off `----` |
| Fixes | Whatever the soak turns up |

**Stop rule:** a row moving to `FAIL` is a real defect. Fix it before continuing.

**Done when:** 10 drafts have cleared the gate for reasons we have read.

---

## Phase 5 · First round sharing

| Build | Detail |
|---|---|
| Key rotation | Deepgram, Telegram, Groq, Hugging Face, service-role, Supabase PAT — **before any real material** |
| Account migration | `docs/04-handover.md`, executed rather than rehearsed |
| Vercel + Supabase | Into Josh's accounts; `APP_URL`, redirect list, `NEXT_PUBLIC_SITE_URL` follow |
| Recorded walkthrough | Running order is in `docs/05-walkthrough.md` |
| Report refresh | Regenerate `docs/build-report.html` with the live scoreboard |

---

## Phase 6 · Feedback round changes

| Build | Detail |
|---|---|
| Library edits | His feedback applied to library sections — versioned, reversible, no deploy |
| `worker-learn` | Read its proposals, approve or reject each |
| Skill tweaks | Only where a library edit genuinely cannot carry it |
| `eval/acceptance.mjs` | Final run; record which tests actually moved |

Anything beyond the specification gets quoted, not absorbed.

---

## The constraint no build removes

Five acceptance tests need two to four weeks of the system running. Those clocks
start in **Phase 3** — which needs none of phases 1, 2 or 4 to begin. Every day
it waits is a day on the end.
