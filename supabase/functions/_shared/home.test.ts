import { test } from "node:test";
import assert from "node:assert/strict";
import { type Picture, helpMessage, ruleHelp, statusMessage } from "./home.ts";
import { esc } from "./telegram.ts";

/**
 * The bot is the surface Josh actually uses, so these pin two things: that his own words can never
 * break a formatted message, and that the status screen offers the right next move rather than a
 * fixed menu with numbers printed above it.
 */

const QUIET: Picture = {
  draftsWaiting: 0,
  readyToWrite: 0,
  parked: 0,
  unanswered: 0,
  candidates: 0,
  librarySectionsEmpty: 0,
  voiceGuideMissing: false,
  lastCaptureDaysAgo: 0,
};

test("escaping covers exactly what Telegram HTML needs, and nothing else", () => {
  assert.equal(esc("3 < 5 & 6 > 2"), "3 &lt; 5 &amp; 6 &gt; 2");

  // The whole reason HTML was chosen over Markdown: these appear constantly in real writing and
  // must pass through untouched.
  const real = "the _real_ problem was *cost* — 50% over, per_unit";
  assert.equal(esc(real), real);
});

test("escaping runs before the tags, not after", () => {
  // If & were escaped last it would double-escape the < it had just produced.
  assert.equal(esc("<b>"), "&lt;b&gt;");
  assert.doesNotMatch(esc("a & b"), /&amp;amp;/);
});

test("a quiet week offers a way to make material, not a review of nothing", () => {
  const { html, buttons } = statusMessage(QUIET);
  assert.match(html, /No drafts waiting/);

  const labels = buttons.flat().map((b) => b.text).join(" ");
  assert.match(labels, /Ask me questions/);
  assert.doesNotMatch(labels, /Review/, "there is nothing to review");
});

test("waiting drafts are offered first, and counted in the button", () => {
  const { html, buttons } = statusMessage({ ...QUIET, draftsWaiting: 3 });
  assert.match(html, /<b>3 drafts<\/b> waiting/);
  assert.equal(buttons.flat()[0].text, "Review 3");
});

test("one draft reads as one draft", () => {
  assert.match(statusMessage({ ...QUIET, draftsWaiting: 1 }).html, /1 draft<\/b> waiting/);
  assert.match(statusMessage({ ...QUIET, draftsWaiting: 2 }).html, /2 drafts<\/b> waiting/);
});

test("the empty voice guide is raised above every other library gap", () => {
  const { html, buttons } = statusMessage({
    ...QUIET,
    voiceGuideMissing: true,
    librarySectionsEmpty: 7,
  });
  assert.match(html, /voice guide is still empty/);
  // 8.1 puts it on the critical path; "7 sections waiting" would bury it as one item among seven.
  assert.doesNotMatch(html, /7 library sections/);
  assert.match(buttons.flat().map((b) => b.text).join(" "), /Record the voice guide/);
});

test("other library gaps are reported once the guide is in", () => {
  const { html } = statusMessage({ ...QUIET, librarySectionsEmpty: 4 });
  assert.match(html, /4 library sections/);
});

test("silence is reported without being scolding", () => {
  const quiet = statusMessage({ ...QUIET, lastCaptureDaysAgo: 6 }).html;
  assert.match(quiet, /6 days/);
  assert.match(quiet, /quiet week is fine/);

  // Two days is not worth mentioning; 13.1 is about weeks, not hours.
  assert.doesNotMatch(statusMessage({ ...QUIET, lastCaptureDaysAgo: 2 }).html, /days\./);
});

test("every button carries an action the bot can route", () => {
  const seen = new Set<string>();
  for (const p of [QUIET, { ...QUIET, draftsWaiting: 2, candidates: 1, voiceGuideMissing: true }]) {
    for (const b of [...statusMessage(p).buttons.flat(), ...helpMessage(p).buttons.flat()]) {
      assert.match(b.data, /^menu:[a-z]+$/, `${b.text} has no routable action`);
      // Telegram silently drops callback data over 64 bytes.
      assert.ok(b.data.length <= 64);
      seen.add(b.data);
    }
  }
  // Every destination the menu offers must exist in the webhook's routing table.
  const routable = new Set([
    "menu:review", "menu:status", "menu:ask", "menu:candidates",
    "menu:voiceguide", "menu:seed", "menu:rule", "menu:help",
  ]);
  for (const d of seen) assert.ok(routable.has(d), `${d} is offered but not routed`);
});

test("help leads with what is waiting rather than a list of verbs", () => {
  assert.match(helpMessage({ ...QUIET, draftsWaiting: 2 }).html, /You have <b>2 drafts<\/b> waiting/);
  assert.match(helpMessage(QUIET).html, /Nothing is waiting on you/);
});

test("the rule example survives escaping and stays copyable", () => {
  const html = ruleHelp();
  assert.match(html, /<code>/);
  assert.match(html, /never use the word journey/);
  // No raw angle brackets outside the tags we wrote.
  assert.doesNotMatch(html.replace(/<\/?(b|i|code)>/g, ""), /[<>]/);
});
