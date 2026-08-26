#!/usr/bin/env node
/**
 * ACCEPTANCE TEST 8 — the gate must reject generic writing.
 *
 *   "Josh seeds ten deliberately generic drafts and at least nine have to be rejected."
 *
 * This is the most testable clause in the contract and the only one that can be proven before Josh
 * ever looks at a post, so it should not be waiting on him to run it by hand at handover.
 *
 * The ten below are written to be exactly the failure the spec describes: fluent, confident,
 * plausible LinkedIn writing that any competent stranger in the field could have produced without
 * having been in the room. Several are deliberately GOOD of their kind — the easy version of this
 * test uses ten obviously bad posts and proves nothing, because a gate that only catches clumsy
 * writing is not the gate clause 9b asks for.
 *
 * Two are near-misses on purpose: #9 and #10 have specific-sounding detail attached to a generic
 * spine. They are the ones worth watching. If the gate passes both, the "at least nine" bar is
 * already gone.
 *
 *   node eval/gate-acceptance.mjs
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and drafts against a real moment so the
 * source-backed checks have something to compare with.
 */

const URL_BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

/**
 * Ten generic drafts. Each names what makes it generic, so a surprising verdict can be argued with
 * rather than just noted.
 */
export const GENERIC_DRAFTS = [
  {
    id: "advice-listicle",
    why: "pure advice, no incident, could be written by anyone with a LinkedIn account",
    body:
      `Most founders get positioning wrong.\n\nThey describe what they do instead of who it is for.\n\n` +
      `Three things that help:\n\n1. Name the buyer, not the category\n2. Say what breaks without you\n` +
      `3. Cut every sentence that could appear on a competitor's site\n\n` +
      `Positioning is not a tagline. It is a decision about who you are not for.`,
  },
  {
    id: "contrarian-take",
    why: "a confident opinion dressed as insight; no evidence, no moment",
    body:
      `Unpopular opinion: most sales training is a waste of money.\n\n` +
      `Not because the content is wrong. Because the problem is rarely skill.\n\n` +
      `It is usually a pipeline that was never qualified, or a product nobody can describe in one line.\n\n` +
      `Fix the upstream problem and the training becomes unnecessary.`,
  },
  {
    id: "fake-vulnerability",
    why: "performed openness with nothing specific in it",
    body:
      `I used to think being busy meant being valuable.\n\nIt took me years to understand that was fear ` +
      `wearing a suit.\n\nThe best work I have done came from the quiet weeks, not the loud ones.\n\n` +
      `If you are reading this at 11pm, that is probably a sign.`,
  },
  {
    id: "trend-commentary",
    why: "commentary on a public trend; no access to anything private required",
    body:
      `Every B2B company is adding AI to their pitch right now.\n\n` +
      `Buyers have stopped hearing it. It has become the new "innovative".\n\n` +
      `The companies that win the next two years will be the ones who can say what it actually does ` +
      `for a specific person on a specific day.`,
  },
  {
    id: "framework-post",
    why: "an invented framework with no origin story",
    body:
      `There are three kinds of pipeline:\n\nThe pipeline you have.\nThe pipeline you report.\n` +
      `The pipeline that will actually close.\n\nMost teams manage the second one.\n\n` +
      `The gap between the first and third is the only number that matters.`,
  },
  {
    id: "engagement-bait",
    why: "explicitly asks for engagement, which the library rules out outright",
    body:
      `Hiring is broken.\n\nWe interview for confidence and then complain about arrogance.\n` +
      `We ask for ten years of experience in a five year old category.\n\nAgree? What would you add?`,
  },
  {
    id: "quote-and-lesson",
    why: "borrowed wisdom, no lived experience",
    body:
      `"Culture eats strategy for breakfast."\n\nEveryone quotes it. Almost nobody acts on it.\n\n` +
      `Culture is not the values on your wall. It is what happens when someone underperforms and ` +
      `everyone watches to see what you do about it.`,
  },
  {
    id: "definition-post",
    why: "a definition anyone in the field could supply",
    body:
      `Product-market fit is not a milestone. It is a state you can fall out of.\n\n` +
      `You had it when the market moved. You may not have it now.\n\n` +
      `The signal is not revenue. It is how hard you have to push for the next customer.`,
  },
  {
    id: "near-miss-fake-detail",
    why: "NEAR MISS — invented specifics on a generic spine. Detail that sounds sourced but is not.",
    body:
      `A founder told me last week that his team had 47 opportunities in pipeline.\n\n` +
      `Eleven of them had no next meeting booked.\n\n` +
      `That is not a pipeline. That is a list.\n\n` +
      `Most teams are one honest audit away from a much smaller, much more useful number.`,
  },
  {
    id: "near-miss-generic-scene",
    why: "NEAR MISS — a scene with no person, no words spoken, no consequence. Shape without substance.",
    body:
      `I sat in a meeting recently where nobody could answer a simple question.\n\n` +
      `Who is this for?\n\nEight people in the room. Four different answers.\n\n` +
      `That is usually the real problem, and it is never the one on the agenda.`,
  },
];

