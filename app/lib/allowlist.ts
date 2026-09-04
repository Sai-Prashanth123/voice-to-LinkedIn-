/**
 * Who may sign in to the desk.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * The rule was written out twice — once in `middleware.ts` for anyone already holding a session,
 * once in `login/page.tsx` before a magic link is sent. Two copies of an access rule is one copy
 * too many: the gap between them is a link posted to an address the middleware would then reject,
 * or worse, the reverse.
 *
 * IT FAILS CLOSED, AND THAT IS NOT AN ACCIDENT
 *
 * The original read `if (user && allowed && ...)`, so an unset ALLOWED_EMAIL made the condition
 * short-circuit and let every signed-in user straight through. On a laptop with the variable always
 * set it looked correct for months; on the public deployment, where it was missing, anyone holding
 * an account on this Supabase project could have read the whole idea bank. A missing allowlist is a
 * locked door here, never an open one.
 *
 * WHAT ALLOWED_EMAIL ACCEPTS
 *
 *   prashanth@thought-pilot.com          one address, the original behaviour
 *   josh@slingshot.com, prashanth@…      several, comma or space separated
 *   *@slingshotgtm.com                   everyone at a domain
 *   *                                    ANY email that can receive a magic link
 *
 * The last one is a real setting because it was explicitly asked for, and it is worth being blunt
 * about what it means: clause 15.4 exists because the idea bank holds call transcripts and client
 * material, so "has an account" was judged insufficient. With `*`, anyone who can receive mail can
 * read all of it. It is the right setting for a demo and the wrong one for Josh's real material.
 */

/** Split on commas, semicolons or whitespace, so a pasted list works however it was pasted. */
function entries(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(
  email: string | undefined | null,
  raw: string | undefined | null = process.env.ALLOWED_EMAIL,
): boolean {
  const address = (email ?? "").trim().toLowerCase();
  if (!address) return false;

  const list = entries(raw);
  if (list.length === 0) return false; // unset means nobody, not everybody

  for (const entry of list) {
    if (entry === "*") return true;
    if (entry.startsWith("*@")) {
      // A domain wildcard has to match the domain exactly. Endswith("@example.com") would also
      // admit "someone@evil-example.com" if the "@" were dropped, so the "@" is kept in the compare.
      if (address.endsWith(entry.slice(1))) return true;
      continue;
    }
    if (address === entry) return true;
  }
  return false;
}

/** For the sign-in page: what to tell someone whose address was refused. */
export function isOpenToAnyone(raw: string | undefined | null = process.env.ALLOWED_EMAIL): boolean {
  return entries(raw).includes("*");
}
