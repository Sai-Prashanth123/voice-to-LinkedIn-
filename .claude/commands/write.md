---
description: Write the next post that is waiting
---

**Call `system_status` first and read the mode.** The two modes have different first steps, and
running the wrong one is the complaint this command exists to avoid.

**one_step** — do **not** call `next_work`; it returns nothing on purpose. Ask him what he wants
written, or use what he just said, and call `start_post` with his words. Then `write_post`, which
hands back the drafting brief.

**interviewed** — call `next_work`. It returns the next idea to write, a first draft or a rewrite,
with the brief attached.

Either way, use the **draft-post** skill and follow the brief it carries. The standard is not in this
file and not in the skill: it comes from the system, so it is whatever Josh last said it was.

Three things that cause most rejections:

- **A claim that traces to nothing.** Every fact, quote, number and name must come from the idea's
  material. Missing detail stays missing — write around the gap, never fill it.
- **Written for everyone.** It is for the specific reader recorded against the idea, in the language
  that reader uses.
- **A hook that closes its own loop.** The first line opens something; it does not resolve it.

Call `measure_draft` and `scrub_draft` before filing. Both are free and both catch things the eight
checks would otherwise reject.

File it with `create_draft`, every claim carrying the verbatim span it rests on.

**Then stop.** Judging a draft in the same breath as writing it is how a weak draft gets waved
through. Start the gate separately, with `/review` or the **gate-check** skill.
