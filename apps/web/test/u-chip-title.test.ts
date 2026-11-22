/** Month-chip title wrapping (WorkoutCard chip, DESIGN_V2 §5): pure layout rule, fixed-width font. */
import { describe, expect, it } from 'vitest';
import { splitChipTitle } from '../src/ui/domain/chipTitle';

const mono = (s: string) => s.length * 7; // 7px per character

describe('splitChipTitle', () => {
  it('keeps a title that fits on the first line whole', () => {
    expect(splitChipTitle('Easy spin 25′', 140, 0, mono)).toEqual({ line1: 'Easy spin 25′', line2: '', starOn2: false });
  });

  it('breaks between words and gives the rest the full second line', () => {
    // 72px beside the duration: "Long ride" (63) fits, "Long ride 2h05" (98) does not
    expect(splitChipTitle('Long ride 2h05 — Gavarres loop', 72, 0, mono)).toEqual({ line1: 'Long ride', line2: '2h05 — Gavarres loop', starOn2: false });
  });

  it('counts the key star on the first line', () => {
    // with a 16px star only "Long" (28 + 16) fits in 50px
    expect(splitChipTitle('Long ride 2h05', 50, 16, mono)).toEqual({ line1: 'Long', line2: 'ride 2h05', starOn2: false });
  });

  it('never leaves the star alone: a first word that does not fit takes the star to line 2', () => {
    expect(splitChipTitle('Progression 30′', 60, 16, mono)).toEqual({ line1: '', line2: 'Progression 30′', starOn2: true });
  });

  it('a single long word without a star also starts on line 2', () => {
    expect(splitChipTitle('Recovery', 30, 0, mono)).toEqual({ line1: '', line2: 'Recovery', starOn2: true });
  });
});
