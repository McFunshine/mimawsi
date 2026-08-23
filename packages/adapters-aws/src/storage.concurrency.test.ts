import { randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { S3Storage } from './storage.ts';

/**
 * The one behaviour this adapter has that LocalDirectoryStorage explicitly does
 * not: two writers mutating the same index without losing each other's work.
 *
 * This is not a hypothetical. The submit Lambda and the review CLI are separate
 * processes against one store, so read-modify-write without a compare-and-set
 * silently drops whichever submission finished second. The fake documents that it
 * cannot close this; S3's conditional PutObject can, and this proves it does.
 *
 * Not part of the shared contract, because it is a guarantee the fake is allowed
 * to lack — putting it in the contract suite would fail an adapter that is honest
 * about its limits (RULE-46 forbids weakening the contract, not extending an
 * adapter's own tests).
 */
const bucket = process.env.MIMAWSI_S3_TEST_BUCKET;
const when = bucket ? describe : describe.skip;

when('S3Storage concurrent writers', () => {
  it('keeps every submission when several are written at once', async () => {
    const storage = new S3Storage(
      bucket as string,
      new S3Client({}),
      `contract-test/${randomUUID()}`,
    );

    const howMany = 5;
    const written = await Promise.all(
      Array.from({ length: howMany }, (_, i) =>
        storage.submit({
          bytes: new TextEncoder().encode(`<p>tool ${i}</p>`),
          metadata: { title: `Tool ${i}`, description: 'concurrent', tags: [] },
          maker: { value: 'maker-1' },
        }),
      ),
    );

    // Every writer got a distinct id back...
    expect(new Set(written.map((s) => s.id.value)).size).toBe(howMany);

    // ...and every one of them is still in the index. A last-write-wins store
    // returns the same five ids and then holds only one of them.
    const stored = (await storage.listSubmissions('pending')).map((s) => s.id.value).sort();
    expect(stored).toEqual(written.map((s) => s.id.value).sort());
  }, 30_000);
});
