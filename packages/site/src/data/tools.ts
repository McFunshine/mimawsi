import type { Tool } from '@mimawsi/domain';
import published from './published.json';

/**
 * Phase 0: one committed seed tool, plus whatever the publish step has written
 * into published.json. Task-2.2 replaces both with a prebuilt static index
 * generated from storage — the shape stays, only the source changes.
 */
const seedTools: readonly Tool[] = [
  {
    id: { value: 'word-counter' },
    metadata: {
      title: 'Word Counter',
      description:
        'Counts words, characters and lines in whatever you paste. Nothing leaves the page.',
      tags: ['text', 'writing'],
    },
    maker: 'mimawsi',
    sha256: 'seed',
    sizeBytes: 0,
  },
];

export const publishedTools: readonly Tool[] = [...seedTools, ...(published as Tool[])];
