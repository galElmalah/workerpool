/**
 * PLACEHOLDER — the activities agent replaces this file. Contract (src/shell/README.md):
 * named exports ActivitiesPage, ActivityPage, ActivityComparePage.
 */
import { getRouteApi } from '@tanstack/react-router';
import { Columns2, History } from 'lucide-react';
import { PlaceholderPage } from '@/shell/Placeholder';
import { SportGlyph } from '@/ui/domain/SportGlyph';

const actApi = getRouteApi('/_app/activities/$id');
const cmpApi = getRouteApi('/_app/activities/$id/compare');

export function ActivitiesPage() {
  return (
    <PlaceholderPage title="Activities" eyebrow="All sports" icon={<History />}>
      A searchable table of every completed session with filters, configurable columns and a totals row.
    </PlaceholderPage>
  );
}

export function ActivityPage() {
  const { id } = actApi.useParams();
  return (
    <PlaceholderPage title="Activity" eyebrow={id} back={{ to: '/activities' }} icon={<SportGlyph sport="bike" size={24} />}>
      Summary grid, map, synced streams with selection stats, laps, zones, peaks and plan comparison.
    </PlaceholderPage>
  );
}

export function ActivityComparePage() {
  const { id } = cmpApi.useParams();
  return (
    <PlaceholderPage title="Compare" eyebrow={id} back={{ to: '/activities/$id', params: { id } }} icon={<Columns2 />}>
      Overlaid traces, aligned intervals and a delta table.
    </PlaceholderPage>
  );
}
