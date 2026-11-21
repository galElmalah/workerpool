/** Kitchen-sink page for the chart kit (route: /dev/charts). */
import { useMemo } from 'react';
import { FitnessChart } from './FitnessChart';
import { MOCK_TODAY, mockDays, mockEvents, mockFitness, mockPhases } from './mock';

export default function ChartGallery() {
  const data = useMemo(() => {
    const days = mockDays();
    const fitness = mockFitness(days);
    return { days, fitness };
  }, []);
  return (
    <div className="mx-auto max-w-page px-4 py-10 md:px-6 xl:px-10">
      <section data-chart="fitness" className="rounded-xl border border-line-2 bg-surface-1 p-5">
        <FitnessChart days={data.fitness} today={MOCK_TODAY} events={mockEvents()} phases={mockPhases()} showRamp onSelect={() => {}} />
      </section>
    </div>
  );
}
