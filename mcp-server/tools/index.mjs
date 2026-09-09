/**
 * The tool registry.
 *
 * One flat list, so registration is a loop rather than a place to forget a tool. Each entry is
 * { name, config, handler } where config is the MCP tool config (title, description, inputSchema)
 * and handler receives (args, { db }).
 *
 * Handlers return a plain value. Turning that into MCP's content envelope, and turning a thrown
 * error into a readable message rather than a transport failure, both happen once in index.mjs —
 * a handler that has to remember to do either is a handler that will eventually forget.
 *
 *   health      — this file's neighbour, and the only tool that needs no schema
 *   read tools  — task 1.2, tools/read.mjs
 *   briefs      — tasks 2.1/2.2, tools/brief.mjs. The drafting and gate standards, assembled
 *                 from prompts.ts so the skills do not hold a second copy of them
 *   write tools — task 1.3, tools/write.mjs
 *   inspect     — tools/inspect.mjs. The five granted tables the original eleven never reached:
 *                 proposals, outcomes, the calendar, selection runs, and a whole-system status
 *   sessions    — tools/sessions.mjs. Clause 4.4's input, without an installer. It imports
 *                 cc-agent's scan rather than repeating it, and posts to worker-triage rather
 *                 than writing a moment, so the daily cap still applies
 */

import { health } from "./health.mjs";
import { readTools } from "./read.mjs";
import { briefTools } from "./brief.mjs";
import { writeTools } from "./write.mjs";
import { inspectTools } from "./inspect.mjs";
import { visualTools } from "./visual.mjs";
import { sessionTools } from "./sessions.mjs";
import { measureTools } from "./measure.mjs";
import { voiceTools } from "./voice.mjs";
// Imported last and registered last: it calls the brief tools through the same registry, so it
// must not be pulled in while that registry is still being assembled.
import { workTools } from "./work.mjs";

export const tools = [
  ...health,
  ...readTools,
  ...briefTools,
  ...inspectTools,
  ...visualTools,
  ...sessionTools,
  ...measureTools,
  ...voiceTools,
  ...workTools,
  ...writeTools,
];

/** Guards against two tools claiming the same name, which registers silently and shadows one. */
export function assertUniqueNames(list = tools) {
  const seen = new Set();
  for (const t of list) {
    if (seen.has(t.name)) throw new Error(`Two tools are both named "${t.name}"`);
    seen.add(t.name);
  }
  return list;
}
