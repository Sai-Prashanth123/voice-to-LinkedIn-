/**
 * The decisions only Josh can make.
 *
 * WHY THIS MODULE EXISTS
 *
 * Until now Claude Code could capture a thought, interview him, write a post and judge it — and could
 * not approve one. Every decision lived behind a Telegram button: approve, hold, push back, clear a
 * name, decide a library proposal, park, reopen, fix the pillar, end an interview, record a verdict.
 * Telegram is being removed in favour of Claude Code alone, so each one needs a door.
 *
 * They are in one file on purpose. The clause-by-clause audit of "what can Josh actually decide" is
 * then a single read, and the thing most likely to go wrong — a decision tool reachable on a read
 * token — is a single list to check against `WRITE_TOOLS` in auth.mjs.
 *
 * EVERY ONE OF THEM POSTS TO cc-submit
 *
 * Not one writes directly, and that is deliberate rather than incidental. `content_mcp` has select on
 * sixteen tables, insert on three, and no UPDATE or DELETE anywhere; every decision here is an update.
 * The hosted connector falls back to the service role when its scoped key is absent, so a tool writing
 * directly would appear to work today and start failing silently the day that key is minted. The model
 * call moved off the server. The write authority did not.
 *
 * WHAT THE DESCRIPTIONS ARE FOR
 *
 * A non-engineer drives these by saying "put it out Tuesday" or "Ben is fine to name". The model picks
 * the tool from its description, so each one says what it does in the words he would use, and says
 * plainly which of them are irreversible-ish. `mark_ready` in particular: it is the only authorisation
 * to publish in this system, and its description has to make that unmissable.
 */

import { z } from "zod";

/**
 * One door, so the key check and the error shape are written once.
 *
 * Context first, `process.env` second: on the hosted connector the key lives in the env object the
 * edge function builds, and reading `process.env` alone made every write from Claude Desktop and
 * claude.ai fail with "not set" while the local server worked. That bug cost a day and is the reason
 * this comment exists.
 */
