/**
 * Normalising PostgREST embedded rows.
 *
 * PostgREST returns a one-to-MANY embed as an array and a one-to-ONE embed as a single object. Which
 * one you get depends on how it reads the constraints: `outcomes.post_id` and `material.moment_id`
 * are primary keys referencing their parent, so those come back as objects, while `moment_names`
 * has its own primary key and comes back as an array.
 *
 * Getting that wrong fails silently — `object?.[0]` is `undefined`, so a post's metrics simply render
 * blank rather than throwing. So every embed is read through here instead of being indexed directly.
 */
export function one<T>(embedded: T | T[] | null | undefined): T | null {
  if (embedded == null) return null;
  return Array.isArray(embedded) ? (embedded[0] ?? null) : embedded;
}

export function many<T>(embedded: T | T[] | null | undefined): T[] {
  if (embedded == null) return [];
  return Array.isArray(embedded) ? embedded : [embedded];
}
