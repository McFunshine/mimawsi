import { describe, expect, it } from 'vitest';
import type { ToolMetadata, UserId } from '@mimawsi/domain';
import { DuplicateFileError, NotFoundError } from './index.ts';
import type { IdentityPort, NotifierPort, ScannerPort, StoragePort } from './index.ts';

/**
 * The contracts. Every adapter behind a port runs these — the phase-0 fakes today,
 * S3, Google, semgrep and SES later. They MUST NOT be weakened when a real adapter
 * arrives: if the real one cannot pass unchanged, the port is wrong (RULE-46).
 *
 * They describe behaviour only. Nothing here knows about directories, buckets,
 * tables or HTTP.
 */

const meta = (title: string): ToolMetadata => ({
  title,
  description: `${title} does one thing`,
  tags: ['fixture'],
});

const maker: UserId = { value: 'maker-1' };
const bytesOf = (s: string) => new TextEncoder().encode(s);

export function describeStoragePort(name: string, create: () => Promise<StoragePort>): void {
  describe(`StoragePort contract: ${name}`, () => {
    it('stores a submission as pending and returns it by id', async () => {
      const storage = await create();
      const submitted = await storage.submit({ bytes: bytesOf('<h1>a</h1>'), metadata: meta('A'), maker });

      expect(submitted.state).toBe('pending');
      expect(submitted.metadata.title).toBe('A');
      expect(submitted.maker).toEqual(maker);
      await expect(storage.getSubmission(submitted.id)).resolves.toMatchObject({ id: submitted.id });
    });

    it('records the size and a stable hash of the bytes', async () => {
      const storage = await create();
      const bytes = bytesOf('<h1>same</h1>');
      const first = await storage.submit({ bytes, metadata: meta('A'), maker });
      const second = await storage.submit({ bytes: bytesOf('<h1>other</h1>'), metadata: meta('B'), maker });

      expect(first.sizeBytes).toBe(bytes.byteLength);
      expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(first.sha256).not.toBe(second.sha256);
    });

    it('returns the exact bytes it was given', async () => {
      const storage = await create();
      const bytes = bytesOf('<h1>exact</h1>');
      const submitted = await storage.submit({ bytes, metadata: meta('A'), maker });

      await expect(storage.readSubmittedBytes(submitted.id)).resolves.toEqual(bytes);
    });

    it('lists submissions by state and does not leak other states', async () => {
      const storage = await create();
      const pending = await storage.submit({ bytes: bytesOf('<h1>a</h1>'), metadata: meta('A'), maker });
      const rejected = await storage.submit({ bytes: bytesOf('<h1>b</h1>'), metadata: meta('B'), maker });
      await storage.setState(rejected.id, 'rejected');

      const stillPending = await storage.listSubmissions('pending');
      expect(stillPending.map((s) => s.id.value)).toEqual([pending.id.value]);
    });

    it('publishes an approved submission with the bytes it is handed, not the ones submitted', async () => {
      const storage = await create();
      const submitted = await storage.submit({ bytes: bytesOf('<h1>raw</h1>'), metadata: meta('A'), maker });
      await storage.setState(submitted.id, 'approved');
      const withPolicy = bytesOf('<meta http-equiv="Content-Security-Policy" content="x"><h1>raw</h1>');

      const tool = await storage.publish(submitted.id, withPolicy);

      expect(tool.id).toEqual(submitted.id);
      await expect(storage.readPublished(tool.id)).resolves.toEqual(withPolicy);
      expect((await storage.listPublished()).map((t) => t.id.value)).toContain(tool.id.value);
    });

    it('does not publish a submission that was never approved', async () => {
      const storage = await create();
      const submitted = await storage.submit({ bytes: bytesOf('<h1>a</h1>'), metadata: meta('A'), maker });

      await expect(storage.publish(submitted.id, bytesOf('x'))).rejects.toThrow();
      // The "and not" half: nothing appeared in the published set either.
      expect(await storage.listPublished()).toEqual([]);
    });

    it('refuses a file identical to one already published, naming the existing tool', async () => {
      const storage = await create();
      const bytes = bytesOf('<h1>identical</h1>');
      const first = await storage.submit({ bytes, metadata: meta('A'), maker });
      await storage.setState(first.id, 'approved');
      await storage.publish(first.id, bytes);

      await expect(storage.submit({ bytes, metadata: meta('B'), maker })).rejects.toThrow(DuplicateFileError);
      expect(await storage.listSubmissions('pending')).toEqual([]);
    });

    it('reports a missing submission rather than returning nothing', async () => {
      const storage = await create();
      await expect(storage.getSubmission({ value: 'nope' })).rejects.toThrow(NotFoundError);
    });
  });
}

