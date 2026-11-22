/** Kitchen-sink page for the chart kit (route: /dev/charts; standalone at /charts-gallery.html). */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LocalDate } from '@cadence/core';
import { DEFAULT_FORM_BANDS, FitnessChart, type FitnessSelection } from './FitnessChart';
import { WeeklyBars } from './WeeklyBars';
import { WowDeltaBars, compareWeeks, wowItems, type CompareMode } from './WowDeltaBars';
import { IntensityDistribution, ZoneBars, weeksToSplits } from './IntensityDistribution';
import { PaceCurve, PowerCurve, type CurveSeries } from './PowerCurve';
import { StreamChart, streamStats, type StreamSelection } from './StreamChart';
import { RouteMap } from './RouteMap';
import { IntensityProfile, type ProfileBlock, type ProfileRepeat } from './IntensityProfile';
import { ConsistencyHeatmap } from './ConsistencyHeatmap';
import { MiniArea, SparkBars, Sparkline, SplitBar, SportMixBar } from './Spark';
import { WellnessChart } from './WellnessChart';
import { CompareBars, FormDial, Gauge, ProgressRing, StatBar } from './Gauge';
import { ChartSegmented, DeltaBadge } from './core/controls';
import { Ticker } from './core/animated';
import { ChartFrame } from './core/ChartFrame';
import { createHoverSync, useStreamCursor } from './core/hover';
import { CURVE_DURATIONS, MOCK_TODAY, RIDE_PLAN, mockDays, mockEvents, mockFitness, mockHeatDays, mockPhases, mockPowerCurve, mockRide, mockWeeks, mockWellness, zonesFromPower } from './mock';
import { fmtHM, fmtHMS, fmtKm, fmtNum, fmtSigned } from './format';

