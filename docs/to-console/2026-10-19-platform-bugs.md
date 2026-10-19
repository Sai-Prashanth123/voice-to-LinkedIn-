# Six bugs in the scraping console, found 14–19 October 2026

**For the console team. Not sent.** Every one of these was hit while using the platform through its
MCP surface on real client work (Nikola's 19 October post, 42 replies). Each entry gives the symptom,
the evidence, and what it blocked — not a guess at the fix, except where the error names the cause
itself.

Ordered by what they cost us, not by how hard they look.

---

## 1. `list_reply_drafts` is unusable through MCP — the handler's defaults are never resolved

Every call fails, with arguments or without:

```
internal error running 'list_reply_drafts':
asyncpg.exceptions.DataError: invalid input for query argument $1:
Query(None) (expected str, got Query)

WHERE reply_drafts.stream = $1::VARCHAR AND reply_drafts.client_username ILIKE $2::VARCHAR
parameters: (Query(None), Query(None), 25)
```

Both string parameters arrive as **`Query(None)` — the FastAPI default object itself**, bound
straight into SQLAlchemy. Passing `client_username` and `stream` explicitly changes nothing: the
same two `Query(None)` values appear in the parameters. So the MCP layer is invoking the HTTP route
handler directly, without FastAPI's dependency resolution, and no caller-side input can reach the
query.

**What it blocks.** `reply_drafts` is the only record of what the platform's own reply agent
produced. With this tool down there is no way to tell whether the agent and a human drafted the same
reply to the same tweet. On 19 October five replies went live on Nikola's post between 07:09 and
07:23 and **two were word-for-word identical to drafts we had written by hand**. We still cannot
tell whether that is the agent duplicating our work or the team shipping ours. Until this is fixed,
two drafters are writing into the same inbox blind to each other, and a double-post is a matter of
timing.

**Worth checking for the same pattern elsewhere.** If one route is wired this way, others on the
same code path probably are too.

## 2. `reply_brief(from_pending)` returns a frozen window

Repeated calls return the same oldest ~50 pending items. Nothing newer is reachable, and there is no
cursor, offset or "exclude these ids" input to step past them. Once the oldest 50 are not worth
replying to, the tool has nothing left to give and says so by returning them again.

**What it blocks.** Working the actual queue. We fell back to `tweet-detail` and
`search(to:<handle>)` and reconciled by hand.

## 3. The claim checker flags every number when `source_text` is absent

`save_reply_draft` without `source_text` flags each figure in the draft as an invented claim. It is
not detecting anything — with no source to compare against it flags unconditionally.

**Evidence.** 11 replies came back with "invented number" flags. Re-saving one of them —
MichLieben's, byte-identical text — **with the source post attached cleared every flag**. The three
that survived were a different check: genuine repeat flags, four writers having independently made
the same "20 days between milestones" point. That is the checker working correctly, which is how we
know the other 11 were the missing-source path.

**Suggested fix.** Default `source_text` to the stored text of the draft's source tweet, which the
row already holds. Failing that, return "not checked — no source" rather than a flag. A checker that
accuses by default trains people to ignore it, and the three real flags were nearly lost in the
eleven false ones.

## 4. The scraper does not store `in_reply_to_status_id` or `conversation_id`

Both are on the X payload and neither is persisted, so a thread cannot be reconstructed from the
store. Replies-to-replies are indistinguishable from top-level replies.

**What it cost.** Reconciling one post's comments took a `to:<handle>` search plus manual
arithmetic: 36 top-level replies + 1 the thread view dropped entirely (`Mohiniuni`, only found by
search) + 5 of Nikola's own nested replies = the 42 the UI reported. 12 further replies attributed
to that post actually belonged to a different one. All of this is two stored columns away from being
a `GROUP BY`.

## 5. The LinkedIn parser strips blank lines; the X parser does not

LinkedIn posts come back with paragraph breaks collapsed. X posts **in the same store** keep their
`\n\n`. So this is the LinkedIn parse path specifically, not a global normaliser — which is the
useful half of the finding, because it narrows where to look.

**What it cost.** 105 of 156 stored reference posts have no line breaks. Any structural measurement
over them has to infer from surviving markers: our list detector scores recall 20/21 and precision
20/24 against the 51 posts that kept their breaks. Every structural number we report about LinkedIn
content carries that caveat, permanently, for posts already stored.

## 6. Bright Data: `407 CONNECT tunnel failed` on the LinkedIn path

A fresh LinkedIn **profile** scrape now fails in about 5 seconds with `407 CONNECT tunnel failed`.
Previously only `entity_type: post` returned 407; the profile path worked. The X side is healthy
throughout, which points at the Bright Data account or proxy zone rather than at the actor code.

**What it blocks.** All LinkedIn collection. There is no partial path left.

---

## What we are not asking for

Nothing here needs a feature. 1 and 3 are small and have the largest effect; 4 is two columns; 6 is
probably a billing or zone setting rather than code. 5 cannot be retrofitted onto posts already
stored, so the fix only helps future scrapes — worth saying out loud so nobody expects the existing
156 to heal.

## One request that is not a bug

A way to tell, from a reply draft, whether a human or the agent wrote it. Right now even with tool 1
fixed we would be inferring it from timestamps.
