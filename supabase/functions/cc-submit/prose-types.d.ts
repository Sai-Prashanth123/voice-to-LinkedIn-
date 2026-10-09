/**
 * Types for scripts/lib/prose.mjs, which is plain JavaScript shared with the Node-side scripts.
 *
 * The module is deliberately not duplicated as TypeScript: `measurePost` defines what a sentence, a
 * paragraph and an opening line ARE, and two definitions of that would make every comparison between
 * a draft and the reference corpus an artefact of which copy ran.
 */
export interface PostMeasurement {
  words: number;
  paragraphs: number;
  lines: number;
  above_fold_words: number;
  opening_words: number;
  opening_shape: string;
  close_shape: string;
  bullet_lines: number;
  uses_list: boolean;
  colon_lines: number;
  has_link: boolean;
  sentence_words_mean: number;
  sentence_words_sd: number;
}

export function measurePost(text: string): PostMeasurement;
export function median(xs: number[]): number;
export function tally(xs: string[]): [string, number][];
export function words(s: string): number;
export function sentences(text: string): string[];
export function mean(xs: number[]): number;
export function sd(xs: number[]): number;
