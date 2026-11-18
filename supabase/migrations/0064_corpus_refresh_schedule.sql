-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Collect the nine reference writers on a schedule.
--
-- Josh, 18 November 2026: "I can't see which reference-writer posts are doing well. Seven of the
-- nine writers have had no reaction counts since the 20 October load, nothing collects new posts on
-- a schedule, and get_reference_posts stops at 50 with no paging. Can you: collect all nine on a
-- schedule, keeping line breaks and counts."
--
-- Measured before building this: 2,148 stored posts across the nine handles; reaction counts on
-- mattjbarker1 (250), tim-scheuer (248) and exactly one row of curtishowland; nothing newer than
-- 19 October for seven of them. Line breaks were already kept on 2,082 of the 2,148, so that half
-- of the ask was already done and is not what this changes.
--
-- WHY NOTHING WAS SCHEDULED BEFORE
--
-- worker-ops carries the reason: "The scrape itself is still a script someone runs, deliberately:
-- it needs a key that does not live in this vault, and automating the collection of a corpus that
-- currently comes back without line breaks would be automating something half useless." A key can
-- now be put in the vault, and `_shared/corpus.ts` refuses to do the half-useless version: with
-- only the console key it adds posts it does not already hold and says in an event that it cannot
-- refresh the rest, rather than reporting a successful run that changed nothing that matters.
--
-- TWICE A WEEK, NOT WEEKLY, AND THE REASON IS THE ALARM
--
-- worker-ops raises a warn-level alert when the newest `scraped_at` is 7 days old. On a weekly
-- schedule the corpus would sit exactly at that boundary every week and the alarm would fire or not
-- depending on the order two cron jobs ran in, which is the kind of flapping that teaches a reader
-- to ignore an alert. Monday and Thursday keeps it comfortably inside.
--
-- 06:00 puts it before the 07:00 creator poll and the 08:00 ops run, so the staleness check reads a
-- corpus that has just been refreshed rather than one about to be.
--
-- Weekdays only, like the creator poll: these are business accounts and a weekend run mostly pays
-- to discover that nobody posted.

select cron.schedule(
  'corpus-refresh',
  '0 6 * * 1,4',
  $$select public.invoke_worker('worker-corpus')$$
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- A note on the 30-second budget, because this worker cannot answer inside it.
--
-- `invoke_worker` posts with `timeout_milliseconds => 30000`. A harvest of nine profiles takes
-- minutes. worker-corpus therefore answers immediately and continues under EdgeRuntime.waitUntil,
-- the same arrangement worker-engage needed — and needed because it did NOT have it: on
-- 18 November, its first run with anybody to fetch, it left a pg_net timeout and nothing else. No
-- rows, no event, no edge-log line, because the function never sent a response.
--
-- That makes the event log the only record of what a run did, so corpus.ts leaves one on every
-- path: corpus_started, then corpus_refreshed, corpus_blocked or corpus_failed. A start with no
-- finish beside it is a run that was torn down part-way.