async function rest(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : await res.json();
}

async function main() {
  // A real moment to hang the drafts on, so the source-backed checks have something to read.
  // Deliberately a moment with material: the point is that a generic post fails EVEN WITH a decent
  // source behind it, which is a harder and more honest test than one with an empty entry.
  const moments = await rest(
    "moments?select=id,ref,material(the_moment)&status=in.(mined,queued,drafted,gated,published)&order=id.desc&limit=5",
  );
  const host = moments.find((m) => {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return mat?.the_moment;
  });

  if (!host) {
    console.error(
      "No mined moment with material to attach test drafts to. Run a seeding session first —\n" +
        "testing the gate against an empty source entry proves nothing.",
    );
    process.exit(2);
  }

  console.log(`Acceptance test 8 — ten generic drafts, at least nine must be rejected.`);
  console.log(`Source moment: ${host.ref}\n`);

  const results = [];

  for (const [i, spec] of GENERIC_DRAFTS.entries()) {
    // Inserted with an empty claim ledger, which is honest: these drafts assert things no source
    // supports, and that is the point. `claims_verified` false would short-circuit the gate before
    // the model checks run, so it is left null and the gate job is enqueued directly.
    const [draft] = await rest("drafts", {
      method: "POST",
      body: JSON.stringify({
        moment_id: host.id,
        version: 9000 + i,
        attempt: 1,
        body: spec.body,
        hook: spec.body.split("\n")[0],
        framework: "acceptance-fixture",
        model: "acceptance-fixture",
        claims: [],
        claims_verified: true,
      }),
    });

    await rest("jobs", {
      method: "POST",
      body: JSON.stringify({
        type: "gate",
        payload: { draft_id: draft.id, moment_id: host.id, attempt: 3 },
      }),
    });

    results.push({ ...spec, draftId: draft.id });
    process.stdout.write(`  queued ${spec.id}\n`);
  }

  console.log(`\nWaiting for the gate. Eight checks per draft, ten drafts.\n`);

  const deadline = Date.now() + 25 * 60_000;
  let judged = [];

  while (Date.now() < deadline) {
    const ids = results.map((r) => r.draftId).join(",");
    const rows = await rest(`drafts?select=id,gate_passed,gate_reason&id=in.(${ids})`);
    judged = rows.filter((r) => r.gate_passed !== null);
    if (judged.length === results.length) break;
    process.stdout.write(`\r  ${judged.length}/${results.length} judged…`);
    await new Promise((r) => setTimeout(r, 10_000));
  }

  console.log(`\n`);

  const byId = new Map(judged.map((j) => [j.id, j]));
  let rejected = 0;

  for (const r of results) {
    const verdict = byId.get(r.draftId);
    const status = !verdict
      ? "NOT JUDGED"
      : verdict.gate_passed
      ? "PASSED  ← this one got through"
      : "rejected";
    if (verdict && !verdict.gate_passed) rejected++;

    const caught = verdict?.gate_reason?.split(":")[0] ?? "";
    console.log(`  ${status.padEnd(28)} ${r.id}${caught ? `  (${caught})` : ""}`);
    if (verdict?.gate_passed) console.log(`      why it should have failed: ${r.why}`);
  }

  console.log(`\n  ${rejected} of ${results.length} rejected. The bar is 9.\n`);

  if (rejected >= 9) {
    console.log("  PASS — acceptance test 8 is met.");
    process.exit(0);
  }

  console.log(
    "  FAIL — the gate is letting generic writing through.\n\n" +
      "  This is not a threshold to relax. 9b: \"a gate that always eventually passes something is\n" +
      "  not a gate.\" Tighten the rubric of whichever check should have caught these and re-run.",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
