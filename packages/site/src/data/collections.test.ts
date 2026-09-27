import type { Collection, Curation, Tool } from '@mimawsi/domain';
import { describe, expect, it } from 'vitest';

import {
  COLLECTIONS,
  catalogueTools,
  listedCollections,
  resolveAll,
  resolveCollection,
  resolveMembers,
} from './collections';

/**
 * The resolver is exercised against a fixture catalogue, not the real one: the real
 * one changes every time a tool is published, and a test asserting on it would fail
 * for reasons that are not bugs.
 *
 * What is asserted against the real registry is only what must hold whatever it
 * contains — usable slugs, no duplicates, `listed` obeyed. Whether a pinned id is
 * actually published is checked by the build itself, in [collection].astro, because
 * that is where the working catalogue is the source.
 */
function tool(id: string, title: string, curation?: Curation): Tool {
  return {
    id: { value: id },
    metadata: { title, description: `${title} does a thing.`, tags: [] },
    maker: 'operator',
    sha256: 'x',
    sizeBytes: 1,
    ...(curation ? { curation } : {}),
  };
}

const inDina: Curation = { collections: ['dina'], hidden: false };
const inDinaHidden: Curation = { collections: ['dina'], hidden: true };

const catalogue: readonly Tool[] = [
  tool('alpha', 'Alpha', inDina),
  tool('beta', 'Beta'),
  tool('gamma', 'Gamma', inDinaHidden),
  tool('delta', 'Delta', { collections: ['other'], hidden: false }),
];

const collection = (over: Partial<Collection> = {}): Collection => ({
  slug: 'dina',
  title: 'Fixture',
  blurb: 'A collection made in a test.',
  listed: true,
  ...over,
});

describe('membership assigned at approval', () => {
  it('takes every tool whose curation names the collection', () => {
    const { tools } = resolveMembers(collection(), catalogue);
    expect(tools.map((t) => t.id.value)).toEqual(['alpha', 'gamma']);
  });

  it('includes a hidden tool — hidden removes it from the front page, not from its collection', () => {
    const { tools } = resolveMembers(collection(), catalogue);
    expect(tools.map((t) => t.id.value)).toContain('gamma');
  });

  it('ignores a tool assigned to some other collection', () => {
    const { tools } = resolveMembers(collection(), catalogue);
    expect(tools.map((t) => t.id.value)).not.toContain('delta');
  });

  it('ignores a tool with no curation at all', () => {
    const { tools } = resolveMembers(collection(), catalogue);
    expect(tools.map((t) => t.id.value)).not.toContain('beta');
  });

  it('resolves a collection nothing is assigned to as empty, not as an error', () => {
    expect(resolveMembers(collection({ slug: 'nobody-assigned-here' }), catalogue).tools).toEqual(
      [],
    );
  });
});

describe('pinned membership', () => {
  it('puts pinned tools first, in the order given, ahead of assigned ones', () => {
    const { tools } = resolveMembers(collection({ pinned: ['beta'] }), catalogue);
    expect(tools.map((t) => t.id.value)).toEqual(['beta', 'alpha', 'gamma']);
  });

  it('keeps the pinned order even when it reverses the catalogue', () => {
    const { tools } = resolveMembers(collection({ pinned: ['delta', 'beta'] }), catalogue);
    expect(tools.map((t) => t.id.value).slice(0, 2)).toEqual(['delta', 'beta']);
  });

  it('shows a tool that is both pinned and assigned exactly once, in its pinned place', () => {
    const { tools } = resolveMembers(collection({ pinned: ['gamma'] }), catalogue);
    expect(tools.map((t) => t.id.value)).toEqual(['gamma', 'alpha']);
  });

  it('names a pinned id that is not published instead of dropping it silently', () => {
    const { tools, missing } = resolveMembers(collection({ pinned: ['ghost'] }), catalogue);
    expect(missing).toEqual(['ghost']);
    expect(tools.map((t) => t.id.value)).toEqual(['alpha', 'gamma']);
  });

  it('reports no missing members when nothing is pinned', () => {
    expect(resolveMembers(collection(), catalogue).missing).toEqual([]);
  });
});

describe('hidden tools and the front page', () => {
  it('leaves a hidden tool out of catalogueTools', () => {
    expect(catalogueTools.map((t) => t.id.value)).not.toContain('gamma');
  });

  it('keeps every tool that is not hidden', () => {
    // Against the real catalogue: nothing live is hidden yet, so the two agree.
    const hiddenLive = catalogueTools.filter((t) => t.curation?.hidden);
    expect(hiddenLive).toEqual([]);
  });
});

describe('the registry', () => {
  it('all resolves, so every slug is a usable, unreserved, unique URL segment', () => {
    expect(() => resolveAll(catalogue)).not.toThrow();
    expect(resolveAll(catalogue)).toHaveLength(COLLECTIONS.length);
  });

  it('lists exactly those marked listed', () => {
    expect(listedCollections.map((c) => c.slug)).toEqual(
      COLLECTIONS.filter((c) => c.listed).map((c) => c.slug),
    );
    expect(listedCollections.every((c) => c.listed)).toBe(true);
  });

  it('ships dina, unlisted, with Villa Prisma pinned into it', () => {
    const dina = COLLECTIONS.find((c) => c.slug === 'dina');
    expect(dina?.listed).toBe(false);
    expect(dina?.pinned).toContain('9cdb82ff-2719-485e-8a81-94dbbe60258c');
    expect(listedCollections.map((c) => c.slug)).not.toContain('dina');
  });

  it('resolves dina against the real catalogue with nothing missing', () => {
    const dina = resolveCollection('dina');
    expect(dina?.missing).toEqual([]);
    expect(dina?.tools.map((t) => t.metadata.title)).toContain('Villa Prisma — Tekstavontuur');
  });

  it('resolves a slug nothing ships as undefined rather than throwing', () => {
    expect(resolveCollection('no-such-collection', catalogue)).toBeUndefined();
  });
});
