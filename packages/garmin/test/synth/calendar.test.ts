import { describe, expect, it } from 'vitest';
import { addDays, diffDays, isoWeekday, weekStart } from '@cadence/core/time';
import { athlete, mean, mondayOf, TODAY } from './fixtures';

describe('calendar invariants', () => {
  const a = athlete();
  const planByKey = new Map(a.plan.map((p) => [p.key, p]));

  it('no activities after today; chronological, unique, increasing ids', () => {
    let prev = '';
    let prevId = 0;
    const ids = new Set<number>();
    for (const x of a.activities) {
      expect(x.localDate <= TODAY).toBe(true);
      expect(x.startedAt >= prev).toBe(true);
      expect(x.garminActivityId).toBeGreaterThan(prevId);
      expect(ids.has(x.garminActivityId)).toBe(false);
      ids.add(x.garminActivityId);
      prev = x.startedAt;
      prevId = x.garminActivityId;
    }
  });

  it('activities on the same day never overlap and bricks follow the ride', () => {
    for (let i = 1; i < a.activities.length; i++) {
      const p = a.activities[i - 1]!;
      const c = a.activities[i]!;
      if (p.localDate !== c.localDate) continue;
      expect(Date.parse(c.startedAt), `${p.title} → ${c.title}`).toBeGreaterThanOrEqual(Date.parse(p.startedAt) + p.durationSec * 1000);
    }
  });

  it('planned ↔ activity keys resolve both ways', () => {
    const byId = new Map(a.activities.map((x) => [x.garminActivityId, x]));
    for (const x of a.activities) {
      if (!x.plannedKey) continue;
      const p = planByKey.get(x.plannedKey);
      expect(p, x.plannedKey).toBeDefined();
      expect(p!.activityId).toBe(x.garminActivityId);
      expect(p!.date).toBe(x.localDate);
      expect(p!.sport).toBe(x.sport);
    }
    for (const p of a.plan) {
      if (p.activityId !== undefined) expect(byId.get(p.activityId)?.plannedKey).toBe(p.key);
      expect(p.activityId !== undefined && p.skipped !== undefined).toBe(false);
    }
    expect(a.activities.filter((x) => !x.plannedKey).length).toBeGreaterThan(10); // spontaneous extras
  });

  it('plan keys are unique and follow date#n ordering by start time', () => {
    expect(new Set(a.plan.map((p) => p.key)).size).toBe(a.plan.length);
    for (const p of a.plan) expect(p.key.startsWith(`${p.date}#`)).toBe(true);
  });

  it('future plan covers the rest of this week + 3 weeks and is untouched', () => {
    const end = addDays(weekStart(TODAY), 27);
    const future = a.plan.filter((p) => p.date > TODAY);
    expect(future.length).toBeGreaterThan(25);
    expect(future.at(-1)!.date).toBe(end);
    for (const p of future) {
      expect(p.activityId).toBeUndefined();
      expect(p.skipped).toBeUndefined();
    }
    for (let w = 1; w <= 3; w++) {
      const mon = addDays(weekStart(TODAY), 7 * w);
      const wk = future.filter((p) => p.date >= mon && p.date <= addDays(mon, 6));
      expect(wk.length).toBeGreaterThanOrEqual(6);
      expect(wk.filter((p) => p.isKey).length).toBeGreaterThanOrEqual(1);
      expect(new Set(wk.map((p) => p.intensity)).size).toBeGreaterThanOrEqual(3);
    }
  });

  it('weekly hours are sane and show 3:1 periodisation', () => {
    const hours = new Map<string, number>();
    for (const x of a.activities) hours.set(mondayOf(x.localDate), (hours.get(mondayOf(x.localDate)) ?? 0) + x.movingSec / 3600);
    const full = [...hours.entries()].filter(([m]) => addDays(m, 6) < TODAY);
    for (const [m, h] of full) expect(h, m).toBeLessThan(17);
    const vals = full.map(([, h]) => h);
    expect(Math.max(...vals)).toBeGreaterThan(10);
    expect(mean(vals)).toBeGreaterThan(7);
    expect(mean(vals)).toBeLessThan(11);
    // recovery weeks (from the plan's phase structure) are lighter than their neighbours
    const loadWeeks = vals.filter((h) => h > 9).length;
    const lightWeeks = vals.filter((h) => h < 7).length;
    expect(loadWeeks).toBeGreaterThan(15);
    expect(lightWeeks).toBeGreaterThan(6);
  });

  it('about 2–3 key sessions per week', () => {
    const keys = new Map<string, number>();
    for (const p of a.plan) if (p.isKey) keys.set(mondayOf(p.date), (keys.get(mondayOf(p.date)) ?? 0) + 1);
    const avg = mean([...keys.values()]);
    expect(avg).toBeGreaterThanOrEqual(2);
    expect(avg).toBeLessThanOrEqual(4);
  });

  it('phases are contiguous Monday–Sunday blocks covering the whole calendar', () => {
    const ph = a.phases;
    expect(ph.length).toBeGreaterThanOrEqual(12);
    for (let i = 0; i < ph.length; i++) {
      expect(isoWeekday(ph[i]!.startDate)).toBe(1);
      expect(isoWeekday(ph[i]!.endDate)).toBe(7);
      if (i > 0) expect(ph[i]!.startDate).toBe(addDays(ph[i - 1]!.endDate, 1));
    }
    expect(ph[0]!.startDate).toBe(a.wellness[0]!.date);
    expect(ph.at(-1)!.endDate).toBe(a.plan.at(-1)!.date);
    const types = ph.map((p) => p.type);
    for (const t of ['base', 'build', 'peak', 'taper', 'race', 'recovery', 'transition']) expect(types).toContain(t);
  });

  it('A race 6–8 weeks before today, B race 3–5 weeks after, C races in between', () => {
    const A = a.events.filter((e) => e.priority === 'A');
    const B = a.events.filter((e) => e.priority === 'B');
    const C = a.events.filter((e) => e.priority === 'C');
    expect(A).toHaveLength(1);
    expect(B).toHaveLength(1);
    expect(C.length).toBeGreaterThanOrEqual(2);
    const da = diffDays(A[0]!.date, TODAY);
    expect(da).toBeGreaterThanOrEqual(42);
    expect(da).toBeLessThanOrEqual(56);
    const db = diffDays(TODAY, B[0]!.date);
    expect(db).toBeGreaterThanOrEqual(21);
    expect(db).toBeLessThanOrEqual(35);
    expect(A[0]!.resultActivityId).toBeDefined();
    for (const c of C) expect(c.resultActivityId).toBeDefined();
    // the A race was raced as three legs on race day
    const legs = a.activities.filter((x) => x.localDate === A[0]!.date && planByKey.get(x.plannedKey ?? '')?.tags.includes('race'));
    expect(legs.map((x) => x.sport)).toEqual(['swim', 'bike', 'run']);
    expect(legs[0]!.subSport).toBe('open_water');
    // B race is planned in the future
    expect(a.plan.some((p) => p.date === B[0]!.date && p.intensity === 'race')).toBe(true);
  });

  it('thresholds move on test days', () => {
    const ftp = a.thresholdHistory.filter((t) => t.kind === 'ftp').map((t) => t.value);
    expect(ftp).toEqual([255, 262, 268, 276]);
    const run = a.thresholdHistory.filter((t) => t.kind === 'run_threshold').map((t) => t.value);
    expect(run.length).toBeGreaterThanOrEqual(3);
    expect(run.at(-1)! > run[0]!).toBe(true);
    const css = a.thresholdHistory.filter((t) => t.kind === 'swim_css').map((t) => t.value);
    expect(css.length).toBeGreaterThanOrEqual(3);
    expect(a.profile.ftp).toBe(276);
    for (const t of a.thresholdHistory.filter((t) => t.effectiveFrom > a.wellness[0]!.date && ['ftp', 'swim_css'].includes(t.kind))) {
      const test = a.plan.find((p) => p.date === addDays(t.effectiveFrom, -1) && p.tags.includes('test'));
      expect(test, `${t.kind} ${t.effectiveFrom}`).toBeDefined();
      expect(test!.activityId).toBeDefined();
    }
    const sorted = [...a.thresholdHistory].sort((x, y) => x.effectiveFrom.localeCompare(y.effectiveFrom));
    expect(a.thresholdHistory).toEqual(sorted);
  });

  it('sick week, travel, injury and vacation are visible in markers, skips and wellness', () => {
    const sick = a.markers.find((m) => m.type === 'sick')!;
    expect(sick).toBeDefined();
    for (const m of ['travel', 'vacation', 'injured']) expect(a.markers.some((x) => x.type === m)).toBe(true);
    const inSick = a.plan.filter((p) => p.date >= sick.date && p.date <= sick.endDate!);
    expect(inSick.length).toBeGreaterThan(4);
    for (const p of inSick) expect(p.skipped?.reason).toBe('sick');
    expect(a.activities.filter((x) => x.localDate >= sick.date && x.localDate <= sick.endDate!)).toHaveLength(0);
    const hrvSick = mean(a.wellness.filter((w) => w.date >= sick.date && w.date <= sick.endDate!).map((w) => w.hrvMs!));
    const hrvAll = mean(a.wellness.map((w) => w.hrvMs!));
    expect(hrvSick).toBeLessThan(hrvAll - 10);
    const rhrSick = mean(a.wellness.filter((w) => w.date >= sick.date && w.date <= sick.endDate!).map((w) => w.restingHr!));
    expect(rhrSick).toBeGreaterThan(mean(a.wellness.map((w) => w.restingHr!)) + 4);
    // the session the day before the illness was cut short
    const eve = a.activities.filter((x) => x.localDate === addDays(sick.date, -1));
    for (const x of eve) expect(x.postNote).toBeDefined();
    const reasons = new Set(a.plan.filter((p) => p.skipped).map((p) => p.skipped!.reason));
    for (const r of ['sick', 'travel', 'weather', 'life', 'injury']) expect(reasons.has(r as never), r).toBe(true);
    expect(a.activities.some((x) => x.subSport === 'treadmill')).toBe(true);
    expect(a.activities.some((x) => x.title.includes('→ trainer'))).toBe(true);
  });

  it('compliance varies: mostly on target, some short/long, a few missed', () => {
    const byId = new Map(a.activities.map((x) => [x.garminActivityId, x]));
    const past = a.plan.filter((p) => p.date < TODAY);
    let on = 0;
    let short = 0;
    let long = 0;
    let missed = 0;
    for (const p of past) {
      if (p.skipped) continue;
      if (p.activityId === undefined) {
        missed++;
        continue;
      }
      const x = byId.get(p.activityId)!;
      const r = x.movingSec / p.plannedDurationSec;
      if (r < 0.8) short++;
      else if (r > 1.2) long++;
      else on++;
    }
    const done = on + short + long;
    expect(on / done).toBeGreaterThan(0.75);
    expect(short).toBeGreaterThan(8);
    expect(long).toBeGreaterThan(5);
    expect(missed).toBeGreaterThan(2);
    expect(missed).toBeLessThan(past.length * 0.05);
  });

  it('realistic day-of-week patterns and start times', () => {
    const longRides = a.activities.filter((x) => x.sport === 'bike' && x.title.startsWith('Long ride'));
    expect(longRides.filter((x) => isoWeekday(x.localDate) === 6).length / longRides.length).toBeGreaterThan(0.9);
    const longRuns = a.activities.filter((x) => x.title.startsWith('Long run'));
    expect(longRuns.filter((x) => isoWeekday(x.localDate) === 7).length / longRuns.length).toBeGreaterThan(0.9);
    for (const x of a.activities) {
      const h = (Date.parse(x.startedAt) / 3_600_000 + x.utcOffsetMin / 60) % 24;
      expect(h, x.title).toBeGreaterThan(5.5);
      expect(h, x.title).toBeLessThan(21);
    }
    // DST: summer activities are UTC+2, winter UTC+1
    expect(a.activities.find((x) => x.localDate.slice(5, 7) === '07')!.utcOffsetMin).toBe(120);
    expect(a.activities.find((x) => x.localDate.slice(5, 7) === '01')!.utcOffsetMin).toBe(60);
  });

  it('notes: pre-notes, post-notes with RPE/feel, day notes and week notes with targets', () => {
    expect(a.plan.filter((p) => p.preNote).length).toBeGreaterThan(15);
    expect(a.activities.filter((x) => x.postNote).length).toBeGreaterThan(a.activities.length * 0.3);
    expect(a.activities.filter((x) => x.rpe !== undefined).length).toBeGreaterThan(a.activities.length * 0.6);
    expect(a.dayNotes.length).toBeGreaterThan(15);
    expect(a.weekNotes.length).toBeGreaterThan(15);
    expect(a.weekNotes.filter((w) => w.targetHours !== undefined).length).toBeGreaterThan(8);
    expect(new Set(a.dayNotes.map((n) => n.date)).size).toBe(a.dayNotes.length);
  });

  it('wellness: one day per date up to today, coherent ranges', () => {
    const w = a.wellness;
    expect(w.at(-1)!.date).toBe(TODAY);
    for (let i = 1; i < w.length; i++) expect(w[i]!.date).toBe(addDays(w[i - 1]!.date, 1));
    for (const d of w) {
      expect(d.hrvMs!).toBeGreaterThan(20);
      expect(d.restingHr!).toBeGreaterThan(38);
      expect(d.restingHr!).toBeLessThan(65);
      expect(d.sleepSec!).toBeGreaterThan(4 * 3600);
    }
    const weights = w.filter((d) => d.weightKg !== undefined);
    expect(weights.length).toBeGreaterThan(w.length * 0.3);
    expect(weights.length).toBeLessThan(w.length * 0.9);
    const vo2 = w.filter((d) => d.vo2max !== undefined).map((d) => d.vo2max!);
    expect(vo2.length).toBeGreaterThan(20);
    expect(mean(vo2.slice(-15))).toBeGreaterThan(mean(vo2.slice(0, 15)));
    expect(new Set(w.map((d) => d.hrvStatus)).size).toBeGreaterThanOrEqual(3);
  });

  it('sport mix matches a multi-sport athlete', () => {
    const count = (f: (x: (typeof a.activities)[0]) => boolean) => a.activities.filter(f).length;
    expect(count((x) => x.sport === 'bike' && x.subSport === 'indoor')).toBeGreaterThan(40);
    expect(count((x) => x.sport === 'bike' && x.subSport === 'road')).toBeGreaterThan(30);
    expect(count((x) => x.sport === 'run')).toBeGreaterThan(100);
    expect(count((x) => x.sport === 'swim' && x.subSport === 'pool')).toBeGreaterThan(60);
    expect(count((x) => x.subSport === 'open_water')).toBeGreaterThan(5);
    expect(count((x) => x.sport === 'row')).toBeGreaterThan(25);
    expect(count((x) => x.sport === 'strength')).toBeGreaterThan(40);
    expect(count((x) => x.sport === 'hike' || x.sport === 'walk' || x.sport === 'yoga')).toBeGreaterThan(10);
    expect(count((x) => x.subSport === 'track')).toBeGreaterThan(5);
    expect(count((x) => x.subSport === 'trail')).toBeGreaterThan(2);
  });
});
