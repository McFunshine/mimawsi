import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tempRoot } from '@mimawsi/adapters-fake';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * `add-to-catalogue.mjs` runs in CI on every publish and had no test until it
 * crashed on a live payload — a typo in this file left the tool written to the
 * catalogue and its collection missing, which is a published tool with no page.
 *
 * It is driven as a subprocess rather than imported, because that is how CI runs
 * it: as a script, with a file path, where a ReferenceError is an exit code and
 * not a stack trace anybody reads.
 */
const SCRIPT = fileURLToPath(new URL('./add-to-catalogue.mjs', import.meta.url));
const INDEX = fileURLToPath(new URL('../packages/site/src/data/published.json', import.meta.url));
const REGISTRY = fileURLToPath(
  new URL('../packages/site/src/data/collections.json', import.meta.url),
);

/** The real files, restored after each test — the script writes the checkout. */
let savedIndex = '';
let savedRegistry = '';

const read = (path: string): unknown[] => JSON.parse(readFileSync(path, 'utf8'));

function run(payload: unknown): { status: number; output: string } {
  // tempRoot, not os.tmpdir(). TMPDIR is set to the repository root on at least
  // one machine here, so tmpdir() returns the checkout and every payload this
  // writes lands beside the source. This test made that exact mistake, in spite
  // of the warning already written in admin.test.ts.
  const file = join(mkdtempSync(join(tempRoot(), 'atc-')), 'payload.json');
  writeFileSync(file, JSON.stringify(payload));
  try {
    const output = execFileSync('node', [SCRIPT, file], { encoding: 'utf8', stdio: 'pipe' });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const payloadFor = (over: Record<string, unknown> = {}) => ({
  id: 'aaaaaaaa-1111-2222-3333-444444444444',
  slug: 'a-tool',
  title: 'A Tool',
  description: 'does a thing',
  sha256: 'abc',
  sizeBytes: 10,
  maker: 'maker-1',
  approvedBy: 'Ada',
  note: '',
  curation: { collections: [], hidden: false, defined: [] },
  ...over,
});

describe('add-to-catalogue', () => {
  beforeEach(() => {
    savedIndex = readFileSync(INDEX, 'utf8');
    savedRegistry = readFileSync(REGISTRY, 'utf8');
    return () => {
      writeFileSync(INDEX, savedIndex);
      writeFileSync(REGISTRY, savedRegistry);
    };
  });

  it('runs to completion on a real payload', () => {
    const { status, output } = run(payloadFor());
    // The whole reason this file exists: the script exited 1 with a
    // ReferenceError and the calling workflow reported the publish as fine.
    expect(output).not.toContain('ReferenceError');
    expect(status).toBe(0);
  });

  it('adds the tool with the curation it was given', () => {
    run(payloadFor({ curation: { collections: ['dina'], hidden: true, defined: [] } }));
    const entry = read(INDEX).find(
      (t) => (t as { id: { value: string } }).id.value === payloadFor().id,
    ) as { curation: unknown };
    expect(entry.curation).toEqual({ collections: ['dina'], hidden: true });
  });

  it('adds a collection the site does not know about yet', () => {
    run(
      payloadFor({
        curation: {
          collections: ['britpop_quizzes'],
          hidden: false,
          defined: [
            { slug: 'britpop_quizzes', title: 'Britpop quizzes', blurb: 'b', listed: false },
          ],
        },
      }),
    );
    const slugs = read(REGISTRY).map((c) => (c as { slug: string }).slug);
    expect(slugs).toContain('britpop_quizzes');
  });

  it('leaves an existing collection exactly as it is', () => {
    // `listed` and `pinned` are hand-edited here. A dispatch upsert would undo
    // that, which is how a curated page silently loses its order.
    const before = readFileSync(REGISTRY, 'utf8');
    run(
      payloadFor({
        curation: {
          collections: ['dina'],
          hidden: false,
          defined: [{ slug: 'dina', title: 'Renamed!', blurb: 'different', listed: true }],
        },
      }),
    );
    expect(readFileSync(REGISTRY, 'utf8')).toBe(before);
  });

  it('drops a collection slug that is not a usable slug, and still adds the tool', () => {
    const { status } = run(
      payloadFor({
        curation: {
          collections: ['Bad Slug', '../etc/passwd', 'has-a-hyphen'],
          hidden: false,
          defined: [{ slug: 'Bad Slug', title: 'Bad', blurb: '', listed: false }],
        },
      }),
    );
    expect(status).toBe(0);
    const entry = read(INDEX).find(
      (t) => (t as { id: { value: string } }).id.value === payloadFor().id,
    ) as { curation: { collections: string[] } };
    expect(entry.curation.collections).toEqual([]);
    expect(read(REGISTRY).map((c) => (c as { slug: string }).slug)).not.toContain('Bad Slug');
  });

  it('refuses an id that is not a safe key, and writes nothing', () => {
    const before = readFileSync(INDEX, 'utf8');
    const { status } = run(payloadFor({ id: '../../etc/passwd' }));
    expect(status).toBe(1);
    expect(readFileSync(INDEX, 'utf8')).toBe(before);
  });

  it('treats an absent curation as listed and in no collection', () => {
    run({ ...payloadFor(), curation: undefined });
    const entry = read(INDEX).find(
      (t) => (t as { id: { value: string } }).id.value === payloadFor().id,
    ) as { curation: unknown };
    // Never hidden by default: the other way empties the front page.
    expect(entry.curation).toEqual({ collections: [], hidden: false });
  });
});
