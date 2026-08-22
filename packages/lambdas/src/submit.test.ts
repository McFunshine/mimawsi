import { describe, expect, it } from 'vitest';
import { MAX_DESCRIPTION_CHARS, MAX_TITLE_CHARS } from '@mimawsi/domain';
import type { Maker } from '@mimawsi/domain';
import { submit } from './submit.ts';
import type { SubmitDeps } from './submit.ts';

const MAKER: Maker = { id: { value: 'maker-1' }, displayName: 'Maker' };

function deps(): SubmitDeps & { stored: unknown[] } {
  const stored: unknown[] = [];
  return {
    stored,
    identity: { current: async () => MAKER },
    storage: {
      submit: async (input) => {
        stored.push(input);
        return {
          id: { value: 'sub-1' },
          maker: input.maker,
          metadata: input.metadata,
          state: 'pending' as const,
          sha256: 'x',
          sizeBytes: input.bytes.byteLength,
        };
      },
    },
  };
}

describe('submit', () => {
  it('accepts a well-formed submission', async () => {
    const d = deps();
    const result = await submit(d, { title: 'T', description: 'D', html: '<p>hi</p>' });
    expect(result.status).toBe(201);
    expect(d.stored).toHaveLength(1);
  });

  it('refuses an empty body without storing anything', async () => {
    const d = deps();
    const result = await submit(d, {} as never);
    expect(result.status).toBe(400);
    expect(d.stored).toEqual([]);
  });

  it('refuses a blank title and blank html', async () => {
    for (const request of [
      { title: '   ', description: 'd', html: '<p>x</p>' },
      { title: 'T', description: 'd', html: '' },
    ]) {
      const d = deps();
      expect((await submit(d, request)).status).toBe(400);
      expect(d.stored).toEqual([]);
    }
  });

  it('refuses metadata that would bloat the record, however small the file', async () => {
    // A 9-byte tool with a megabyte title passes every size check we had.
    const d = deps();
    const huge = await submit(d, {
      title: 'x'.repeat(MAX_TITLE_CHARS + 1),
      description: 'd',
      html: '<p>hi</p>',
    });
    expect(huge.status).toBe(400);

    const wordy = await submit(d, {
      title: 'T',
      description: 'x'.repeat(MAX_DESCRIPTION_CHARS + 1),
      html: '<p>hi</p>',
    });
    expect(wordy.status).toBe(400);
    expect(d.stored).toEqual([]);
  });

  it('accepts metadata exactly at the bound', async () => {
    const d = deps();
    const result = await submit(d, {
      title: 'x'.repeat(MAX_TITLE_CHARS),
      description: 'x'.repeat(MAX_DESCRIPTION_CHARS),
      html: '<p>hi</p>',
    });
    expect(result.status).toBe(201);
  });

  it('refuses anonymous callers before touching storage', async () => {
    const d = { ...deps(), identity: { current: async () => null } };
    expect((await submit(d, { title: 'T', description: 'd', html: '<p>x</p>' })).status).toBe(401);
  });
});
