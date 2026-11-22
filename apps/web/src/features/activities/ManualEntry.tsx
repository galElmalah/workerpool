/**
 * Inline "Log activity" form (no modal): sport, date, duration, distance, RPE, note → Load is
 * estimated from RPE × duration live, and the server computes the real value on save.
 */
import { SPORT_META, type LocalDate, type Sport } from '@cadence/core/domain';
import { rpeLoad } from '@cadence/core/metrics';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, DatePicker, DurationField, Field, Input, NumberField, RpeSlider, SportGlyph, Textarea, toast } from '@/ui';
import { Ticker } from '@/motion/Ticker';
import { cn } from '@/lib/cn';
import { distanceUnit, useUnits } from '@/lib/units';
import { links } from '@/shell/links';
import { useManualActivity } from './data';

const SPORTS: Sport[] = ['bike', 'run', 'swim', 'row', 'strength', 'hike', 'walk', 'yoga', 'other'];

export function ManualEntry({ today, onDone }: { today?: LocalDate; onDone: () => void }) {
  const units = useUnits();
  const navigate = useNavigate();
  const create = useManualActivity();
  const [sport, setSport] = useState<Sport>('run');
  const [date, setDate] = useState<LocalDate | null>(today ?? null);
  const [dur, setDur] = useState<number | null>(3600);
  const [dist, setDist] = useState<number | null>(null);
  const [rpe, setRpe] = useState<number | null>(5);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const du = distanceUnit(sport, units);
  const load = dur && rpe ? rpeLoad(rpe, dur) : 0;
  const valid = !!date && !!dur && dur > 0;
  const submit = async () => {
    if (!valid) return;
    try {
      const a = await create.mutateAsync({
        localDate: date!,
        sport,
        title: title.trim() || SPORT_META[sport].label,
        durationSec: dur!,
        ...(dist && SPORT_META[sport].hasDistance ? { distanceM: dist * du.mPer } : {}),
        ...(rpe ? { rpe } : {}),
        ...(note.trim() ? { postNote: note.trim() } : {}),
      });
      toast.success(<>Logged <b>{a.title}</b></>);
      onDone();
      void navigate(links.activity(a.id));
    } catch (e) {
      toast.error(<>Couldn’t log it: {(e as Error).message}</>);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-5 rounded-xl border border-line-3 bg-surface-1 p-4 md:p-5"
      aria-label="Log an activity"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-title-3 text-fg-1">Log an activity</h2>
        <span className="flex items-baseline gap-1.5">
          <span className="text-micro uppercase text-fg-3">Est. load</span>
          <span className="text-stat-sm text-accent-ink"><Ticker value={load} format={(n) => String(Math.round(n))} /></span>
        </span>
      </div>
      <div role="radiogroup" aria-label="Sport" className="flex flex-wrap gap-1.5">
        {SPORTS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={sport === s}
            onClick={() => setSport(s)}
            className={cn('flex h-9 items-center gap-2 rounded-md border px-3 text-label transition-colors duration-(--dur-fast)', sport === s ? 'border-line-3 bg-surface-3 text-fg-1' : 'border-line-1 text-fg-2 hover:bg-surface-2 hover:text-fg-1')}
          >
            <SportGlyph sport={s} size={16} />
            {SPORT_META[s].label}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.currentTarget.value)} placeholder={SPORT_META[sport].label} />
        </Field>
        <DatePicker label="Date" value={date} onValueChange={setDate} max={today} />
        <DurationField label="Duration" value={dur} onValueChange={setDur} />
        {SPORT_META[sport].hasDistance ? (
          <NumberField label="Distance" value={dist} onValueChange={setDist} unit={du.unit} min={0} step={du.unit === 'm' || du.unit === 'yd' ? 50 : 0.5} />
        ) : (
          <div />
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <RpeSlider value={rpe} onValueChange={setRpe} />
        <label className="flex flex-col gap-1.5">
          <span className="text-label text-fg-2">Note</span>
          <Textarea value={note} onChange={(e) => setNote(e.currentTarget.value)} minRows={2} placeholder="How it went" />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!valid} loading={create.isPending}>Save activity</Button>
      </div>
    </form>
  );
}
