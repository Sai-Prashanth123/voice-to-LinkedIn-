# To-do

Plain task list. Detail for each is in `06-roadmap.md`.
Tick when done **and** verified against the live system.

## Phase 1 — MCP connector
- [x] 1.1 Create the `mcp-server/` package
- [ ] 1.2 Add the read tools (moments, library, drafts, scoreboard)
- [ ] 1.3 Add the write tools (create draft, record verdict, propose change)
- [ ] 1.4 Add a scoped database role — no delete rights
- [ ] 1.5 Register the server in `.mcp.json`
- [ ] 1.6 Test every tool once against live data

## Phase 2 — Writing skills
- [ ] 2.1 Write the drafting skill
- [ ] 2.2 Write the gate skill (reads the existing eight checks)
- [ ] 2.3 Build the pull loop in `cc-agent/work.mjs`
- [ ] 2.4 Add it to the installer's schedule
- [ ] 2.5 Mark Claude Code drafts in the database
- [ ] 2.6 Run one moment end to end: idea → draft → eight checks
- [ ] 2.7 Read the rejections and tweak the skills

## Phase 3 — Josh (start now, runs alongside)
- [ ] 3.1 Record the voice guide — ~400 words
- [ ] 3.2 Fill the six remaining library sections
- [ ] 3.3 Answer the five open questions
- [ ] 3.4 Connect LinkedIn
- [ ] 3.5 Send 19 more voice notes, run 2 more sessions
- [ ] 3.6 Pick a call recorder
- [ ] 3.7 Run the installer once

## Phase 4 — Testing
- [ ] 4.1 Build the soak script
- [ ] 4.2 Push 10+ drafts through the gate
- [ ] 4.3 Read every rejection
- [ ] 4.4 Run the image rebuild for the first time
- [ ] 4.5 Re-run the scoreboard
- [ ] 4.6 Fix whatever the soak exposes

## Phase 5 — First sharing
- [ ] 5.1 Rotate every development key
- [ ] 5.2 Move Supabase into Josh's account
- [ ] 5.3 Move Vercel into Josh's account
- [ ] 5.4 Record the walkthrough
- [ ] 5.5 Send the first real batch of drafts
- [ ] 5.6 Regenerate the build report

## Phase 6 — Feedback
- [ ] 6.1 Apply his feedback to the library
- [ ] 6.2 Review the system's own proposals
- [ ] 6.3 Tweak skills only where the library cannot carry it
- [ ] 6.4 Final scoreboard run

---

**Do first:** 3.1 and 3.7 — they start clocks nothing else can shorten.
**Do next:** 1.1 — every task in Phase 2 needs it.
