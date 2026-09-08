/**
 * The ways out of an interview, in one place.
 *
 * WHY THIS IS ITS OWN FILE
 *
 * Two files emit these buttons — handlers/interview.ts on every question, worker-select on the
 * daily roundup — and a third, weeklypass.ts, parses them back. Three readers of one thing, which
 * is the shape of every bug this build has had: the callback verb "skq" written in two places and
 * read in a third drifts silently, and the symptom is a button that does nothing when tapped. No
 * error, no log, just a dead button on the day Josh finally engages with a reminder.
 *
 * So the verbs are written once, here, and interviewouts.test.ts feeds every string this file
 * produces through the real parseAction. Emitter and parser cannot disagree without failing.
 *
 * Imports only a type, which type-stripping erases, so this stays cheap to read from anywhere.
 */

import type { Button } from "./telegram.ts";

/**
 * The callback verbs. Short because Telegram caps callback_data at 64 bytes, and the moment id
 * has to fit alongside.
 */
export const OUT_VERBS = {
  resume: "rsm",
  skip: "skq",
  enough: "enuf",
  park: "pk",
} as const;

/**
 * The three offered under every interview question.
 *
 * Not four: "Answer" is absent on purpose. The question is already in front of him and a reply is
 * the default action, so a button saying so would be noise. It exists only on the roundup, where
 * the question is one of several and he has to say which he means.
 */
export function questionOuts(momentId: number): Button[][] {
  return [
    [{ text: "Skip this one", data: `${OUT_VERBS.skip}:${momentId}` }],
    [{ text: "That's enough, write it up", data: `${OUT_VERBS.enough}:${momentId}` }],
    [{ text: "Park it", data: `${OUT_VERBS.park}:${momentId}` }],
  ];
}

/**
 * One row per moment on the daily roundup.
 *
 * Numbered only when there is more than one, because "1 · Answer" on a message listing a single
 * moment is a number that refers to nothing.
 */
export function roundupOuts(momentIds: number[]): Button[][] {
  const numbered = momentIds.length > 1;
  return momentIds.map((id, i) => {
    const n = numbered ? `${i + 1} · ` : "";
    return [
      { text: `${n}Answer`, data: `${OUT_VERBS.resume}:${id}` },
      { text: `${n}Skip`, data: `${OUT_VERBS.skip}:${id}` },
      { text: `${n}Park`, data: `${OUT_VERBS.park}:${id}` },
    ];
  });
}
