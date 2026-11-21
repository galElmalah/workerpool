import { test } from 'vitest';
import { generateAthlete } from '../../src/synth';
test('scratch', () => {
  const a = generateAthlete({ seed: 7, today: '2026-11-21' });
  for (const p of a.plan.filter((p) => p.date >= '2026-11-16')) console.log(p.key, p.startTime, p.sport, p.subSport, p.title, Math.round(p.plannedDurationSec / 60) + 'min', p.plannedDistanceM ?? '', p.isKey ? 'KEY' : '', p.intensity, p.preNote ?? '', p.activityId ? 'DONE' : p.skipped ? 'SKIP:' + p.skipped.reason : '');
  console.log(a.weekNotes.slice(-8));
  console.log(a.dayNotes.slice(-10));
  console.log(a.thresholdHistory);
  console.log(a.profile);
  console.log(a.wellness.slice(-3));
  console.log(a.markers.filter((m) => m.type !== 'rest'));
  const notes = a.activities.filter((x) => x.postNote).length;
  console.log('notes', notes, 'rpe', a.activities.filter((x) => x.rpe).length, 'of', a.activities.length);
  console.log(a.activities.filter((x) => x.localDate === '2026-10-04' || x.localDate === '2026-07-26' || x.localDate === '2026-02-22').map((x) => `${x.title} ${x.startedAt} dur ${x.durationSec} dist ${x.distanceM} np ${x.normPower ?? ''} hr ${x.avgHr} | ${x.postNote}`).join('\n'));
});
