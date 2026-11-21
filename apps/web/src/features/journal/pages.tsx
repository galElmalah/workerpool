/**
 * PLACEHOLDER — the journal agent replaces this file. Contract: named export JournalPage.
 */
import { NotebookPen } from 'lucide-react';
import { PlaceholderPage } from '@/shell/Placeholder';

export function JournalPage() {
  return (
    <PlaceholderPage title="Journal" eyebrow="Notes" width="prose" icon={<NotebookPen />}>
      Notes you write on days, workouts and weeks collect here.
    </PlaceholderPage>
  );
}
