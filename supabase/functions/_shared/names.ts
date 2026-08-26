/**
 * Clause 9c — who may be named in a post, and when.
 *
 *   9.10 "No client name, individual or company, may appear in a post without Josh's express
 *         permission FOR THAT POST."
 *   9.12 "Where a moment does not work without naming someone, the system must ask Josh."
 *
 * Two rules that were each half-right, in one place so they cannot drift apart again.
 *
 * WHAT COUNTS AS A NAME
 *
 * The extraction prompt says, in as many words: "Record PROPER NAMES only. Do NOT record job titles
 * or generic roles: 'the CFO', 'a client'." It recorded "CFO" twice anyway, and "Josh" — leaving the
 * system poised to ask Josh for permission to name Josh. Three of the eight names on file were not
 * names.
 *
 * A rule the prompt already states and the model already ignored does not improve by being restated
 * more loudly, and the next model will ignore it differently. So it is enforced here instead, where
 * it cannot drift. The prompt keeps its instruction — a model that complies produces less work for
 * this filter — but nothing depends on it complying.
 *
 * WHEN CLEARANCE EXPIRES
 *
 * `moment_names.cleared` was a permanent boolean: granted once, it covered every draft and every
 * post that moment ever produced. Dan was cleared on M-000008 and that one permission covered three
 * posts and eight drafts.
 *
 * 9.10 says "for that post". 6.4 makes moments re-openable, so a name cleared in August for a post
 * about a good outcome would carry into a post written from the same moment in November about a
 * difficult one. Re-opening is precisely the point at which a moment becomes a different post, so
 * clearance granted before the last re-open no longer counts. Rewrites inside one attempt chain keep
 * it — being asked three times about one post is the nagging that makes the question stop working.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Roles, not people. Anonymising is the entire point of writing "the CFO", so asking permission to
 * use it is asking permission to anonymise.
 */
const ROLE_WORDS = new Set([
  "cfo", "ceo", "cto", "coo", "cmo", "cro", "vp", "svp", "evp", "founder", "cofounder",
  "co-founder", "director", "manager", "head", "lead", "president", "chair", "chairman",
  "partner", "owner", "principal", "consultant", "contractor", "advisor", "adviser",
  "client", "customer", "buyer", "prospect", "champion", "stakeholder", "user", "candidate",
  "colleague", "team", "company", "business", "organisation", "organization", "firm", "agency",
  "board", "investor", "vc", "engineer", "developer", "designer", "marketer", "salesperson",
  "recruiter", "someone", "somebody", "everyone", "anyone", "nobody", "people", "person",
]);

/** Words that carry no identity on their own and usually precede one that does. */
const LEADING_NOISE = new Set(["the", "a", "an", "my", "our", "their", "his", "her", "one"]);

/**
 * Is this a name that could actually identify someone?
 *
 * Deliberately strict about what it REJECTS and permissive about what it keeps. A real name wrongly
 * dropped means a post could name someone without asking, which is the failure 9.10 exists to
 * prevent; a role wrongly kept costs one tap. So anything genuinely ambiguous is kept.
 *
 * @param selfNames names belonging to Josh himself, which never need his own permission.
 */
export function isRealName(name: string, selfNames: string[] = ["josh"]): boolean {
  const raw = (name ?? "").trim();
  if (raw.length < 2) return false;

  // Strip a leading article or possessive: "the CFO" and "CFO" are the same non-name.
  const words = raw.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).filter(Boolean);
  while (words.length > 1 && LEADING_NOISE.has(words[0])) words.shift();
  if (words.length === 0) return false;

  const stripped = words.join(" ");

  // Asking Josh whether he may name Josh is the clearest possible way to teach him that the
  // clearance question is noise.
  if (selfNames.some((s) => stripped === s.toLowerCase())) return false;

  // A single role word, with or without its article.
  if (words.length === 1 && ROLE_WORDS.has(words[0])) return false;

  // "our team", "my client" — every word is noise or a role, so the phrase identifies nobody.
  //
  // Except when it is capitalised. "The Partner Agency" is three role words and obviously a company;
  // "our team" is two and obviously not. Case is the only evidence available that separates them,
  // and it is good evidence: prose writes roles in lower case and names in title case.
  //
  // Erring towards KEEPING here is deliberate and asymmetric. A role kept costs Josh one tap; a real
  // name dropped means someone gets named in a post without anyone asking them — which is the whole
  // of what 9.10 exists to prevent.
  const original = raw.replace(/^(the|a|an|my|our|their|his|her)\s+/i, "");
  const capitalisedWords = original.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).length;
  if (capitalisedWords >= 2) return true;

  if (words.every((w) => ROLE_WORDS.has(w) || LEADING_NOISE.has(w))) return false;

  return true;
}

/**
 * The names cleared for what is being written NOW.
 *
 * The single reader for the drafter, the gate and the bank page, so the three cannot disagree about
 * who may be named — which would be the worst kind of disagreement, since the drafter would write a
 * name the gate then rejects, three times, and park a good moment.
 */
export async function clearedNames(db: SupabaseClient, momentId: number): Promise<string[]> {
  const { data: moment } = await db
    .from("moments").select("reopened_at").eq("id", momentId).maybeSingle();

  const { data: names } = await db
    .from("moment_names")
    .select("name, cleared, cleared_at")
    .eq("moment_id", momentId)
    .eq("cleared", true)
    // Roles recorded before the filter existed. Kept in the bank (6.3), never a clearance question.
    .neq("kind", "not_a_name");

  const reopened = moment?.reopened_at ? new Date(moment.reopened_at as string).getTime() : null;

  return (names ?? [])
    .filter((n) => {
      if (!reopened) return true;
      // 9.10 — permission given before this became a different post does not carry into it.
      if (!n.cleared_at) return false;
      return new Date(n.cleared_at as string).getTime() >= reopened;
    })
    .map((n) => n.name as string);
}

/**
 * The names still needing a decision for what is being written now.
 *
 * Not simply `cleared = false`: a name cleared before the last re-open is back to needing one, and
 * the question must be asked again rather than assumed.
 */
export async function unclearedNames(
  db: SupabaseClient,
  momentId: number,
): Promise<{ id: number; name: string; kind: string; previously_cleared_at: string | null }[]> {
  const { data: moment } = await db
    .from("moments").select("reopened_at").eq("id", momentId).maybeSingle();

  const { data: names } = await db
    .from("moment_names")
    .select("id, name, kind, cleared, cleared_at")
    .eq("moment_id", momentId)
    .neq("kind", "not_a_name");

  const reopened = moment?.reopened_at ? new Date(moment.reopened_at as string).getTime() : null;

  return (names ?? [])
    .filter((n) => {
      if (!n.cleared) return true;
      if (!reopened) return false;
      const at = n.cleared_at ? new Date(n.cleared_at as string).getTime() : 0;
      return at < reopened;
    })
    .map((n) => ({
      id: n.id as number,
      name: n.name as string,
      kind: (n.kind ?? "person") as string,
      previously_cleared_at: (n.cleared_at as string | null) ?? null,
    }));
}
