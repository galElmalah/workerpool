/**
 * PLACEHOLDER — the library agent replaces this file. Contract: named exports LibraryPage,
 * TemplatePage, BlockPage.
 */
import { getRouteApi } from '@tanstack/react-router';
import { BookCopy, Boxes } from 'lucide-react';
import { PlaceholderPage } from '@/shell/Placeholder';
import { SportGlyph } from '@/ui/domain/SportGlyph';

const tplApi = getRouteApi('/_app/library/$templateId');
const blockApi = getRouteApi('/_app/library/blocks/$blockId');

export function LibraryPage() {
  return (
    <PlaceholderPage title="Library" eyebrow="Templates" icon={<BookCopy />}>
      Folders by sport, search, filters and cards with profile thumbnails — drag one onto a day to schedule it.
    </PlaceholderPage>
  );
}

export function TemplatePage() {
  const { templateId } = tplApi.useParams();
  return (
    <PlaceholderPage title="Template" eyebrow={templateId} back={{ to: '/library' }} icon={<SportGlyph sport="swim" size={24} />}>
      The workout anatomy plus scheduled instances and performance history.
    </PlaceholderPage>
  );
}

export function BlockPage() {
  const { blockId } = blockApi.useParams();
  return (
    <PlaceholderPage title="Training block" eyebrow={blockId} back={{ to: '/library' }} icon={<Boxes />}>
      A mini calendar of the block, ready to apply from any date.
    </PlaceholderPage>
  );
}
