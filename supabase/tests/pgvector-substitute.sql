-- A STAND-IN FOR pgvector, FOR ONE ENGINE ONLY.
--
-- Applied by eval/e2e/pglite.mjs and by NOTHING ELSE. The container path uses the real extension
-- from the pgvector image and must never see this file: two definitions of `vector` in one database
-- is a conflict, and a fake one shadowing a real one is worse than either.
--
-- WHY THIS EXISTS
--
-- PGlite is real Postgres compiled to WASM, which makes it a correct engine for this schema in every
-- respect but one: 0.5.10 ships 34 contrib extensions and pgvector is not among them. Migration 0001
-- calls `create extension if not exists vector` on line 4, so without a substitute the run fails
-- four lines into a 48-file schema and nothing at all can be tested without Docker.
--
-- WHAT IS REAL HERE AND WHAT IS NOT
--
-- Real: the type exists, columns declare it, function signatures resolve, and `<=>` returns an
-- actual cosine distance computed over the actual numbers. A query that ranks by similarity ranks
-- correctly. That is most of what the schema asks of pgvector.
--
-- Not real: the dimension is not enforced, because a domain cannot take a type modifier — a
-- vector(1536) column will accept an array of four. And there is NO INDEX. HNSW is an access method,
-- which cannot be created from SQL at any price, so eval/e2e/pglite.mjs strips those three index
-- statements and every similarity query here is a sequential scan.
--
-- WHAT THAT MEANS FOR A TEST
--
-- An index changes how fast an answer arrives, not what the answer is, so a correctness assertion
-- is unaffected. A test that asserts on an index, a plan, or a dimension rejection is NOT
-- unaffected, and must not be allowed to pass here — pglite.mjs reports `vector: "substitute"` so
-- the harness can skip those rather than let them go green against a stand-in.

create schema if not exists extensions;

-- float8[] rather than a composite or bytea: `unnest(a, b)` gives the pairwise walk the distance
-- function needs, and the literal syntax pgvector accepts — '[1,2,3]' — is not what arrives here,
-- so the e2e fixtures write array literals. That difference is in the open rather than papered over.
do $$
begin
  if not exists (select 1 from pg_type t
                   join pg_namespace n on n.oid = t.typnamespace
                  where t.typname = 'vector' and n.nspname = 'extensions') then
    create domain extensions.vector as float8[];
  end if;
end
$$;

-- Migrations say both `vector(1536)` and `extensions.vector(1024)`; the modifier is stripped before
-- the SQL arrives, and an unqualified `vector` resolves through the search_path 0001 sets up. A
-- second domain in public would resolve too and would also be a second definition, which is the
-- thing this file's header is about.

/*
 * Cosine distance, to the same definition pgvector uses: 1 - (a·b)/(|a||b|).
 *
 * Immutable and strict so it can sit in an ORDER BY the way the real operator does. A zero-length
 * vector returns null rather than raising: the real extension returns NaN, and neither is
 * meaningful, but a null sorts predictably and will not abort a transaction mid-case.
 */
create or replace function extensions.cosine_distance(a float8[], b float8[])
returns float8
language sql
immutable
strict
as $$
  with pairs as (select x, y from unnest(a, b) as t(x, y)),
       parts as (
         select sum(x * y) as dot,
                sqrt(sum(x * x)) as na,
                sqrt(sum(y * y)) as nb
           from pairs
       )
  select case when na = 0 or nb = 0 then null else 1 - (dot / (na * nb)) end from parts
$$;

do $$
begin
  if not exists (
    select 1 from pg_operator o
      join pg_namespace n on n.oid = o.oprnamespace
     where o.oprname = '<=>' and n.nspname = 'extensions'
  ) then
    create operator extensions.<=> (
      leftarg = float8[],
      rightarg = float8[],
      procedure = extensions.cosine_distance,
      commutator = operator(extensions.<=>)
    );
  end if;
end
$$;
