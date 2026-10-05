import { supabaseServer } from "@/lib/supabase";

/**
 * Whether the desk is paused, and why.
 *
 * WHY A SETTING AND NOT A DEPLOY
 *
 * On 5 October Josh asked to strip the build back to its foundation and add the custom pieces back one
 * at a time, naming the idea bank as one of the things to re-add later. The obvious way to pause two
 * pages is to edit them, and the obvious way to bring them back is another deploy — which makes "we
 * turned it off" indistinguishable from "we lost it", and puts a client's access behind our release
 * cycle.
 *
 * So it is a row. `desk_paused` true hides the two pages behind a notice; false and they are back, in
 * the time it takes to run one statement. Nothing about the data changes either way, and the desk has
 * been read-only since September, so there is nothing to lose by looking later.
 *
 * The reason is a row too, because a notice that does not say why reads as a fault.
 */
export interface DeskPause {
  paused: boolean;
  reason: string;
}

const DEFAULT_REASON =
  "Paused while we prove the foundation — capture, interview, drafting and the eight checks — in " +
  "Josh's voice. The ideas and drafts are all still here, and this comes back on when he asks.";

export async function deskPause(): Promise<DeskPause> {
  const db = await supabaseServer();

  // The desk reads Postgres AS THE SIGNED-IN USER and holds no administrative key, so this needs
  // `settings` to be readable under RLS. If it is not, the page must show rather than hide: a desk
  // that goes dark because a select failed is worse than one that is a week out of date.
  const { data, error } = await db
    .from("settings")
    .select("key, value")
    .in("key", ["desk_paused", "desk_paused_reason"]);

  if (error || !data) return { paused: false, reason: DEFAULT_REASON };

  const value = (key: string) => data.find((r) => r.key === key)?.value;
  const raw = value("desk_paused");
  const reason = value("desk_paused_reason");

  return {
    // jsonb true, or the string "true" if someone sets it by hand.
    paused: raw === true || raw === "true",
    reason: typeof reason === "string" && reason.trim() ? reason : DEFAULT_REASON,
  };
}