function Card({ id, title, question, children, aside, className = '' }: { id: string; title: string; question?: string; children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <section data-chart={id} className={`min-w-0 rounded-lg bg-surface-1 p-5 xl:p-6 ${className}`} style={{ ['--chart-bg' as string]: 'var(--color-surface-1)' }}>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-title-3 text-fg-1">{title}</h2>
          {question && <p className="text-body-sm text-fg-3">{question}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

const DEFAULT_ZONE_LABEL = (form: number) => DEFAULT_FORM_BANDS.find((b) => form > b.min && form <= b.max)?.label ?? '';

const PERIODS = [
  { value: 'season', label: 'Season' },
  { value: '90d', label: '90 d' },
  { value: 'activity', label: 'This ride' },
] as const;

export default function ChartGallery() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const data = useMemo(() => {
    const days = mockDays();
    const fitness = mockFitness(days);
    const weeks = mockWeeks(days, fitness, 26);
    const year = mockWeeks(days, fitness, 52);
    const ride = mockRide();
    const heat = mockHeatDays(days);
    const wellness = mockWellness(120);
    const loads = fitness.filter((f) => !f.projected).map((f) => ({ date: f.date, load: f.load }));
    return { days, fitness, weeks, year, ride, heat, wellness, loads };
  }, []);

  // Activity: synced cursor + selection
  const cursor = useStreamCursor();
  const [sel, setSel] = useState<StreamSelection | null>(null);
  const stats = sel ? streamStats(data.ride.streams, sel.startSec, sel.endSec) : null;

  // Fitness selection
  const [fsel, setFsel] = useState<FitnessSelection | null>(null);
  const dateSync = useMemo(() => createHoverSync<LocalDate>(), []);

  // Peaks: period morph
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['value']>('season');
  const [showCp, setShowCp] = useState(true);
  const curves = useMemo(() => {
    const season = mockPowerCurve(285, 21000, 1050, 18000, 5);
    const d90 = mockPowerCurve(292, 19500, 1010, 9000, 6);
    const all = mockPowerCurve(301, 22500, 1120, 18000, 7);
    const act = mockPowerCurve(268, 16000, 880, 9000, 8).map((p) => ({ ...p, value: p.durationSec > 900 ? p.value * 0.97 : p.value }));
    const primary: CurveSeries = period === 'season' ? { id: 'p', label: 'This season', points: season } : period === '90d' ? { id: 'p', label: 'Last 90 days', points: d90 } : { id: 'p', label: 'This ride', points: act };
    return [{ id: 'all', label: 'All-time', points: all, variant: 'comparison' as const }, { id: 'last90', label: period === '90d' ? 'This season' : 'Last 90 d', points: period === '90d' ? season : d90, variant: 'secondary' as const }, { ...primary, variant: 'primary' as const }];
  }, [period]);
  const paceCurve = useMemo(() => [{ id: 'run', label: 'This season', points: CURVE_DURATIONS.filter((d) => d >= 10 && d <= 10800).map((d) => ({ durationSec: d, value: 3.7 + 3.4 / Math.pow(d / 10, 0.33) })) }, { id: 'prev', label: 'Last season', variant: 'comparison' as const, points: CURVE_DURATIONS.filter((d) => d >= 10 && d <= 10800).map((d) => ({ durationSec: d, value: 3.55 + 3.2 / Math.pow(d / 10, 0.33) })) }], []);

  // Intensity profile builder demo
  const baseBlocks: ProfileBlock[] = useMemo(() => RIDE_PLAN.map((s, i) => ({ id: `b${i}`, startSec: s.startSec, durationSec: s.durationSec, intensity: s.pct, intensityEnd: s.pctEnd, role: s.role, label: s.role === 'active' ? (s.pct > 1.1 ? 'VO2' : s.pct > 0.9 ? 'Threshold' : 'Endurance') : s.role[0].toUpperCase() + s.role.slice(1) })), []);
  const [blocks, setBlocks] = useState<ProfileBlock[]>(baseBlocks);
  const [selBlock, setSelBlock] = useState<string | null>(null);
  const reflow = (bs: Omit<ProfileBlock, 'startSec'>[]): ProfileBlock[] => {
    let t = 0;
    return bs.map((b) => {
      const o = { ...b, startSec: t };
      t += b.durationSec;
      return o;
    });
  };
  const repeats: ProfileRepeat[] = useMemo(() => {
    const out: ProfileRepeat[] = [];
    const thr = blocks.filter((b) => b.label === 'Threshold');
    if (thr.length >= 2) out.push({ id: 'r1', startSec: thr[0].startSec, endSec: thr[thr.length - 1].startSec + thr[thr.length - 1].durationSec + 300, count: thr.length });
    const vo = blocks.filter((b) => b.label === 'VO2');
    if (vo.length >= 2) out.push({ id: 'r2', startSec: vo[0].startSec, endSec: vo[vo.length - 1].startSec + vo[vo.length - 1].durationSec + 180, count: vo.length });
    return out;
  }, [blocks]);

  const baseRepeats: ProfileRepeat[] = [
    { id: 'r1', startSec: RIDE_PLAN[1].startSec, endSec: RIDE_PLAN[6].startSec + RIDE_PLAN[6].durationSec, count: 3 },
    { id: 'r2', startSec: RIDE_PLAN[8].startSec, endSec: RIDE_PLAN[17].startSec + RIDE_PLAN[17].durationSec, count: 5 },
  ];
  const [cmpMode, setCmpMode] = useState<CompareMode>('week');
  const tiles = compareWeeks(data.weeks, cmpMode);
  const last12 = data.weeks.slice(-12);
  const cur = data.weeks[data.weeks.length - 1];
  const prev = data.weeks[data.weeks.length - 2];
  const latestWell = data.wellness[data.wellness.length - 1];
  const todayFit = data.fitness.find((f) => f.date === MOCK_TODAY)!;

  return (
    <div className="min-h-dvh bg-canvas text-fg-1">
      <div className="mx-auto max-w-page px-4 py-8 md:px-6 xl:px-10">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-label text-fg-3">Cadence · dev</p>
            <h1 className="text-title-1 text-fg-1">Chart kit</h1>
            <p className="max-w-prose text-body text-fg-2">Hand-rolled SVG + d3 math + Motion, Canvas for 1 Hz streams. Neutral greys and one accent series per chart. Hover, drag, use the arrow keys.</p>
          </div>
          <ChartSegmented ariaLabel="Theme" value={theme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} onChange={setTheme} />
        </header>

        <div className="grid grid-cols-1 gap-6">
          {/* Row 1: WoW tiles */}
          <section data-chart="tiles" className="min-w-0" style={{ ['--chart-bg' as string]: 'var(--color-surface-1)' }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-title-3">Week over week</h2>
              <ChartSegmented ariaLabel="Compare" value={cmpMode} options={[{ value: 'week', label: 'This week vs last' }, { value: '4v4', label: 'Last 4 vs prior 4' }]} onChange={setCmpMode} />
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 rounded-lg bg-surface-1 p-6 md:grid-cols-3 xl:grid-cols-6">
              {tiles.map((t) => (
                <div key={t.id} className="flex min-w-0 flex-col gap-1">
                  <span className="text-label text-fg-3">{t.label}</span>
                  <span className="flex items-baseline gap-1">
                    <Ticker value={t.current} format={(v) => (t.id === 'hours' ? fmtHM(v * 3600) : fmtNum(v))} className="text-stat-sm text-fg-1" />
                    <span className="text-body-sm text-fg-3">{t.unit}</span>
                  </span>
                  {t.deltaKind === 'pct' ? <DeltaBadge value={t.delta} caution={t.id === 'load' && (t.delta ?? 0) > 0.15} /> : <span className="num text-label text-fg-2">{fmtSigned(t.delta, 1)}</span>}
                </div>
              ))}
            </div>
          </section>

          <Card id="fitness" title="Fitness · Fatigue · Form" question="Is fitness building, and am I fresh or buried right now?">
            <FitnessChart days={data.fitness} today={MOCK_TODAY} events={mockEvents()} phases={mockPhases()} showRamp sync={dateSync} onSelect={setFsel} />
            <div className="mt-4 min-h-6 text-body-sm text-fg-2" aria-live="polite">
              {fsel ? (
                <span className="num">
                  {fsel.from} → {fsel.to} · {fsel.days} d · load {fmtNum(fsel.load)} ({fmtNum(fsel.avgLoad)}/d) · fitness {fmtSigned(fsel.fitnessDelta, 1)} · form ends {fmtNum(fsel.formEnd)}
                </span>
              ) : (
                <span className="text-fg-3">Drag across the chart to measure a block. Double-click or Esc clears.</span>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
            <Card id="weekly" title="Weekly volume" question="How is my volume distributed and trending?">
              <WeeklyBars weeks={data.weeks.slice(-16)} onWeekClick={(w) => console.info('week', w)} />
            </Card>
            <Card id="dials" title="Right now" className="lg:w-80">
              <div className="flex flex-col gap-6">
                <div className="grid grid-cols-2 gap-6">
                  <StatBar label="Form" value={todayFit.form} min={-45} max={35} marker={0} caption={DEFAULT_ZONE_LABEL(todayFit.form)} />
                  <StatBar label="Week done" value={cur.doneSec / 3600} max={Math.max(cur.plannedSec, cur.doneSec) / 3600} format={(v) => fmtHM(v * 3600)} caption={`of ${fmtHM(cur.plannedSec)}`} tone="accent" />
                </div>
                <div className="flex flex-col items-center gap-4">
                  <FormDial value={todayFit.form} zone={todayFit.formZone} size={176} caption={`${fmtSigned(todayFit.form - (data.fitness[data.fitness.findIndex((f) => f.date === MOCK_TODAY) - 7]?.form ?? 0))} vs 7 d ago`} />
                  <div className="flex items-end gap-6">
                    <Gauge value={latestWell.readiness ?? 0} label="Readiness" size={120} />
                    <div className="flex flex-col items-center gap-1 pb-3">
                      <ProgressRing done={cur.doneSec} planned={cur.plannedSec} size={56} />
                      <span className="text-label text-fg-3">Week done</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card id="intensity" title="Intensity distribution" question="Polarized, pyramidal, or drifting into the grey zone?">
              <IntensityDistribution items={weeksToSplits(last12)} />
            </Card>
            <Card id="wow" title="Load, week over week" question="Am I building too fast?">
              <WowDeltaBars items={wowItems(data.weeks.slice(-16), 'load')} />
            </Card>
          </div>

          <Card id="wow-year" title="Load, week over week · 1 year" question="Labels thin out with the bar width; every value is in the tooltip.">
            <WowDeltaBars items={wowItems(data.year, 'load')} />
          </Card>

          <Card
            id="streams"
            title="Activity analysis · Threshold + VO2 ride"
            question="2:30:00 · 1 Hz · power, heart rate, speed, cadence, elevation"
          >
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
              <StreamChart streams={data.ride.streams} laps={data.ride.laps} ftp={data.ride.ftp} cursor={cursor} selection={sel} onSelect={setSel} />
              <div className="flex min-w-0 flex-col gap-4">
                <div className="overflow-hidden rounded-lg">
                  <RouteMap streams={data.ride.streams} cursor={cursor} selection={sel} height={300} elevationShading />
                </div>
                <div data-chart="selection">
                  <div className="mb-3 text-label text-fg-3">{sel ? 'Selection' : 'Drag on the streams to select'}</div>
                  <dl className="grid grid-cols-3 gap-x-4 gap-y-3">
                    {[
                      ['Time', stats ? fmtHMS(stats.durationSec) : '—'],
                      ['Dist', stats?.distanceM != null ? `${fmtKm(stats.distanceM)} km` : '—'],
                      ['Avg W', stats?.avgPower != null ? fmtNum(stats.avgPower) : '—'],
                      ['W. Pwr', stats?.weightedPower != null ? fmtNum(stats.weightedPower) : '—'],
                      ['Avg HR', stats?.avgHr != null ? fmtNum(stats.avgHr) : '—'],
                      ['Gain', stats?.elevationGain != null ? `${fmtNum(stats.elevationGain)} m` : '—'],
                    ].map(([k, v]) => (
                      <div key={k} className="flex flex-col">
                        <dt className="text-label text-fg-3">{k}</dt>
                        <dd className="num text-body-sm text-fg-1">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </div>
            <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-2">
              <div>
                <h3 className="mb-4 text-label text-fg-3">Time in power zones</h3>
                <ZoneBars zones={zonesFromPower(data.ride.streams.power!, data.ride.ftp)} unit="W" targetPct={[0.18, 0.32, 0.1, 0.22, 0.12, 0.04, 0.02]} />
              </div>
              <div>
                <h3 className="mb-4 text-label text-fg-3">Planned structure</h3>
                <IntensityProfile blocks={baseBlocks} repeats={baseRepeats} height={96} />
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card id="power" title="Power curve" question="Where am I strong, and is this season beating the last?" aside={<ChartSegmented size="xs" ariaLabel="Period" value={period} options={PERIODS} onChange={setPeriod} />}>
              <PowerCurve series={curves} weightKg={72.4} model={showCp ? { cp: period === '90d' ? 292 : 285, wPrime: period === '90d' ? 19500 : 21000 } : null} />
              <label className="mt-3 inline-flex items-center gap-2 text-body-sm text-fg-2">
                <input type="checkbox" checked={showCp} onChange={(e) => setShowCp(e.target.checked)} className="accent-(--color-accent)" />
                Critical-power model
              </label>
            </Card>
            <Card id="pace" title="Pace curve" question="Run best efforts, this season vs last.">
              <PaceCurve series={paceCurve} markers={[60, 300, 1200, 3600]} focusSec={1200} />
            </Card>
          </div>

          <Card id="profile" title="Structured workout" question="Builder profile: add, remove and reorder steps; hover a block." aside={
            <div className="flex flex-wrap gap-2">
              <button type="button" className="h-7 rounded-md bg-surface-2 px-3 text-label text-fg-1 hover:bg-surface-3" onClick={() => setBlocks((b) => reflow([...b.slice(0, -1), { id: `n${Date.now()}`, durationSec: 240, intensity: 1.25, role: 'active', label: 'VO2' }, { id: `r${Date.now()}`, durationSec: 240, intensity: 0.5, role: 'recovery', label: 'Recovery' }, b[b.length - 1]]))}>
                Add interval
              </button>
              <button type="button" className="h-7 rounded-md bg-surface-2 px-3 text-label text-fg-1 hover:bg-surface-3" onClick={() => setBlocks((b) => (b.length > 3 ? reflow([...b.slice(0, 1), ...b.slice(3)]) : b))}>
                Remove first set
              </button>
              <button type="button" className="h-7 rounded-md bg-surface-2 px-3 text-label text-fg-1 hover:bg-surface-3" onClick={() => setBlocks((b) => reflow([b[0], ...b.slice(1, -1).reverse(), b[b.length - 1]]))}>
                Reverse middle
              </button>
              <button type="button" className="h-7 rounded-md px-3 text-label text-fg-2 hover:text-fg-1" onClick={() => setBlocks(baseBlocks)}>
                Reset
              </button>
            </div>
          }>
            <IntensityProfile blocks={blocks} repeats={repeats} selectedId={selBlock} onSelect={setSelBlock} height={160} />
            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[baseBlocks, baseBlocks.slice(0, 8), baseBlocks.slice(7), baseBlocks.filter((b) => b.role !== 'active')].map((bs, i) => (
                <div key={i}>
                  <div className="mb-2 flex items-center justify-between text-body-sm">
                    <span className="truncate text-fg-1">{['Threshold + VO2', 'Threshold 3×12', 'VO2 5×3', 'Endurance'][i]}</span>
                    <span className="num text-label text-fg-3">{fmtHM(bs.reduce((a, b) => a + b.durationSec, 0))}</span>
                  </div>
                  <IntensityProfile variant="compact" blocks={reflow(bs)} height={24} />
                </div>
              ))}
            </div>
          </Card>

          <Card id="heatmap" title="Consistency" question="Am I consistent?">
            <ConsistencyHeatmap days={data.heat} today={MOCK_TODAY} onDayClick={(d) => console.info('day', d)} />
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card id="wellness" title="Wellness" question="Is load turning into adaptation, or into fatigue?">
              <WellnessChart days={data.wellness.slice(-90)} loads={data.loads} />
            </Card>
            <div className="flex min-w-0 flex-col gap-6">
              <Card id="compare" title="This vs last">
                <CompareBars
                  items={[
                    { label: 'Hours', current: cur.doneSec / 3600, previous: prev.doneSec / 3600, format: (v) => fmtHM(v * 3600), unit: 'h' },
                    { label: 'Load', current: cur.doneLoad, previous: prev.doneLoad, accent: true },
                    { label: 'Distance', current: cur.doneDistanceM / 1000, previous: prev.doneDistanceM / 1000, unit: 'km' },
                    { label: 'Elevation', current: cur.elevationGainM, previous: prev.elevationGainM, unit: 'm' },
                  ]}
                />
              </Card>
              <Card id="summary" title="Calendar week summary" question="Sparks used in the calendar's weekly column.">
                <div className="flex flex-col gap-6">
                  {data.weeks.slice(-3).map((w) => (
                    <div key={w.isoWeek} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2">
                      <span className="text-label text-fg-3">{w.isoWeek.slice(5)}</span>
                      <span className="num text-body-sm text-fg-1">
                        {fmtHM(w.doneSec)} <span className="text-fg-3">/ {fmtHM(w.plannedSec)} h</span> · {fmtNum(w.doneLoad)} <span className="text-fg-3">/ {fmtNum(w.plannedLoad)}</span>
                      </span>
                      <SparkBars values={w.dailyLoad} planned={w.isProjected ? w.dailyLoad.map((v, i) => (i === 6 ? 120 : v)) : undefined} todayIndex={w.isProjected ? 5 : undefined} />
                      <span />
                      <div className="flex flex-col gap-1">
                        <SportMixBar segments={w.bySport.map((s) => ({ sport: s.sport, value: s.doneSec }))} />
                        <SplitBar {...w.intensitySec} height={4} />
                      </div>
                      <DeltaBadge value={w.wowLoad} flat={0.03} caution={(w.wowLoad ?? 0) > 0.15} />
                    </div>
                  ))}
                  <div className="flex items-center gap-4">
                    <MiniArea values={data.weeks.map((w) => w.fitness)} height={36} tone="accent" />
                    <Sparkline values={data.weeks.map((w) => w.form)} tone="fg" showValue width={80} baseline={0} />
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <Card id="states" title="States" question="Loading skeleton and empty state share the chart's final size.">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <ChartFrame summary="Loading" loading height={140}>
                <div />
              </ChartFrame>
              <WeeklyBars weeks={[]} height={76} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
