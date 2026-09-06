import { describe, expect, it, vi } from 'vitest';
import { MAX_DESCRIPTION_CHARS, MAX_TITLE_CHARS } from '@mimawsi/domain';
import type { Maker } from '@mimawsi/domain';
import { DAILY_SUBMISSION_LIMIT, SUBMISSION_WINDOW_MS } from '@mimawsi/domain';
import { submit } from './submit.ts';
import type { SubmitDeps } from './submit.ts';

const MAKER: Maker = { id: { value: 'maker-1' }, displayName: 'Maker' };

function deps(): SubmitDeps & { stored: unknown[] } {
  const stored: unknown[] = [];
  return {
    stored,
    identity: { current: async () => MAKER },
    storage: {
      countSince: async () => 0,
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

describe('the daily limit', () => {
  const ports = (already: number) => ({
    identity: { current: async () => ({ id: { value: 'maker-1' }, displayName: 'A' }) },
    storage: {
      countSince: vi.fn(async () => already),
      submit: vi.fn(async () => {
        throw new Error('storage.submit must not be reached when over the limit');
      }),
    },
  });

  const body = { title: 'A tool', description: '', html: '<h1>hi</h1>' };

  it('refuses the twenty-first submission in a day', async () => {
    const p = ports(DAILY_SUBMISSION_LIMIT);
    const result = await submit(p, body);

    expect(result.status).toBe(429);
    // Refused before anything is hashed or written, so a flood costs a read rather
    // than a bucket write per attempt.
    expect(p.storage.submit).not.toHaveBeenCalled();
  });

  it('allows the twentieth', async () => {
    const p = ports(DAILY_SUBMISSION_LIMIT - 1);
    p.storage.submit = vi.fn(async () => ({
      id: { value: 'x' },
      maker: { value: 'maker-1' },
      metadata: { title: 'A tool', description: '', tags: [] },
      state: 'pending' as const,
      sha256: 'h',
      sizeBytes: 1,
    }));

    const result = await submit(p, body);
    expect(result.status).toBe(201);
  });

  it('counts over a rolling window, not since midnight', async () => {
    const p = ports(0);
    p.storage.submit = vi.fn(async () => ({
      id: { value: 'x' },
      maker: { value: 'maker-1' },
      metadata: { title: 'A tool', description: '', tags: [] },
      state: 'pending' as const,
      sha256: 'h',
      sizeBytes: 1,
    }));

    const before = Date.now();
    await submit(p, body);

    const since = (p.storage.countSince.mock.calls[0] as unknown as [unknown, Date])[1];
    const window = before - since.getTime();
    // A calendar-day reset would let an account send twice the limit in the few
    // minutes either side of midnight.
    expect(window).toBeGreaterThanOrEqual(SUBMISSION_WINDOW_MS - 5000);
    expect(window).toBeLessThanOrEqual(SUBMISSION_WINDOW_MS + 5000);
  });

  it('tells the caller the limit and when to come back', async () => {
    const result = await submit(ports(DAILY_SUBMISSION_LIMIT), body);
    expect(result.body).toMatchObject({ limit: DAILY_SUBMISSION_LIMIT, retryAfterHours: 24 });
  });
});
