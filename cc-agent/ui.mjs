/**
 * Terminal output for cc-agent.
 *
 * The installer is the first thing anyone runs on Josh's machine, and it was eleven bare
 * `console.log` calls. It worked, and it read like a script rather than like a piece of software —
 * which matters here more than it usually would, because 4.4.1 says this must then run "with no
 * action from Josh". A setup run he does not trust is one he checks up on, and a setup run he cannot
 * read is one he abandons half way.
 *
 * COLOUR DEGRADES RATHER THAN LEAKING
 *
 * This is run three ways: by a person in a terminal, by a scheduler with no TTY attached, and
 * potentially piped somewhere. Escape codes written into a Task Scheduler log are worse than no
 * colour at all, so every code is stripped unless stdout is a real terminal. `NO_COLOR` is honoured
 * because it is the convention, and `FORCE_COLOR` because CI sometimes needs it back.
 */

const enabled = (() => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
})();

const wrap = (open, close) => (s) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  green: wrap(32, 39),
  red: wrap(31, 39),
  yellow: wrap(33, 39),
  cyan: wrap(36, 39),
  grey: wrap(90, 39),
};

/**
 * Marks. ASCII fallbacks because a Windows console in a legacy code page renders "✓" as mojibake,
 * and a tick that arrives as "Ô£ô" is worse than one that arrives as "OK".
 */
const unicode = enabled && process.env.TERM !== "dumb" &&
  (process.platform !== "win32" || Boolean(process.env.WT_SESSION));

export const mark = {
  ok: unicode ? c.green("✓") : c.green("OK  "),
  no: unicode ? c.red("✗") : c.red("FAIL"),
  warn: unicode ? c.yellow("!") : c.yellow("WARN"),
  step: unicode ? c.cyan("→") : c.cyan("->"),
  dot: c.grey(unicode ? "·" : "-"),
};

export function title(name, subtitle) {
  const line = unicode ? "─" : "-";
  console.log("");
  console.log(`  ${c.bold(name)}${subtitle ? `  ${mark.dot}  ${c.grey(subtitle)}` : ""}`);
  console.log(`  ${c.grey(line.repeat(Math.min(58, name.length + (subtitle?.length ?? 0) + 6)))}`);
}

export const ok = (msg, detail) => line(mark.ok, msg, detail);
export const no = (msg, detail) => line(mark.no, msg, detail);
export const warn = (msg, detail) => line(mark.warn, msg, detail);
export const step = (msg, detail) => line(mark.step, msg, detail);

function line(m, msg, detail) {
  console.log(`  ${m} ${msg}${detail ? ` ${c.grey(detail)}` : ""}`);
}

export function blank() {
  console.log("");
}

/** An indented explanation under a failed check — what to actually do about it. */
export function hint(text) {
  for (const l of String(text).split("\n")) console.log(`    ${c.grey(l)}`);
}

export function done(text) {
  console.log("");
  console.log(`  ${c.green(c.bold(text))}`);
  console.log("");
}

export function failed(text) {
  console.log("");
  console.log(`  ${c.red(c.bold(text))}`);
  console.log("");
}
