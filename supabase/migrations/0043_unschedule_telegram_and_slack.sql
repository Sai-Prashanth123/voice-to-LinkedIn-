-- The two scheduled jobs whose whole purpose was to send a Telegram message.
--
-- `weekly-sweep` asked Josh five questions in a chat every Monday and wrote the answers down as
-- ideas. It was the system's only mechanism for refilling the bank, and it is not being abandoned:
-- the same five questions are his own words from the question bank, and a session asks them. What
-- goes is the Monday push, because there is no longer anywhere to push to.
--
-- `slack-sweep` read conversations he never switched on. Clause 4.5 makes Slack optional and off by
-- default, and `slack_enabled` has shipped false throughout.
--
-- Everything else stays scheduled. `queue-tick`, `select-tick`, `publish-due`, `metrics-7d`,
-- `ops-daily`, `ops-monthly`, `learn-weekly` and `triage-sweep` all still have work to do, and
-- `publish-due` is the mechanism clause 11.2 depends on — it is the one job that must fire on a
-- calendar date with nobody present.
--
-- WHY EACH ONE IS WRAPPED
--
-- `cron.unschedule` raises if the job is not there, and this migration has to run from nothing: the
-- CI job rebuilds the schema on an empty database to prove clause 14.3's continuity test, and on
-- that database neither job was ever scheduled. An unschedule that fails there would fail the proof
-- that the system can be stood up from the repo alone.

do $$
begin
  perform cron.unschedule('weekly-sweep');
exception when others then
  raise notice 'weekly-sweep was not scheduled';
end $$;

do $$
begin
  perform cron.unschedule('slack-sweep');
exception when others then
  raise notice 'slack-sweep was not scheduled';
end $$;

-- The settings rows stay. `slack_enabled` and `weekly_sweep_enabled` are read by nothing now, and
-- deleting them would be the one kind of cleanup this build does not do: a row that records a
-- decision Josh made is kept, even when the code that read it has gone.
