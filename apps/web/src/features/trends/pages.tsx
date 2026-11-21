/**
 * PLACEHOLDER — the trends agent replaces this file. Contract (src/shell/README.md):
 * named exports TrendsPage, TrendsFitnessPage, TrendsVolumePage, TrendsIntensityPage,
 * TrendsPeaksPage, TrendsWellnessPage, TrendsSportPage.
 */
import { SPORT_META } from '@cadence/core';
import { getRouteApi } from '@tanstack/react-router';
import { ChartSpline, Gauge, HeartPulse, Mountain, Signal, Waves } from 'lucide-react';
import type { ReactNode } from 'react';
import { PlaceholderPage } from '@/shell/Placeholder';
import { NavTabs } from '@/ui/Tabs';

const sportApi = getRouteApi('/_app/trends/sport/$sport');

function TrendsTabs() {
  return (
    <NavTabs
      aria-label="Trends sections"
      items={[
        { to: '/trends', label: 'Overview', exact: true },
        { to: '/trends/fitness', label: 'Fitness' },
        { to: '/trends/volume', label: 'Volume' },
        { to: '/trends/intensity', label: 'Intensity' },
        { to: '/trends/peaks', label: 'Peaks' },
        { to: '/trends/wellness', label: 'Wellness' },
      ]}
    />
  );
}

function T({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <PlaceholderPage title={title} eyebrow="Trends · last 12 weeks" icon={icon} top={<TrendsTabs />}>
      {children}
    </PlaceholderPage>
  );
}

export function TrendsPage() {
  return (
    <T title="Trends" icon={<ChartSpline />}>
      Week-over-week tiles, Fitness &amp; Form, weekly volume by sport, intensity distribution and consistency.
    </T>
  );
}
export const TrendsFitnessPage = () => (
  <T title="Fitness" icon={<Gauge />}>
    Fitness, Fatigue and Form with projection, form zones, ramp rate and event overlays.
  </T>
);
export const TrendsVolumePage = () => (
  <T title="Volume" icon={<ChartSpline />}>
    Weekly and monthly volume by sport, rolling averages and a per-sport totals table.
  </T>
);
export const TrendsIntensityPage = () => (
  <T title="Intensity" icon={<Signal />}>
    Weekly easy / moderate / hard split and time in zone per sport.
  </T>
);
export const TrendsPeaksPage = () => (
  <T title="Peaks" icon={<Mountain />}>
    Power, pace, swim and row curves by season with the records table and threshold history.
  </T>
);
export const TrendsWellnessPage = () => (
  <T title="Wellness" icon={<HeartPulse />}>
    HRV, resting HR, sleep, weight and feel against their baselines.
  </T>
);
export function TrendsSportPage() {
  const { sport } = sportApi.useParams();
  return (
    <T title={SPORT_META[sport].label} icon={<Waves />}>
      Sport-specific volume, peaks and efficiency trends.
    </T>
  );
}
