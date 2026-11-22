/** Small formatters for the activity page that the shared `@/lib/format` does not have. */
import type { Sport } from '@cadence/core/domain';
import { formatNumber } from '@/lib/format';
import type { UnitPrefs } from '@/lib/units';

export const tempParts = (c: number, u: UnitPrefs) => (u.system === 'imperial' ? { value: formatNumber(c * 1.8 + 32, 0), unit: '°F' } : { value: formatNumber(c, 0), unit: '°C' });
export const tempValue = (c: number, u: UnitPrefs) => (u.system === 'imperial' ? c * 1.8 + 32 : c);

export const elevValue = (m: number, u: UnitPrefs) => (u.system === 'imperial' ? m / 0.3048 : m);
export const elevUnit = (u: UnitPrefs) => (u.system === 'imperial' ? 'ft' : 'm');

/** "41.9794° N, 2.8214° E" */
export function formatCoords(lat: number, lng: number): string {
  const f = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
  return `${f(lat, 'N', 'S')}, ${f(lng, 'E', 'W')}`;
}

/** Local wall-clock "HH:MM" of an instant plus `plusSec`. */
export function localClock(iso: string, utcOffsetMin: number, plusSec = 0): string {
  const ms = Date.parse(iso) + utcOffsetMin * 60_000 + plusSec * 1000;
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

const BENEFIT: Record<string, string> = {
  RECOVERY: 'Recovery',
  BASE: 'Base',
  AEROBIC_BASE: 'Base',
  TEMPO: 'Tempo',
  LACTATE_THRESHOLD: 'Lactate threshold',
  THRESHOLD: 'Lactate threshold',
  VO2MAX: 'VO2 max',
  ANAEROBIC_CAPACITY: 'Anaerobic capacity',
  SPRINT: 'Sprint',
  NO_BENEFIT: 'No benefit',
};
export const benefitLabel = (k: string) =>
  BENEFIT[k] ?? k.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Garmin's wording for a training-effect score. */
export function effectWord(v: number): string {
  if (v < 1) return 'No benefit';
  if (v < 2) return 'Minor';
  if (v < 3) return 'Maintaining';
  if (v < 4) return 'Improving';
  if (v < 5) return 'Highly improving';
  return 'Overreaching';
}

export const cadenceUnit = (sport: Sport) => (sport === 'bike' ? 'rpm' : 'spm');

/** Tailwind classes for the sport colour (DESIGN_V2 §8) — glyphs and route marks only, never text. */
export const SPORT_TEXT: Record<Sport, string> = {
  bike: 'text-sport-bike',
  run: 'text-sport-run',
  swim: 'text-sport-swim',
  walk: 'text-sport-walk',
  strength: 'text-sport-strength',
  hike: 'text-sport-hike',
  row: 'text-sport-row',
  ski: 'text-sport-ski',
  yoga: 'text-sport-yoga',
  other: 'text-sport-other',
};
export const SPORT_BG: Record<Sport, string> = {
  bike: 'bg-sport-bike',
  run: 'bg-sport-run',
  swim: 'bg-sport-swim',
  walk: 'bg-sport-walk',
  strength: 'bg-sport-strength',
  hike: 'bg-sport-hike',
  row: 'bg-sport-row',
  ski: 'bg-sport-ski',
  yoga: 'bg-sport-yoga',
  other: 'bg-sport-other',
};

/** Zone colour classes z1..z7 (always paired with a label). */
export const ZONE_BG = ['bg-z1', 'bg-z2', 'bg-z3', 'bg-z4', 'bg-z5', 'bg-z6', 'bg-z7'] as const;
export const zoneBg = (zone: number) => ZONE_BG[Math.max(0, Math.min(6, zone - 1))]!;

export const SOURCE_LABEL = { garmin: 'Garmin Connect', upload: 'FIT upload', manual: 'Logged by hand', demo: 'Garmin Connect' } as const;
