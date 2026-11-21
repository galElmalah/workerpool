/** Dev-only routes: /dev/gallery, /dev/morph, /dev/morph/$id. */
import { SPORT_META } from '@cadence/core';
import { getRouteApi } from '@tanstack/react-router';
import { formatDuration, formatLoad, distanceParts } from '@/lib/format';
import { useUnits } from '@/lib/units';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { ComplianceBar, complianceLabel, ComplianceGlyph } from '@/ui/domain/Compliance';
import { IntensityPips } from '@/ui/domain/Intensity';
import { KeyStar } from '@/ui/domain/KeyStar';
import { MiniProfile } from '@/ui/domain/MiniProfile';
import { SportGlyph } from '@/ui/domain/SportGlyph';
import { WorkoutCard } from '@/ui/domain/WorkoutCard';
import { Page, PageHeader } from '@/ui/PageHeader';
import { Section } from '@/ui/Section';
import { StatTile } from '@/ui/StatTile';
import { byId, MOCK_WORKOUTS } from './mock';

export { GalleryPage } from './Gallery';

export function MorphListPage() {
  return (
    <Page header={<PageHeader title="Morph lab" eyebrow="Card → page" breadcrumb={[{ label: 'Dev', link: { to: '/dev/gallery' } }]} back={{ to: '/dev/gallery' }} />}>
      <Section title="This week" description="Click a card. Back (button, ⌘[ or the browser) reverses the morph and returns focus to the card." variant="micro">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {MOCK_WORKOUTS.map((w) => (
            <WorkoutCard key={w.id} model={w} density="full" link={{ to: '/dev/morph/$id', params: { id: w.id } }} />
          ))}
        </div>
      </Section>
      <Section title="Chips" variant="micro">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
          {MOCK_WORKOUTS.slice(0, 7).map((w) => (
            <WorkoutCard key={w.id} model={w} morphId={`chip-${w.id}`} density="chip" link={{ to: '/dev/morph/$id', params: { id: w.id } }} />
          ))}
        </div>
      </Section>
    </Page>
  );
}

const detailApi = getRouteApi('/_app/dev/morph/$id');

export function MorphDetailPage() {
  const { id } = detailApi.useParams();
  const units = useUnits();
  const w = byId(id) ?? MOCK_WORKOUTS[0]!;
  const state = w.compliance?.state ?? 'planned';
  const dist = w.distanceM ? distanceParts(w.distanceM, w.sport, units) : null;
  return (
    <Page
      header={
        <PageHeader
          morph
          title={w.title}
          glyph={<SportGlyph sport={w.sport} subSport={w.subSport} size={24} />}
          eyebrow={`${SPORT_META[w.sport].label} · Tue 24 Nov`}
          breadcrumb={[{ label: 'Morph lab', link: { to: '/dev/morph' } }]}
          back={{ to: '/dev/morph' }}
          actions={<KeyStar pressed={w.isKey} />}
          meta={
            <>
              <Chip icon={<ComplianceGlyph state={state} />}>{complianceLabel(state, w.skipReason ?? undefined)}</Chip>
              {w.intensity && <Chip icon={<IntensityPips intensity={w.intensity} />}>{w.intensity}</Chip>}
              {w.isKey && <Chip tone="signal">Key</Chip>}
            </>
          }
        />
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Duration" value={w.durationSec ?? 0} format={(v) => formatDuration(v)} />
        <StatTile label="Distance" value={w.distanceM ? Number(dist!.value.replace(/,/g, '')) : null} format={(v) => v.toFixed(1)} unit={dist?.unit} />
        <StatTile label="Load" value={w.load ?? null} format={(v) => formatLoad(v)} signal />
        <StatTile label="Compliance" value={w.compliance?.ratio != null ? w.compliance.ratio * 100 : null} format={(v) => `${Math.round(v)}`} unit="%" />
      </div>
      <Card title="Profile" eyebrow="Planned structure">
        {w.sparkline ? <MiniProfile values={w.sparkline} height={96} /> : <p className="text-body text-fg-3">No structure.</p>}
        {w.compliance?.ratio != null && <ComplianceBar ratio={w.compliance.ratio} state={state} showLabel className="mt-5" />}
      </Card>
    </Page>
  );
}
