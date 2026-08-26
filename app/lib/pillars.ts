/**
 * Josh's pillars, read out of the library section he writes them in.
 *
 * A deliberate copy of `parsePillars` in `supabase/functions/_shared/library.ts`, which is the
 * source of truth and carries the tests. It cannot be imported: that module is Deno, with `npm:`
 * specifiers Next will not resolve. If the parsing rules change, change both — the two must agree,
 * because the pillar Josh picks here is counted in the balance (7.1) the drafter reads there.
 */
export function parsePillars(body: string): string[] {
  const out: string[] = [];

  for (const raw of (body ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    const heading = line.match(/^#{2,}\s+(.{2,60})$/);
    const bullet = line.match(/^[-*]\s+(.{2,60})$/);
    const candidate = heading?.[1] ?? bullet?.[1];
    if (!candidate) continue;

    const name = candidate.split(/[—–:|]/)[0].replace(/[*_`]/g, "").trim();
    if (name.length < 2 || name.length > 40) continue;

    if (/^(for josh|not drafted|what goes here|starter|three to five|content pillars)/i.test(name)) {
      continue;
    }
    if (!out.includes(name)) out.push(name);
  }
  return out;
}
