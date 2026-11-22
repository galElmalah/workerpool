/**
 * /workouts/new?date=&sport=&from=&text= — a calm single page: sport grid (morphs into the header
 * glyph), title (auto until edited), date + time, the builder (or a simple duration form), metadata
 * and notes, live totals, a "start from a template" strip. ⌘↵ saves and morphs to the workout page.
 */
import { INTENSITY_META, type IntensityClass, type PlannedWorkoutInput, type Sport, type SubSport, type Template, type WorkoutStructure } from '@cadence/core';
import {
  autoTitle,
  autoTitleUnstructured,
  classifyPlannedIntensity,
  estimateUnstructured,
  estimateWorkout,
  parseQuickAdd,
  reassignIds,
} from '@cadence/core/workout';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { LayoutGrid, Library, Plus, Watch } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  DatePicker,
  DurationField,
  Field,
  Input,
  IntensityPicker,
  KeyStar,
  Page,
  PageHeader,
  Section,
  Segmented,
  SportGlyph,
  TagInput,
  Textarea,
  toast,
} from '@/ui';
import { cn } from '@/lib/cn';
import { formatDateMedium } from '@/lib/format';
import { useToday } from '@/lib/hooks';
import { useCreateWorkout } from '@/lib/queries/training';
import { links } from '@/shell/links';
import { useShortcut } from '@/shell/shortcuts';
import { morph } from '@/motion/morph';
import { spring } from '@/motion/tokens';
import { Builder, GarminLine } from './builder/Builder';
import { formatMeters, parseMeters } from './builder/fields';
import { STRUCTURED_SPORTS, presetNode, useThresholdsOn } from './model';
import { SportGrid, SubSportChips, TemplateMini, TotalsTiles } from './parts';
import { useCreateTemplate, useGarminPush, useTemplate, useTemplates, useWorkout } from './queries';
import { useUnits } from '@/lib/units';

const route = getRouteApi('/_app/workouts/new');