async function post(url, contextKey, payload) {
  const key = contextKey ?? process.env.CONTENT_MCP_KEY;
  if (!key) throw new Error("CONTENT_MCP_KEY is not set, so nothing can be submitted.");

  const res = await fetch(`${url}/functions/v1/cc-submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body.error ?? JSON.stringify(body).slice(0, 300);
    throw new Error(`${detail}${body.next ? `\n\n${body.next}` : ""}`);
  }
  return body;
}

export const joshTools = [
  /* ── The calendar ───────────────────────────────────────────────────────── */

  {
    name: "mark_ready",
    config: {
      title: "Approve a post and give it a date",
      description:
        "THE ONLY THING THAT AUTHORISES A POST TO GO OUT. Nothing in this system publishes to " +
        "LinkedIn except a post Josh has marked ready with a date, and the database refuses any " +
        "other route. Use it when he says to put one out: \"publish it Tuesday\", \"that one's " +
        "good, send it tomorrow\". Read him the post first — it goes out on that date without " +
        "asking again. It refuses a draft the eight checks rejected, and refuses a post already " +
        "approved; hold that one first if the date needs changing.",
      inputSchema: {
        post_id: z.number().int().describe("From list_calendar"),
        when: z.string().describe(
          'When to publish: "tomorrow", "next monday", "in 3 days", or a date like 2026-10-14. ' +
            "It goes out at 9am local on that day.",
        ),
      },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "mark_ready", ...args }),
  },

  {
    name: "hold_post",
    config: {
      title: "Put an approved post back to draft",
      description:
        "Takes a post off the calendar and clears its date, so it will not publish. Use it when he " +
        "changes his mind, or before editing something already approved. If he says why he is " +
        "holding it, pass that as the reason — a rejection in his own words is the most useful " +
        "thing the learning loop ever gets, and it is the thing that never got collected.",
      inputSchema: {
        post_id: z.number().int(),
        reason: z.string().optional().describe("His words on what was wrong with it, if he said"),
      },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "hold", ...args }),
  },

  {
    name: "edit_post",
    config: {
      title: "Save his edit to a post",
      description:
        "Replaces the text of a post with his version. Use it when he reads a draft and changes a " +
        "line, or dictates a replacement. The difference between what the system wrote and what he " +
        "approved is the measurement the whole engagement is judged on (five of the last six " +
        "needing only light edits), so an edit saved here is an edit counted. Refuses a post that " +
        "is already approved — hold it first, so 'approved' keeps meaning 'approved this text'.",
      inputSchema: {
        post_id: z.number().int(),
        body: z.string().min(1).describe("The post as he wants it to read, in full"),
      },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "edit_post", ...args }),
  },

  /* ── Drafts ─────────────────────────────────────────────────────────────── */

  {
    name: "push_back_on_draft",
    config: {
      title: "Ask for a rewrite, with his note",
      description:
        "Sends a draft back to be written again, carrying what he said was wrong with it. Use it " +
        "whenever he reacts to a draft with anything other than approval: \"the opening is flat\", " +
        "\"too long\", \"that is not what happened\". Pass his words, not a summary of them — they " +
        "go to the top of the rewrite brief and are the first thing the next attempt is told. A " +
        "push-back does not count as one of the three failed attempts that park an idea.",
      inputSchema: {
        draft_id: z.number().int().optional().describe("Either this or moment_id"),
        moment_id: z.number().int().optional().describe("The idea; its newest draft is used"),
        note: z.string().min(1).describe("What he said is wrong, in his words"),
      },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "pushback", ...args }),
  },

  /* ── Names ──────────────────────────────────────────────────────────────── */

  {
    name: "clear_names",
    config: {
      title: "Say whether a name may be used in a post",
      description:
        "Records his decision on naming someone. A draft CANNOT be written while a name in its " +
        "material is uncleared — the drafter refuses it — so this is the thing to call when a " +
        "draft is blocked on a name, or when he says \"yes, you can name them\" / \"no, keep that " +
        "one out\". The permission is for this post only: reopening the idea asks again. Pass his " +
        "exact words as the note when he qualifies it (\"fine to name him, not the company\").",
      inputSchema: {
        moment_id: z.number().int(),
        names: z.array(z.string()).optional().describe("The names as they appear in the material"),
        all: z.boolean().optional().describe("Every name on this idea at once"),
        cleared: z.boolean().optional().describe("Default true. False records a refusal."),
        note: z.string().optional().describe("What he actually said, where it was qualified"),
      },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "clear_names", ...args }),
  },

  /* ── The idea bank ──────────────────────────────────────────────────────── */

  {
    name: "park_idea",
    config: {
      title: "Park an idea for now",
      description:
        "Sets an idea aside without deciding against it, with a reason that says what is missing. " +
        "Use it for \"not yet\", \"there is not enough here\", \"come back to this\". It stays in " +
        "the bank and reopen_idea brings it back with a question.",
      inputSchema: {
        moment_id: z.number().int(),
        reason: z.string().optional().describe("What is missing, or why not now"),
      },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "park", ...args }),
  },

  {
    name: "kill_idea",
    config: {
      title: "Mark an idea as one he does not want",
      description:
        "For \"no, not that one\" — a judgement rather than a delay. Nothing is deleted: the idea, " +
        "his answers and any drafts stay on the record, and it is simply excluded from everything " +
        "that chooses and learns. A reason is required, because that exclusion is invisible later " +
        "and an unexplained kill cannot be read six months on. Park it instead if he only means " +
        "'not now'.",
      inputSchema: {
        moment_id: z.number().int(),
        reason: z.string().min(1).describe("Why this one is not wanted"),
      },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "kill", ...args }),
  },

  {
    name: "reopen_idea",
    config: {
      title: "Bring a parked idea back",
      description:
        "Reopens a parked idea and asks the next question, so the interview carries on where it " +
        "stopped. Use it when he comes back to one: \"I remembered more about that clinician " +
        "thing\". Its question and answer budgets reset from here rather than arriving already " +
        "spent, and any name permissions have to be given again.",
      inputSchema: { moment_id: z.number().int() },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "reopen", ...args }),
  },

  {
    name: "set_pillar",
    config: {
      title: "Correct which pillar an idea belongs to",
      description:
        "Changes the pillar the interview chose. The system says which one it picked precisely so " +
        "he can correct it, and the pillar is part of how one idea is weighed against another when " +
        "something is chosen to write next. get_library lists the pillars in his own words.",
      inputSchema: {
        moment_id: z.number().int(),
        pillar: z.string().min(1),
      },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "pillar", ...args }),
  },

  /* ── The interview ──────────────────────────────────────────────────────── */

  {
    name: "skip_question",
    config: {
      title: "Skip the question he does not want to answer",
      description:
        "Moves past one question and asks a different one, without ending the interview. Use it for " +
        "\"next one\", \"I do not remember that\", \"ask me something else\".",
      inputSchema: { moment_id: z.number().int() },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "skip_question", ...args }),
  },

  {
    name: "end_interview",
    config: {
      title: "Stop asking and write it up",
      description:
        "Closes an interview early and turns what he has already said into material. Use it for " +
        "\"that is enough\", \"just write it\". Stopping early is a legitimate end rather than an " +
        "abandonment — a scene without a tidy lesson is a real outcome — and this exists because " +
        "interviews once sat open for a month with no way out but silence.",
      inputSchema: { moment_id: z.number().int() },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "end_interview", ...args }),
  },

  /* ── The library ────────────────────────────────────────────────────────── */

  {
    name: "decide_proposal",
    config: {
      title: "Approve or reject a proposed library change",
      description:
        "His decision on a change the system has proposed, with its evidence. Approving applies it " +
        "to the reference library and the very next draft is written against it, with no deploy. " +
        "Read him the proposal and its evidence first — list_proposals shows what is waiting, and " +
        "the system is structurally unable to apply one of these by itself. Rejecting records his " +
        "reason so the same evidence is not proposed again.",
      inputSchema: {
        proposal_id: z.number().int(),
        approve: z.boolean(),
        reason: z.string().optional().describe("Why, especially on a rejection"),
      },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "proposal", ...args }),
  },

  {
    name: "add_library_rule",
    config: {
      title: "Add one rule to the reference library",
      description:
        "Appends a line to a library section — a banned phrase, a hook rule, something about how he " +
        "closes. Use it the moment he says one: \"never open with a question\", \"stop using the " +
        "word leverage\". It is appended, never replacing what is there, and it reaches the next " +
        "draft immediately. Sections holding the two rules that are never tunable will refuse it, " +
        "and say so. get_library lists the section keys.",
      inputSchema: {
        section_key: z.string().describe("From get_library, e.g. hooks, closes, banned_phrases"),
        text: z.string().min(1).describe("The rule, in his words"),
      },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "library_rule", ...args }),
  },

  {
    name: "append_voice_transcript",
    config: {
      title: "Add to the recording of him talking",
      description:
        "Appends a transcript of Josh talking to the voice interview — the source of truth for how " +
        "he sounds, and the thing the voice guide is derived from. Use it when he pastes a " +
        "transcript, or dictates at length about anything he would argue for. It appends across " +
        "many sittings rather than replacing, and if the voice guide and this ever disagree, this " +
        "wins. It is the single highest-value thing he can give the system.",
      inputSchema: {
        text: z.string().min(1).describe("The transcript, his words, not tidied"),
        source: z.string().optional().describe('Where it came from, e.g. "podcast 12 Oct"'),
      },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "voice_transcript", ...args }),
  },

  /* ── What came back ─────────────────────────────────────────────────────── */

  {
    name: "record_post_verdict",
    config: {
      title: "Record his judgement on a post that went out",
      description:
        "One line from him about a published post — what worked, what he would change, what it " +
        "actually produced. Worth more to the library than any engagement number, because the " +
        "numbers cannot say why. get_outcomes shows which posts have no verdict yet.",
      inputSchema: {
        post_id: z.number().int(),
        verdict: z.string().min(1).describe("His words. One line is plenty."),
        draft_id: z.number().int().optional(),
      },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "verdict", ...args }),
  },

  {
    name: "record_conversation",
    config: {
      title: "Record whether a post started a conversation",
      description:
        "Whether a published post led to anything: a comment thread, a DM, a call, a client. This " +
        "is the outcome the system is actually pointed at — not likes. 'none' is a real and useful " +
        "answer, so record it rather than skipping the ones that did nothing.",
      inputSchema: {
        post_id: z.number().int(),
        answer: z.enum(["none", "comment_thread", "dm", "call", "client"]),
      },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "conversation", ...args }),
  },

  /* ── Running the machinery, from a session ──────────────────────────────── */

  {
    name: "run_worker",
    config: {
      title: "Run one of the scheduled jobs now",
      description:
        "The scheduled jobs normally run on their own — selection every four hours, learning on " +
        "Mondays, the health check daily. Use this when Josh does not want to wait: \"why has " +
        "nothing been chosen\", \"check if anything is broken\", \"look for library changes now\". " +
        "Publishing is deliberately NOT on the list: a post goes out on the date he set, never " +
        "because something asked for it now.",
      inputSchema: {
        worker: z.enum(["select", "learn", "ops", "triage"]).describe(
          "select = choose what to write next · learn = look for library changes · " +
            "ops = the health check · triage = read waiting candidates",
        ),
      },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "run_worker", ...args }),
  },

  {
    name: "refresh_sentinels",
    config: {
      title: "Re-measure the reference writers",
      description:
        "Re-measures the eight reference writers from the posts already stored and records what " +
        "moved as a proposal for Josh to approve. Use it after a fresh scrape, or when he asks " +
        "whether their habits have changed. It never changes the library by itself — that is " +
        "deliberate, and decide_proposal is how a change lands. Most runs correctly find nothing " +
        "worth proposing.",
      inputSchema: {},
    },
    handler: (args, { url, key }) => post(url, key, { kind: "refresh_sentinels", ...args }),
  },

  {
    name: "export_bank",
    config: {
      title: "Export everything in the idea bank",
      description:
        "Every idea, interview answer, draft, verdict and library section as one JSON object. This " +
        "is the no-lock-in guarantee: the work is his, with nothing held hostage. Use it when he " +
        "asks for his data, wants a backup, or is handing the system to someone else. Credentials " +
        "are left out on purpose and it says which tables were skipped and why.",
      inputSchema: {},
    },
    handler: (args, { url, key }) => post(url, key, { kind: "export_bank", ...args }),
  },

  {
    name: "mark_notices_read",
    config: {
      title: "Mark notices as seen",
      description:
        "Clears notices from the waiting list once he has actually been told them. Call it after " +
        "reading them out, or the same things are offered every time he opens a session.",
      inputSchema: { ids: z.array(z.number().int()).min(1) },
    },
    handler: (args, { url, key }) => post(url, key, { kind: "notices_read", ...args }),
  },
];

/** Every name in this module, for the scope list in auth.mjs. Derived, so it cannot drift. */
export const joshToolNames = joshTools.map((t) => t.name);
