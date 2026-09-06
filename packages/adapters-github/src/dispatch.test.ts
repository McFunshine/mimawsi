import { describe, expect, it, vi } from 'vitest';
import type { Tool } from '@mimawsi/domain';
import { githubDispatcher, slugFor } from './index.ts';

const tool = (title: string): Tool => ({
  id: { value: 'aaaa-bbbb' },
  metadata: { title, description: 'does a thing', tags: [] },
  maker: 'sub-1',
  sha256: 'abc123',
  sizeBytes: 400,
});

const ok = () => new Response(null, { status: 204 });

describe('slugFor', () => {
  it('makes a readable folder name from the title', () => {
    expect(slugFor(tool('Coin Flip'))).toBe('coin-flip');
    expect(slugFor(tool('  Text   Tidy!  '))).toBe('text-tidy');
  });

  it('folds accents rather than dropping the letters they sit on', () => {
    expect(slugFor(tool('Café Tímer'))).toBe('cafe-timer');
  });

  it('falls back to the id when a title yields nothing usable', () => {
    // "!!!" is an unusual title and a legal one. A folder named "" would fail for
    // reasons that have nothing to do with the cause.
    expect(slugFor(tool('!!!'))).toBe('aaaa-bbbb');
  });

  it('does not end a slug with a hyphen after truncating', () => {
    const slug = slugFor(tool(`${'a'.repeat(59)} bbbb`));
    expect(slug.endsWith('-')).toBe(false);
    expect(slug.length).toBeLessThanOrEqual(60);
  });
});

describe('announcing a publish', () => {
  const notice = {
    tool: tool('Coin Flip'),
    slug: 'coin-flip',
    approvedBy: 'Ada',
    note: 'looks fine',
  };

  it('posts a dispatch to every target and reports which accepted', async () => {
    const fetch = vi.fn(async () => ok());
    const dispatcher = githubDispatcher({
      token: 't',
      targets: [
        { repo: 'o/site', eventType: 'tool-published' },
        { repo: 'o/record', eventType: 'tool-published' },
      ],
      fetch: fetch,
    });

    const accepted = await dispatcher.announce(notice);

    expect([...accepted].sort()).toEqual(['o/record', 'o/site']);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/o/site/dispatches');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer t');
    const body = JSON.parse(init.body as string);
    expect(body.event_type).toBe('tool-published');
    expect(body.client_payload).toMatchObject({
      id: 'aaaa-bbbb',
      slug: 'coin-flip',
      title: 'Coin Flip',
      sha256: 'abc123',
      approvedBy: 'Ada',
      note: 'looks fine',
    });
  });

  it('never carries the tool bytes, so the record has to go and look', async () => {
    const fetch = vi.fn(async () => ok());
    const dispatcher = githubDispatcher({
      token: 't',
      targets: [{ repo: 'o/record', eventType: 'tool-published' }],
      fetch: fetch,
    });

    await dispatcher.announce(notice);

    const body = JSON.parse(
      (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    // The record fetches from the live site instead. A payload carrying both the
    // claim and the evidence would check nothing.
    expect(Object.keys(body.client_payload)).not.toContain('bytes');
    expect(Object.keys(body.client_payload)).not.toContain('html');
  });

  it('stays inside the payload limits GitHub enforces', async () => {
    const fetch = vi.fn(async () => ok());
    const dispatcher = githubDispatcher({
      token: 't',
      targets: [{ repo: 'o/site', eventType: 'tool-published' }],
      fetch: fetch,
    });

    await dispatcher.announce({
      ...notice,
      tool: {
        ...notice.tool,
        metadata: { ...notice.tool.metadata, description: 'x'.repeat(2000) },
      },
      note: 'y'.repeat(4000),
    });

    const body = JSON.parse(
      (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    // A repository_dispatch client_payload takes at most 10 top-level properties
    // and must be under 64KB. Adding an eleventh field would fail at GitHub rather
    // than here, on a publish that had already happened.
    expect(Object.keys(body.client_payload).length).toBeLessThanOrEqual(10);
    expect(JSON.stringify(body.client_payload).length).toBeLessThan(64 * 1024);
  });

  it('does not throw when a dispatch is refused, because the tool is already live', async () => {
    const fetch = vi.fn(async () => new Response('bad credentials', { status: 401 }));
    const log = vi.fn();
    const dispatcher = githubDispatcher({
      token: 'stale',
      targets: [{ repo: 'o/site', eventType: 'tool-published' }],
      fetch: fetch,
      log,
    });

    // Failing the approval here would tell the approver their approval failed when
    // it did not, and invite a second approval of something already published.
    await expect(dispatcher.announce(notice)).resolves.toEqual([]);
    expect(log).toHaveBeenCalled();
  });

  it('does not throw when the network is gone either', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    });
    const dispatcher = githubDispatcher({
      token: 't',
      targets: [{ repo: 'o/site', eventType: 'tool-published' }],
      fetch: fetch,
      log: vi.fn(),
    });

    await expect(dispatcher.announce(notice)).resolves.toEqual([]);
  });

  it('reports the one that worked when the other did not', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes('record') ? new Response('nope', { status: 404 }) : ok(),
    );
    const dispatcher = githubDispatcher({
      token: 't',
      targets: [
        { repo: 'o/site', eventType: 'tool-published' },
        { repo: 'o/record', eventType: 'tool-published' },
      ],
      fetch: fetch as unknown as typeof globalThis.fetch,
      log: vi.fn(),
    });

    // Partial success is the interesting case: the catalogue lists it and the
    // record does not, and the approver is the only person who will know.
    await expect(dispatcher.announce(notice)).resolves.toEqual(['o/site']);
  });

  it('sends nothing at all without a token, and says so rather than failing', async () => {
    const fetch = vi.fn(async () => ok());
    const log = vi.fn();
    const dispatcher = githubDispatcher({
      token: '',
      targets: [{ repo: 'o/site', eventType: 'tool-published' }],
      fetch: fetch,
      log,
    });

    await expect(dispatcher.announce(notice)).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });
});
