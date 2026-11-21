/**
 * PLACEHOLDER — the workouts agent replaces this file. Contract (src/shell/README.md):
 * named exports WorkoutNewPage, WorkoutPage, WorkoutEditPage.
 */
import { SPORT_META } from '@cadence/core';
import { getRouteApi } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { formatDateMedium } from '@/lib/format';
import { PlaceholderPage } from '@/shell/Placeholder';
import { SportGlyph } from '@/ui/domain/SportGlyph';

const newApi = getRouteApi('/_app/workouts/new');
const wkApi = getRouteApi('/_app/workouts/$id');
const editApi = getRouteApi('/_app/workouts/$id/edit');

export function WorkoutNewPage() {
  const { date, sport } = newApi.useSearch();
  const eyebrow = [sport && SPORT_META[sport].label, date && formatDateMedium(date)].filter(Boolean).join(' · ') || 'Plan';
  return (
    <PlaceholderPage title="New workout" eyebrow={eyebrow} back={{ to: '/calendar' }} width="prose" icon={sport ? <SportGlyph sport={sport} size={24} /> : <Plus />}>
      Sport picker, title, date and the builder (visual ⇄ text) with live load, duration and intensity.
    </PlaceholderPage>
  );
}

export function WorkoutPage() {
  const { id } = wkApi.useParams();
  return (
    <PlaceholderPage title="Workout" eyebrow={id} back={{ to: '/calendar' }} icon={<SportGlyph sport="run" size={24} />}>
      Header, profile graph, steps, planned totals, notes, compliance and Garmin status — all editable in place.
    </PlaceholderPage>
  );
}

export function WorkoutEditPage() {
  const { id } = editApi.useParams();
  return (
    <PlaceholderPage title="Edit workout" eyebrow={id} back={{ to: '/workouts/$id', params: { id } }} icon={<SportGlyph sport="bike" size={24} />}>
      The workout page with the builder focused.
    </PlaceholderPage>
  );
}
