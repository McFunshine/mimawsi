import { describe, expect, it, vi } from 'vitest';
import { LocalDirectoryStorage } from '@mimawsi/adapters-fake';
import type { Maker } from '@mimawsi/domain';
import type { NotifiableEvent } from '@mimawsi/ports';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { route } from './admin.ts';
import type { AdminDeps, AdminEvent } from './admin.ts';

/**
 * The gate is the feature. Everything below the sign-in check publishes to a live
 * site, so most of these are about who is refused rather than what succeeds.
 */

const APPROVER: Maker = { id: { value: 'sub-approver' }, displayName: 'Ada' };
const STRANGER: Maker = { id: { value: 'sub-stranger' }, displayName: 'Mallory' };

async function storageWith(): Promise<LocalDirectoryStorage> {
  return new LocalDirectoryStorage(await mkdtemp(join(tmpdir(), 'mimawsi-admin-')));
}

const bytes = (s: string) => new TextEncoder().encode(s);

async function deps(overrides: Partial<AdminDeps> = {}): Promise<AdminDeps> {
  const storage = await storageWith();
  return {
    storage,
    identify: async () => APPROVER,
    allows: async (maker) => maker?.id.value === APPROVER.id.value,
    notifier: { notify: async () => undefined },
    targets: {},
    googleClientId: 'client-123',
    configured: true,
    ...overrides,
  };
}

const get = (path: string): AdminEvent => ({
  rawPath: path,
  requestContext: { http: { method: 'GET' } },
});

const post = (path: string, body: unknown): AdminEvent => ({
  rawPath: path,
  requestContext: { http: { method: 'POST' } },
  body: JSON.stringify(body),
});

