# Ownership

For Josh Fryszer, from Thought Pilot. This is clause 14.2 written down, because it was the one clause
in section 14 with no artifact behind it.

> **14.2** — *All code, prompts, configuration and documentation produced under this engagement must
> become Josh's property on payment, with no ongoing licence required from Thought Pilot to keep
> running it.*

## What transfers

Everything in this repository, on payment:

- The edge functions and the shared library (`supabase/functions/`)
- Every migration, constraint, trigger and policy (`supabase/migrations/`)
- **The prompts** (`supabase/functions/_shared/prompts.ts`) and the reference library seeded in
  migration 0004 — these are named explicitly because they are the part most easily treated as a
  vendor's method rather than a deliverable, and 14.2 does not carve them out
- The web app (`app/`)
- The scheduled uploader (`cc-agent/`)
- The MCP server that exposes the system to Claude Code (`mcp-server/`)
- The documentation, the evaluation harnesses and the tests (`docs/`, `eval/`)

Thought Pilot retains no licence, no royalty, and no right to be told how it is used or changed.

## No ongoing licence is required, and that is checkable

14.2 is a claim about dependencies as much as about intent. Every third-party component is
permissively licensed and none of them is Thought Pilot's:

| Component | Licence |
|---|---|
| `next` | MIT |
| `react`, `react-dom` | MIT |
| `@supabase/supabase-js`, `@supabase/ssr` | MIT |
| `typescript`, `@types/*` | Apache-2.0 / MIT |
| `@modelcontextprotocol/sdk` | MIT |
| `@resvg/resvg-wasm` (SVG rasterising, clause 10) | MPL-2.0 |
| Deno standard library, via `npm:` and `jsr:` specifiers | MIT |

No proprietary SDK, no vendored library, no build service, no component that phones home. The system
is a Postgres database, ten Deno functions and a Next app.

## 14.3 — running without us

The design has no Thought Pilot dependency. **The accounts currently do**, and that is a fact rather
than an intention: everything runs today in a Supabase organisation belonging to Thought Pilot,
because 14.1 has not happened yet.

Until the accounts move, 14.3 is not met. The migration is documented in `docs/04-handover.md` and
has been rehearsed rather than merely described, so that when it happens it is a checklist and not a
research project.

Two Thought Pilot references exist in the code and are removed as part of that move:

- `supabase/config.toml` — the project ref
- `cc-agent/install.mjs` — the scheduler entry is named `com.thoughtpilot.cc-agent`. Cosmetic, not a
  dependency, but not a string that belongs on your machine after handover.

## What Thought Pilot keeps

Nothing that this system needs. General knowledge and technique, in the ordinary way that anyone who
has built something keeps knowing how to build it — not the prompts, not the schema, not the
approach as applied here.

## Confidentiality after handover (15.4, 15.6)

15.6 scopes access to the period Thought Pilot is maintaining the system. When that ends, access ends:
the Supabase members list, the MCP connection described in `docs/03-runbook.md`, and any local copy
of an export. The confidentiality obligation in 15.4 does not end with the access — transcripts,
session logs, Slack content, idea bank contents and drafts, including material belonging to your
clients, stay confidential afterwards.
