/** Month-chip title layout (pure; see `ChipBody` in WorkoutCard.tsx). */

export interface ChipSplit {
  /** Title text on the first line (after the glyph and star). */
  line1: string;
  /** The rest, on the full-width second line. */
  line2: string;
  /** The star moves to line 2 with the title (the first word does not fit beside the duration). */
  starOn2: boolean;
}

/**
 * Where the first line of a chip title breaks. `avail` = width of the first-line text slot,
 * `starW` = the star's width incl. its gap (0 when not key), `measure` = text width.
 * Breaks between words; when not even the first word fits beside the glyph and duration, the whole
 * title (with its star) starts on line 2 so the star never sits alone.
 */
export function splitChipTitle(title: string, avail: number, starW: number, measure: (s: string) => number): ChipSplit {
  const fits = (s: string) => starW + measure(s) <= avail + 0.25; // sub-pixel rounding
  if (fits(title)) return { line1: title, line2: '', starOn2: false };
  let best = -1;
  for (let i = title.indexOf(' '); i > 0; i = title.indexOf(' ', i + 1)) {
    if (fits(title.slice(0, i))) best = i;
    else break;
  }
  if (best < 0) return { line1: '', line2: title, starOn2: true };
  return { line1: title.slice(0, best), line2: title.slice(best + 1), starOn2: false };
}
