import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalDirectoryStorage } from './index.ts';

const store = async () => new LocalDirectoryStorage(await mkdtemp(join(tmpdir(), 'mimawsi-durability-')));
const maker = { value: 'maker-1' };
const metadata = { title: 'Tool', description: 'd', tags: [] };

describe('LocalDirectoryStorage durability', () => {
  it('treats a missing index as the empty store', async () => {
    const storage = await store();
    expect(await storage.listPublished()).toEqual([]);
    expect(await storage.listSubmissions('pending')).toEqual([]);
  });

  it('refuses to read a corrupted index rather than silently emptying the store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mimawsi-durability-'));
    const storage = new LocalDirectoryStorage(root);
    await storage.submit({ bytes: new TextEncoder().encode('<p>one</p>'), metadata, maker });

    await writeFile(join(root, 'index.json'), '{ "submissions": [', 'utf8');

    await expect(storage.listSubmissions('pending')).rejects.toThrow(/corrupted storage index/i);

    // The critical part: the bad index is still on disk, not overwritten with {}.
    expect(await readFile(join(root, 'index.json'), 'utf8')).toBe('{ "submissions": [');
  });

  it('keeps every submission when they are written concurrently', async () => {
    const storage = await store();
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        storage.submit({ bytes: new TextEncoder().encode(`<p>${i}</p>`), metadata, maker }),
      ),
    );
    expect((await storage.listSubmissions('pending')).length).toBe(12);
  });
});

describe('LocalDirectoryStorage path safety', () => {
  it('refuses an id that would escape the store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mimawsi-traversal-'));
    await writeFile(join(root, '..', 'SECRET.html'), 'top secret', 'utf8');
    const storage = new LocalDirectoryStorage(root);

    for (const value of ['../../SECRET', '../SECRET', '..%2fSECRET', 'a/../../SECRET']) {
      await expect(storage.readPublished({ value })).rejects.toThrow(/not found/i);
      await expect(storage.readSubmittedBytes({ value })).rejects.toThrow(/not found/i);
    }

    // The file it was reaching for is still there and was never returned.
    expect(await readFile(join(root, '..', 'SECRET.html'), 'utf8')).toBe('top secret');
  });

  it('still serves a legitimate id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mimawsi-traversal-'));
    const storage = new LocalDirectoryStorage(root);
    const bytes = new TextEncoder().encode('<p>fine</p>');
    const submission = await storage.submit({ bytes, metadata, maker });
    expect(await storage.readSubmittedBytes(submission.id)).toEqual(bytes);
  });
});