export function describeIdentityPort(name: string, create: () => Promise<IdentityPort>): void {
  describe(`IdentityPort contract: ${name}`, () => {
    it('reports nobody signed in before sign-in', async () => {
      const identity = await create();
      await expect(identity.current()).resolves.toBeNull();
    });

    it('returns the same maker on every read after signing in', async () => {
      const identity = await create();
      const signedIn = await identity.signIn();

      await expect(identity.current()).resolves.toEqual(signedIn);
      await expect(identity.current()).resolves.toEqual(signedIn);
    });

    it('reading identity never signs anybody in', async () => {
      const identity = await create();
      await identity.current();
      await expect(identity.current()).resolves.toBeNull();
    });

    it('forgets the maker after signing out', async () => {
      const identity = await create();
      await identity.signIn();
      await identity.signOut();

      await expect(identity.current()).resolves.toBeNull();
    });
  });
}

/**
 * `rejected` is bytes the adapter is expected to refuse. The phase-0 stub passes
 * everything and cannot supply any, so the rejection case is skipped *visibly*
 * rather than sitting inside an `if` that never runs — a green test asserting
 * nothing is worse than an absent one. semgrep supplies it at task-4.2.
 */
export function describeScannerPort(
  name: string,
  create: () => Promise<ScannerPort>,
  samples: { rejected?: Uint8Array } = {},
): void {
  describe(`ScannerPort contract: ${name}`, () => {
    it('returns a verdict and a findings list for any input', async () => {
      const scanner = await create();
      const result = await scanner.scan(bytesOf('<h1>anything</h1>'));

      expect(['pass', 'flag', 'reject']).toContain(result.verdict);
      expect(Array.isArray(result.findings)).toBe(true);
    });

    it('gives the same verdict for the same bytes', async () => {
      const scanner = await create();
      const bytes = bytesOf('<script>fetch("https://x.invalid")</script>');

      const first = await scanner.scan(bytes);
      const second = await scanner.scan(bytes);
      expect(second.verdict).toBe(first.verdict);
    });

    const rejected = samples.rejected;
    const rejectionCase = rejected ? it : it.skip;
    rejectionCase('rejects the sample it is meant to reject, with at least one finding', async () => {
      const scanner = await create();
      const result = await scanner.scan(rejected as Uint8Array);

      expect(result.verdict).toBe('reject');
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings.every((f) => f.rule !== '' && f.detail !== '')).toBe(true);
    });
  });
}

export function describeNotifierPort(name: string, create: () => Promise<NotifierPort>): void {
  describe(`NotifierPort contract: ${name}`, () => {
    it('accepts an approval without throwing', async () => {
      const notifier = await create();
      await expect(
        notifier.notify({ kind: 'approved', submission: { value: 's1' }, maker }),
      ).resolves.toBeUndefined();
    });

    it('accepts a rejection carrying both a reason and a remedy', async () => {
      const notifier = await create();
      await expect(
        notifier.notify({
          kind: 'rejected',
          submission: { value: 's1' },
          maker,
          reason: 'reaches the network',
          remedy: 'remove the fetch call',
        }),
      ).resolves.toBeUndefined();
    });
  });
}
