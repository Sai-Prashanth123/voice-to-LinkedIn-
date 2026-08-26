-- 0013 — SLACK ON A SCHEDULE
--
-- Twice a day, not continuously. Slack is the lowest-signal input in the system and the one whose
-- material belongs to other people, so it is read deliberately rather than watched.
--
-- The job runs whatever the setting says; `worker-slack` checks `settings.slack_enabled` first and
-- returns immediately when it is off (4.5.2, and it ships off). Scheduling it unconditionally means
-- Josh can turn Slack on by flipping one setting, with no deploy — which is the whole point of
-- clause 16's "nothing Josh cannot maintain at a basic level".

select cron.schedule(
  'slack-sweep',
  '0 9,17 * * 1-5',
  $$select public.invoke_worker('worker-slack')$$
);