describe('the approval endpoint', () => {
  it('serves the page to anybody, because there is nothing on it to protect', async () => {
    const d = await deps({ identify: async () => null });
    const response = await route(d, get('/'));

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('client-123');
  });

  it('gives the page a policy that permits Google and nothing else it does not need', async () => {
    const response = await route(await deps(), get('/'));
    const csp = response.headers['content-security-policy'] ?? '';

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('https://accounts.google.com');
    // The tool policy must never be what an admin page runs under, and vice versa.
    expect(csp).toContain("form-action 'none'");
  });

  it('refuses the queue to somebody who is not signed in', async () => {
    const d = await deps({ identify: async () => null });
    const response = await route(d, get('/queue'));

    expect(response.statusCode).toBe(401);
  });

  it('refuses the queue to a real account that is not on the list', async () => {
    const d = await deps({ identify: async () => STRANGER });
    const response = await route(d, get('/queue'));

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error).toBe('not an approver');
  });

  it('refuses to publish for a non-approver, and does not touch the submission', async () => {
    const storage = await storageWith();
    const submitted = await storage.submit({
      bytes: bytes('<h1>hi</h1>'),
      metadata: { title: 'A', description: 'd', tags: [] },
      maker: { value: 'maker-1' },
    });
    const d = await deps({ storage, identify: async () => STRANGER });

    const response = await route(d, post('/approve', { id: submitted.id.value }));

    expect(response.statusCode).toBe(403);
    await expect(storage.getSubmission(submitted.id)).resolves.toMatchObject({ state: 'pending' });
  });

  it('lists what is pending, without leaking the maker address to the browser', async () => {
    const storage = await storageWith();
    await storage.submit({
      bytes: bytes('<h1>one</h1>'),
      metadata: { title: 'One', description: 'first', tags: [] },
      maker: { value: 'maker-1' },
      makerEmail: 'maker@example.com',
    });
    const d = await deps({ storage });

    const response = await route(d, get('/queue'));
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.queue).toHaveLength(1);
    expect(body.queue[0].title).toBe('One');
    // Present as a flag, absent as a value.
    expect(body.queue[0].contactable).toBe(true);
    expect(response.body).not.toContain('maker@example.com');
  });

  it('serves a submission as text, never as html', async () => {
    const storage = await storageWith();
    const submitted = await storage.submit({
      bytes: bytes('<script>alert(1)</script>'),
      metadata: { title: 'A', description: 'd', tags: [] },
      maker: { value: 'maker-1' },
    });
    const d = await deps({ storage });

    const response = await route(d, {
      ...get('/source'),
      rawQueryString: `id=${submitted.id.value}`,
    });

    expect(response.statusCode).toBe(200);
    // The admin origin is the one origin that can reach admin storage. Rendering
    // an unreviewed submission here is the exact thing the subdomain prevents.
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.body).toBe('<script>alert(1)</script>');
  });

  it('will not deny without a reason, because the reason is the point', async () => {
    const storage = await storageWith();
    const submitted = await storage.submit({
      bytes: bytes('<h1>hi</h1>'),
      metadata: { title: 'A', description: 'd', tags: [] },
      maker: { value: 'maker-1' },
    });
    const d = await deps({ storage });

    const response = await route(d, post('/deny', { id: submitted.id.value, reason: '   ' }));

    expect(response.statusCode).toBe(400);
    await expect(storage.getSubmission(submitted.id)).resolves.toMatchObject({ state: 'pending' });
  });

  it('records the rejection and notifies the maker with the reason given', async () => {
    const storage = await storageWith();
    const submitted = await storage.submit({
      bytes: bytes('<h1>hi</h1>'),
      metadata: { title: 'A', description: 'd', tags: [] },
      maker: { value: 'maker-1' },
      makerEmail: 'maker@example.com',
    });
    const sent: NotifiableEvent[] = [];
    const d = await deps({ storage, notifier: { notify: async (e) => void sent.push(e) } });

    const response = await route(
      d,
      post('/deny', { id: submitted.id.value, reason: 'it reaches the network', remedy: 'remove the fetch' }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).emailed).toBe(true);
    await expect(storage.getSubmission(submitted.id)).resolves.toMatchObject({ state: 'rejected' });
    expect(sent).toEqual([
      {
        kind: 'rejected',
        submission: submitted.id,
        maker: { value: 'maker-1' },
        reason: 'it reaches the network',
        remedy: 'remove the fetch',
      },
    ]);
  });

  it('says plainly when a denial could not be posted to anybody', async () => {
    const storage = await storageWith();
    const submitted = await storage.submit({
      bytes: bytes('<h1>hi</h1>'),
      metadata: { title: 'A', description: 'd', tags: [] },
      maker: { value: 'maker-1' },
    });
    const d = await deps({ storage });

    const response = await route(d, post('/deny', { id: submitted.id.value, reason: 'no' }));

    expect(JSON.parse(response.body).emailed).toBe(false);
    await expect(storage.getSubmission(submitted.id)).resolves.toMatchObject({ state: 'rejected' });
  });

  it('refuses a second decision on a submission already decided', async () => {
    const storage = await storageWith();
    const submitted = await storage.submit({
      bytes: bytes('<h1>hi</h1>'),
      metadata: { title: 'A', description: 'd', tags: [] },
      maker: { value: 'maker-1' },
    });
    await storage.setState(submitted.id, 'rejected');
    const d = await deps({ storage });

    const response = await route(d, post('/approve', { id: submitted.id.value }));

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).state).toBe('rejected');
  });

  it('reports an unknown submission as missing rather than as a fault', async () => {
    const response = await route(await deps(), post('/approve', { id: 'nope' }));
    expect(response.statusCode).toBe(404);
  });

  it('reports misconfiguration as a fault, not as a refusal', async () => {
    const d = await deps({ configured: false });
    const response = await route(d, get('/queue'));

    // A 401 here would send the operator hunting for a bad token when a bucket
    // name is unset.
    expect(response.statusCode).toBe(500);
  });

  it('answers health without needing anybody to be signed in', async () => {
    const d = await deps({ identify: async () => null, configured: false });
    const response = await route(d, get('/health'));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ ok: true, configured: false });
  });

  it('checks the allowlist on every request, never once per container', async () => {
    const allows = vi.fn(async () => true);
    const d = await deps({ allows });

    await route(d, get('/queue'));
    await route(d, get('/queue'));

    // Removing an approver must take effect at once. A cached answer is the one
    // kind of stale data that matters here.
    expect(allows).toHaveBeenCalledTimes(2);
  });
});
