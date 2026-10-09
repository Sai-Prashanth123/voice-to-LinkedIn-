# What to send Josh, and in what order

Checked against the live project on 9 October 2026. There is one thing to fix first, and it is the
difference between handing him a door and handing him the building.

---

## Fix this before you send anything

**The key in `mcp-server/.env` is the service role key.** Not a scoped one — the same value as
`SUPABASE_SERVICE_ROLE_KEY`, verified by fingerprint. It bypasses row-level security completely and
can do anything to the project, including delete things the scoped role is structurally unable to
touch.

`mcp-server/.env.example` already warns about exactly this: *"NOT the service-role key: that bypasses
row-level security entirely, and the point of this server is to hand the model a door rather than the
building."* The warning is right and the local file ignores it.

The cause: the `content_mcp` role exists with all its grants (16 tables readable, 3 insertable, zero
update, zero delete) but has never had a key minted — `rolcanlogin` is false — so everything has been
falling back to the service role since September.

```bash
# A personal access token from https://supabase.com/dashboard/account/tokens.
# Used for this one call and stored nowhere.
SUPABASE_ACCESS_TOKEN=sbp_... node mcp-server/mint-key.mjs --write
```

**Until that runs, do not send him the contents of `mcp-server/.env`.**

---

## Option A — what you can send today, with no minting

The hosted connector already works and needs nothing installed. Good for day one, and good for his
phone permanently.

**Send him:**

1. **Repo access.** The repo is private (`Sai-Prashanth123/voice-to-LinkedIn-`). Either add him as a
   collaborator, or — better, and what the contract actually says about accounts being in his name —
   create the repo under his own account and push there.
2. **The connector URL and token**, in a separate message from the repo link:
   - URL: `https://uzqvebxcxgmseqjhfpku.supabase.co/functions/v1/mcp`
   - Token: the `MCP_WRITE_TOKEN` value from `mcp-server/.http-tokens`
3. **The note:** `docs/to-josh/2026-10-09-what-changed-and-how-to-connect.md`

**He gets:** all 55 tools, from Claude Code, the desktop app or claude.ai. Enough to capture a
thought, run an interview, read his drafts, approve a post, read Matt Barker.

**He does not get:** the three writing skills, the slash commands, or the scripts. Those live in the
repo, so drafting quality is noticeably better once he is on Option B.

---

## Option B — the full thing, after the key is minted

Everything in Option A, plus the repo doing the work locally.

**Send him:** the repo, and `SUPABASE_URL` plus the **newly minted** `CONTENT_MCP_KEY` — never the
service role key.

**He runs:**

```bash
git clone <repo> josh-content-system
cd josh-content-system/mcp-server && npm install && cd ..
cp mcp-server/.env.example mcp-server/.env     # then paste the two values
node mcp-server/index.mjs --check              # expect: ok
claude
```

Then `hello`.

`README.md` covers this, the desktop app, and Codex or Cursor, with a table of what each surface
loses.

---

## The message to paste

> Josh — the system is rebuilt around one surface. No Telegram, no web app; everything happens in
> Claude now.
>
> Your list was right on every count and I have written up each one, what was actually wrong, and
> what is now there — including the two things that are worse, because one of them is a change to
> what we agreed. It is the first file in the repo: `docs/to-josh/2026-10-09-what-changed-and-how-to-connect.md`
>
> The short version:
>
> - **Matt Barker works.** You can read his posts in a session now, and his frameworks are in force
>   as of today — four things the system takes from him, and two it deliberately will not, with the
>   reasons. 138 posts across all eight writers are stored.
> - **Both your stuck drafts are through the checks** and waiting for you.
> - **The gate no longer fails drafts for things that are not in them.** Your cold-email post is a
>   permanent test now.
> - **The app is gone.** It had stopped being able to write anything, and it had lost its login — it
>   was serving your whole idea bank to anyone with the URL. Deleting it fixed that.
> - **Nothing can message you any more.** A failed publish, a parked idea, a low queue — all of it
>   waits for your next session, and `/waiting` reads it out. If that is the wrong trade, say so:
>   email alerts on your own account are about an hour's work.
> - **Capture from your phone went with Telegram**, which is a change to clause 4.1 of the spec. I am
>   not glossing over it. If it matters, an inbound email address is the clean replacement and I will
>   cost it.
>
> Setup is in `README.md` — five steps, and it covers Codex and Cursor too if you would rather use
> those.
>
> Two drafts are in front of you. Your test was three in a row you would post with only light edits,
> so when you mark them up, send me the marked-up version rather than a yes or no — your edits are
> recorded now, and a word you cut three times becomes a rule.
>
> The one thing that would help most: fifteen minutes of you making a case for something, recorded,
> unprompted. The voice guide is built from six calls where your job was asking questions, so it
> knows how you ask and not how you argue — and the hook and the close are exactly what a
> conversation cannot show. Paste a transcript into a session and say "add this to the voice
> interview".

---

## Do not send

| | Why |
|---|---|
| `mcp-server/.env` | It currently holds the service role key |
| `eval/.env` | Service role key |
| `mcp-server/.http-tokens` | Send the one token in a message; not the file, which holds both |
| Anything from `data/josh/sentinels/scrape-*.json` | 138 posts of other writers' text. Fine in the repo, pointless in an email |

Send the repo link and the credentials in **separate** messages. The repo is private, so a link
without access is harmless; a token next to it is not.

---

## Then, when he confirms he is connected

`docs/closeout.md` — take the Telegram bot down in the order written there, revoke the token at
BotFather, undeploy the three functions still live, and rotate the connector tokens. Not before he
confirms: the gap between his old way stopping and his new way starting should be zero.
