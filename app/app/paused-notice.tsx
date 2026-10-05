/**
 * What the desk says while it is paused.
 *
 * It states three things, because a notice that only says "unavailable" is indistinguishable from a
 * fault, and Josh has already spent an evening unable to tell those apart: that this was deliberate,
 * that nothing has been lost, and where the same work happens meanwhile.
 */
export function PausedNotice({ reason }: { reason: string }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="text-xs uppercase tracking-widest text-neutral-500">Paused on purpose</p>

      <h1 className="mt-3 text-2xl font-medium text-neutral-900 dark:text-neutral-100">
        The desk is off while we prove the foundation
      </h1>

      <p className="mt-6 leading-relaxed text-neutral-700 dark:text-neutral-300">{reason}</p>

      <div className="mt-8 rounded-lg border border-neutral-200 p-5 text-sm leading-relaxed dark:border-neutral-800">
        <p className="font-medium text-neutral-900 dark:text-neutral-100">Nothing has been deleted.</p>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Every idea, interview answer and draft is still in the database, untouched. This page is
          hidden, not emptied — it comes back on with one setting, and no deploy.
        </p>
      </div>

      <div className="mt-6 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        <p className="font-medium text-neutral-900 dark:text-neutral-100">Meanwhile</p>
        <ul className="mt-2 space-y-1.5">
          <li>Send a thought to the bot in Telegram, and answer its questions there.</li>
          <li>Drafts arrive in Telegram for you to approve, reject or ask for a rewrite.</li>
          <li>Ask for one in Claude Code: &ldquo;what&rsquo;s waiting?&rdquo; or &ldquo;rewrite the cold email one&rdquo;.</li>
        </ul>
      </div>
    </main>
  );
}