export function WorkoutNewPage() {
  const search = route.useSearch();
  const navigate = useNavigate();
  const units = useUnits();
  const localToday = useToday();

  const [sport, setSport] = useState<Sport | undefined>(search.sport);
  const [subSport, setSubSport] = useState<SubSport | undefined>();
  const { thresholds, today: apiToday } = useThresholdsOn(sport ?? 'bike', search.date);
  const today = apiToday ?? localToday;
  const [date, setDate] = useState<string>(search.date ?? '');
  useEffect(() => {
    if (!date && today) setDate(today);
  }, [today, date]);
  const [startTime, setStartTime] = useState('');
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [structure, setStructure] = useState<WorkoutStructure>({ steps: [] });
  const [mode, setMode] = useState<'structured' | 'simple'>(search.sport && !STRUCTURED_SPORTS.has(search.sport) ? 'simple' : 'structured');
  const [durationSec, setDurationSec] = useState<number | null>(3600);
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [intensity, setIntensity] = useState<IntensityClass>('endurance');
  const [intensityEdited, setIntensityEdited] = useState(false);
  const [isKey, setIsKey] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [environment, setEnvironment] = useState<'indoor' | 'outdoor' | 'any'>('any');
  const [description, setDescription] = useState('');
  const [preNote, setPreNote] = useState('');
  const [templateId, setTemplateId] = useState<string | undefined>();

  // ── prefill (?from=, ?text=) ──
  const fromTpl = useTemplate(search.from?.startsWith('tpl_') ? search.from : undefined);
  const fromWk = useWorkout(search.from && !search.from.startsWith('tpl_') ? search.from : '');
  const prefilled = useRef(false);
  const applyTemplate = (t: Pick<Template, 'sport' | 'subSport' | 'title' | 'description' | 'structure' | 'intensity' | 'tags' | 'plannedDurationSec' | 'plannedDistanceM'> & { id?: string }) => {
    setSport(t.sport);
    setSubSport(t.subSport);
    setTitle(t.title);
    setTitleEdited(true);
    setDescription(t.description ?? '');
    setIntensity(t.intensity);
    setIntensityEdited(true);
    setTags(t.tags.filter((x) => x !== 'key'));
    setIsKey(t.tags.includes('key'));
    if (t.structure?.steps.length) {
      setStructure(reassignIds(t.structure));
      setMode('structured');
    } else {
      setStructure({ steps: [] });
      setMode('simple');
      setDurationSec(t.plannedDurationSec ?? 3600);
      setDistanceM(t.plannedDistanceM ?? null);
    }
    if (t.id?.startsWith('tpl_')) setTemplateId(t.id);
  };
  useEffect(() => {
    if (prefilled.current) return;
    if (fromTpl.data) {
      prefilled.current = true;
      applyTemplate(fromTpl.data);
    } else if (fromWk.data) {
      prefilled.current = true;
      applyTemplate(fromWk.data);
      setIsKey(fromWk.data.isKey);
      setPreNote(fromWk.data.preNote ?? '');
    } else if (search.text && !search.from) {
      prefilled.current = true;
      const q = parseQuickAdd(search.text, { defaultSport: search.sport, thresholds });
      setSport(q.sport);
      setSubSport(q.subSport);
      setIsKey(q.isKey);
      setTags(q.tags);
      setIntensity(q.intensity);
      if (q.structure) {
        setStructure(q.structure);
        setMode('structured');
      } else {
        setMode('simple');
        if (q.durationSec) setDurationSec(q.durationSec);
        if (q.distanceM) setDistanceM(q.distanceM);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromTpl.data, fromWk.data, search.text]);

  const pickSport = (s: Sport) => {
    setSport(s);
    setSubSport(undefined);
    if (!STRUCTURED_SPORTS.has(s)) setMode('simple');
    else {
      setMode('structured');
      if (!structure.steps.length) setStructure(s === 'strength' ? { steps: [] } : { steps: [presetNode('warmup', s) as WorkoutStructure['steps'][number]], ...(s === 'swim' ? { poolLengthM: 25 } : {}) });
    }
  };

  // ── derived ──
  const structured = mode === 'structured' && structure.steps.length > 0;
  const s = sport ?? 'bike';
  const estimate = useMemo(() => estimateWorkout(structure, s, thresholds), [structure, s, thresholds]);
  const suggested = useMemo(() => (structured ? classifyPlannedIntensity(structure, s, thresholds) : null), [structured, structure, s, thresholds]);
  const effIntensity = !intensityEdited && suggested ? suggested.intensity : intensity;
  const simple = useMemo(() => estimateUnstructured(durationSec ?? undefined, effIntensity, s, { distanceM: distanceM ?? undefined, thresholds }), [durationSec, distanceM, effIntensity, s, thresholds]);
  const totals = structured
    ? { durationSec: estimate.durationSec, distanceM: estimate.distanceM, load: estimate.load, intensityFactor: estimate.intensityFactor }
    : { durationSec: simple.durationSec || undefined, distanceM: distanceM ?? undefined, load: simple.load, intensityFactor: simple.intensityFactor };
  const autoT = sport ? (structured ? autoTitle(structure, s, thresholds) : autoTitleUnstructured({ sport: s, durationSec: durationSec ?? undefined, distanceM: distanceM ?? undefined, intensity: effIntensity })) : '';
  const shownTitle = titleEdited ? title : autoT;

  // ── save ──
  const create = useCreateWorkout();
  const push = useGarminPush();
  const createTpl = useCreateTemplate();
  const input = (): PlannedWorkoutInput | null => {
    if (!sport || !date) return null;
    return {
      date,
      ...(startTime ? { startTime } : {}),
      sport,
      ...(subSport ? { subSport } : {}),
      title: shownTitle || autoT,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(preNote.trim() ? { preNote: preNote.trim() } : {}),
      ...(structured ? { structure } : { ...(durationSec ? { plannedDurationSec: durationSec } : {}), ...(distanceM ? { plannedDistanceM: distanceM } : {}) }),
      isKey,
      intensity: effIntensity,
      tags,
      environment,
      ...(templateId ? { templateId } : {}),
    };
  };
  const save = async (then?: 'garmin') => {
    const body = input();
    if (!body) return toast('Pick a sport first');
    try {
      const w = await create.mutateAsync(body);
      morph.set(w.id);
      navigate({ ...links.workout(w.id), replace: true });
      if (then === 'garmin')
        void toast
          .promise(push.mutateAsync(w.id), { loading: 'Sending to Garmin…', success: <>On your Garmin · <b>{w.title}</b></>, error: (e) => `Garmin push failed: ${(e as Error).message}` })
          .catch(() => undefined);
      else toast.success(<>Planned <b>{w.title}</b> · {formatDateMedium(w.date)}</>);
    } catch (e) {
      toast.error(`Couldn’t save: ${(e as Error).message}`);
    }
  };
  const saveToLibrary = async () => {
    if (!sport) return;
    try {
      const t = await createTpl.mutateAsync({
        sport,
        ...(subSport ? { subSport } : {}),
        title: shownTitle || autoT,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(structured ? { structure } : { ...(durationSec ? { plannedDurationSec: durationSec } : {}), ...(distanceM ? { plannedDistanceM: distanceM } : {}) }),
        intensity: effIntensity,
        tags: isKey ? [...tags, 'key'] : tags,
      });
      toast.success(<>Saved <b>{t.title}</b> to the library</>, { action: { label: 'Open', onClick: () => navigate(links.template(t.id)) } });
    } catch (e) {
      toast.error(`Couldn’t save: ${(e as Error).message}`);
    }
  };
  useShortcut('workout.save', () => void save(), { allowInInputs: true });

  const header = (
    <PageHeader
      morph={!!sport}
      back={search.date ? links.calendarDay(search.date) : links.calendar()}
      eyebrow={date ? `New workout · ${formatDateMedium(date)}` : 'New workout'}
      glyph={
        sport ? (
          <motion.span layoutId={`sport-glyph-${sport}`} transition={spring.smooth} className="flex">
            <SportGlyph sport={sport} subSport={subSport} size={24} />
          </motion.span>
        ) : undefined
      }
      titleText={shownTitle || 'New workout'}
      title={
        sport ? (
          <input
            aria-label="Title"
            value={shownTitle}
            placeholder="Title"
            onChange={(e) => {
              setTitle(e.currentTarget.value);
              setTitleEdited(true);
            }}
            onBlur={() => !title.trim() && setTitleEdited(false)}
            className="field-sizing-content max-w-full min-w-[6ch] bg-transparent text-fg-1 outline-none placeholder:text-fg-4 focus-visible:underline focus-visible:decoration-line-3 focus-visible:underline-offset-8"
          />
        ) : (
          'New workout'
        )
      }
      actions={
        <>
          <Button size="sm" variant="ghost" icon={<Library />} onClick={saveToLibrary} disabled={!sport} className="max-md:hidden">
            Save to library
          </Button>
          <Button size="sm" variant="secondary" icon={<Watch />} onClick={() => save('garmin')} disabled={!sport} className="max-sm:hidden">
            Save & send
          </Button>
          <Button size="sm" variant="primary" kbd="mod+enter" loading={create.isPending} onClick={() => save()} disabled={!sport}>
            Save
          </Button>
        </>
      }
    />
  );

  return (
    <LayoutGroup>
      <Page header={header}>
        <Section title={sport ? undefined : 'What are you training?'}>
          <AnimatePresence mode="popLayout" initial={false}>
            {!sport ? (
              <motion.div key="grid" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                <SportGrid onPick={pickSport} />
              </motion.div>
            ) : (
              <motion.div key="bar" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth} className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" variant="ghost" icon={<LayoutGrid />} onClick={() => setSport(undefined)}>
                    Change sport
                  </Button>
                  <SubSportChips sport={sport} value={subSport} onChange={setSubSport} />
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3 sm:grid-cols-[14rem_8rem]">
                  <DatePicker label="Date" value={date || null} onValueChange={setDate} />
                  <Field label="Start time">
                    <Input type="time" value={startTime} onChange={(e) => setStartTime(e.currentTarget.value)} aria-label="Start time" />
                  </Field>
                </div>
                <TemplateStrip sport={sport} thresholds={thresholds} onPick={applyTemplate} />
              </motion.div>
            )}
          </AnimatePresence>
        </Section>

        {sport && (
          <>
            <Section
              title={sport === 'strength' ? 'Exercises' : 'Structure'}
              actions={
                STRUCTURED_SPORTS.has(sport) || mode === 'structured' ? (
                  <Segmented
                    size="sm"
                    aria-label="Workout type"
                    value={mode}
                    onValueChange={(m) => {
                      setMode(m);
                      if (m === 'structured' && !structure.steps.length && sport !== 'strength') setStructure({ steps: [presetNode('warmup', sport) as WorkoutStructure['steps'][number]] });
                    }}
                    options={[
                      { value: 'structured', label: 'Structured' },
                      { value: 'simple', label: 'Simple' },
                    ]}
                  />
                ) : (
                  <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setMode('structured')}>
                    Add steps
                  </Button>
                )
              }
            >
              {mode === 'structured' ? (
                <Builder sport={sport} subSport={subSport} structure={structure} onChange={setStructure} thresholds={thresholds} estimate={estimate} />
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                    <DurationField label="Duration" value={durationSec} onValueChange={setDurationSec} />
                    {['run', 'bike', 'swim', 'row', 'hike', 'walk', 'ski'].includes(sport) && (
                      <Field label="Distance">
                        <Input
                          defaultValue={distanceM ? formatMeters(distanceM, sport, units) : ''}
                          placeholder={sport === 'swim' ? '2500 m' : '10 km'}
                          onBlur={(e) => setDistanceM(e.currentTarget.value.trim() ? parseMeters(e.currentTarget.value, sport) : null)}
                          className="text-right font-mono"
                        />
                      </Field>
                    )}
                  </div>
                  <p className="text-body-sm text-fg-3">Load is estimated from duration and intensity. Add steps any time for a precise target profile.</p>
                  <GarminLine sport={sport} subSport={subSport} />
                </div>
              )}
            </Section>

            <Section>
              <TotalsTiles totals={totals} sport={sport} />
            </Section>

            <Section title="Details" variant="micro">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="flex flex-col gap-5">
                  <div className="flex flex-wrap items-start gap-6">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-label text-fg-2">Intensity {!intensityEdited && suggested && <span className="text-fg-3">· auto</span>}</span>
                      <IntensityPicker
                        value={effIntensity}
                        onValueChange={(v) => {
                          setIntensity(v);
                          setIntensityEdited(true);
                        }}
                      />
                      {suggested && (
                        <span className="text-body-sm text-fg-3">
                          {intensityEdited && suggested.intensity !== intensity ? (
                            <button type="button" className="underline underline-offset-3 hover:text-fg-1" onClick={() => setIntensityEdited(false)}>
                              Suggested: {INTENSITY_META[suggested.intensity].label}
                            </button>
                          ) : (
                            suggested.reason
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-label text-fg-2">Key session</span>
                      <div className="flex h-8 items-center gap-2">
                        <KeyStar pressed={isKey} onPressedChange={setIsKey} />
                        <span className={cn('text-body-sm', isKey ? 'text-accent-ink' : 'text-fg-3')}>{isKey ? 'Main workout of the week' : 'Mark as a main workout'}</span>
                      </div>
                    </div>
                    {sport !== 'strength' && sport !== 'yoga' && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-label text-fg-2">Where</span>
                        <Segmented
                          size="sm"
                          aria-label="Environment"
                          value={environment}
                          onValueChange={setEnvironment}
                          options={[
                            { value: 'any', label: 'Any' },
                            { value: 'indoor', label: 'Indoor' },
                            { value: 'outdoor', label: 'Outdoor' },
                          ]}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-label text-fg-2">Tags</span>
                    <TagInput value={tags} onValueChange={setTags} aria-label="Tags" suggestions={['vo2', 'threshold', 'long', 'hills', 'brick', 'recovery', 'race-pace', 'technique']} />
                  </div>
                </div>
                <div className="flex flex-col gap-4">
                  <Field label="Pre-workout note">
                    <Textarea value={preNote} minRows={2} onChange={(e) => setPreNote(e.currentTarget.value)} placeholder="Intent for the day — “legs heavy, keep it honest”" />
                  </Field>
                  <Field label="Description & coaching cues">
                    <Textarea value={description} minRows={3} onChange={(e) => setDescription(e.currentTarget.value)} placeholder="Purpose, cues, fuelling…" />
                  </Field>
                </div>
              </div>
            </Section>
          </>
        )}
      </Page>
    </LayoutGroup>
  );
}

function TemplateStrip({ sport, thresholds, onPick }: { sport: Sport; thresholds: Parameters<typeof TemplateMini>[0]['thresholds']; onPick: (t: Template) => void }) {
  const q = useTemplates();
  const list = useMemo(
    () =>
      (q.data ?? [])
        .filter((t) => t.sport === sport)
        .sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') || b.usageCount - a.usageCount)
        .slice(0, 12),
    [q.data, sport],
  );
  const [open, setOpen] = useState(false);
  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex h-9 items-center gap-2 self-start rounded-md border border-line-2 px-3 text-label text-fg-2 transition-colors hover:border-line-3 hover:text-fg-1">
        <Library className="size-4" /> Start from a template
        <span className="font-mono text-mono-sm text-fg-4">{list.length || ''}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring.smooth} className="overflow-hidden">
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pt-1 pb-2">
              {list.map((t) => (
                <motion.button
                  key={t.id}
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  transition={spring.snappy}
                  onClick={() => {
                    onPick(t);
                    setOpen(false);
                  }}
                  className="spotlight w-60 shrink-0 rounded-lg border border-line-1 bg-surface-1 p-3 text-left transition-colors hover:border-line-3 hover:bg-surface-2"
                >
                  <TemplateMini t={t} thresholds={thresholds} />
                </motion.button>
              ))}
              {!list.length && <span className="py-3 text-body-sm text-fg-3">{q.isPending ? 'Loading templates…' : 'No templates for this sport yet.'}</span>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
