import { describe, expect, it, vi } from 'vitest';
import { LocalDirectoryStorage, tempRoot } from '@mimawsi/adapters-fake';
import type { Maker } from '@mimawsi/domain';
import type { NotifiableEvent } from '@mimawsi/ports';
import { mkdtemp } from 'node:fs/promises';
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
  // tempRoot, not tmpdir. TMPDIR is set to the repository root on at least one
  // machine here, so os.tmpdir() returns the checkout and every store this makes
  // lands beside the source — which is what tempRoot exists to prevent, and what
  // this test did until it was noticed.
  return new LocalDirectoryStorage(await mkdtemp(join(tempRoot(), 'mimawsi-admin-')));
}

const bytes = (s: string) => new TextEncoder().encode(s);

async function deps(overrides: Partial<AdminDeps> = {}): Promise<AdminDeps> {
  const storage = await storageWith();
  return {
    storage,
    identify: async () => APPROVER,
    allows: async (maker) => maker?.id.value === APPROVER.id.value,
    notifier: { notify: async () => undefined },
    dispatcher: { announce: async () => [] },
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

  it('lets Google style its own button, and lets its popup talk back', async () => {
    const response = await route(await deps(), get('/'));

    // Both learned the hard way: without the first the button renders unstyled and
    // the console reports a policy violation that reads like a sign-in fault;
    // without the second the popup opens, the person signs in, and nothing returns.
    expect(response.headers['content-security-policy']).toContain(
      "style-src 'unsafe-inline' https://accounts.google.com",
    );
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
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
      post('/deny', {
        id: submitted.id.value,
        reason: 'it reaches the network',
        remedy: 'remove the fetch',
      }),
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

  /**
   * Curation — the collections an approver ticked, and whether the tool is hidden.
   *
   * Asserted on the *store*, not on the response body. `npm run publish` rebuilds
   * the catalogue index from the store, so curation that only reached the reply
   * would be erased by the next rebuild and the tool would quietly leave the
   * collection it was approved into.
   */
  describe('curation at approval', () => {
    const DINA = { slug: 'dina', title: 'For Dina', blurb: 'puzzles', listed: false };

    async function approveWith(body: Record<string, unknown>) {
      const storage = await storageWith();
      // Collections live in the store now, and a fresh store has none. Created
      // here rather than assumed — which is also what the endpoint requires, and
      // is why the "unknown slug" case below is a real one rather than a fiction.
      await storage.createCollection(DINA);
      const submitted = await storage.submit({
        bytes: bytes('<h1>hi</h1>'),
        metadata: { title: 'A', description: 'd', tags: [] },
        maker: { value: 'maker-1' },
      });
      const d = await deps({ storage });
      const response = await route(d, post('/approve', { id: submitted.id.value, ...body }));
      const published = (await storage.listPublished()).find(
        (t) => t.id.value === submitted.id.value,
      );
      return { response, published };
    }

    it('records the collections the approver chose', async () => {
      const { response, published } = await approveWith({ collections: ['dina'] });
      expect(response.statusCode).toBe(200);
      expect(published?.curation?.collections).toEqual(['dina']);
    });

    it('records hidden when it is asked for', async () => {
      const { published } = await approveWith({ collections: [], hidden: true });
      expect(published?.curation?.hidden).toBe(true);
    });

    it('publishes listed and in no collection when nothing is chosen', async () => {
      const { published } = await approveWith({});
      expect(published?.curation).toEqual({ collections: [], hidden: false });
    });

    /**
     * The slugs arrive in a request body. An unknown one would assign the tool to a
     * collection with no page — published, recorded as curated, and findable
     * nowhere. Dropped rather than refused, because the page's tick-boxes come from
     * the same registry: a mismatch means the page and the Lambda are on different
     * versions, and publishing into the collections that do exist beats failing a
     * review that has already been done.
     */
    it('drops a slug that names no collection, and keeps the ones that do', async () => {
      const { response, published } = await approveWith({
        collections: ['dina', 'not-a-collection', '../etc/passwd'],
      });
      expect(response.statusCode).toBe(200);
      expect(published?.curation?.collections).toEqual(['dina']);
    });

    it('treats a non-array of collections as none, rather than failing the approval', async () => {
      const { response, published } = await approveWith({ collections: 'dina' });
      expect(response.statusCode).toBe(200);
      expect(published?.curation?.collections).toEqual([]);
    });

    it('treats anything but true as not hidden', async () => {
      const { published } = await approveWith({ hidden: 'yes' });
      // A truthy string must not hide a tool. The default has to fail towards
      // listed, or one loose comparison empties the front page.
      expect(published?.curation?.hidden).toBe(false);
    });

    it('tells the catalogue what it recorded, so the dispatch and the store agree', async () => {
      // Typed with its parameter so the recorded call can be read back; a
      // zero-argument mock makes `mock.calls[0][0]` a type error.
      const announce = vi.fn(
        async (_notice: Parameters<AdminDeps['dispatcher']['announce']>[0]) => ['o/site'],
      );
      const storage = await storageWith();
      await storage.createCollection(DINA);
      const submitted = await storage.submit({
        bytes: bytes('<h1>hi</h1>'),
        metadata: { title: 'A', description: 'd', tags: [] },
        maker: { value: 'maker-1' },
      });
      const d = await deps({ storage, dispatcher: { announce } });

      await route(
        d,
        post('/approve', { id: submitted.id.value, collections: ['dina'], hidden: true }),
      );

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce.mock.calls[0]?.[0].tool.curation).toEqual({
        collections: ['dina'],
        hidden: true,
      });
      // In full, not as slugs. The site keeps its own committed copy of the
      // registry and cannot know a collection created on this page, so the
      // definition has to travel with the tool that first uses it.
      expect(announce.mock.calls[0]?.[0].collections).toEqual([DINA]);
    });
  });

  /**
   * Replacing a published tool with a newer version of it.
   *
   * The whole point is that the address does not change, so these assert on the
   * id and on the slug sent to the record — a replacement that published to a new
   * id, or recorded into a new folder, would look successful and would have
   * broken the thing it exists to preserve.
   */
  describe('replacing a published tool', () => {
    async function withPublished(title = 'Jigsaw') {
      const storage = await storageWith();
      const first = await storage.submit({
        bytes: bytes('<h1>v1</h1>'),
        metadata: { title, description: 'the first one', tags: [] },
        maker: { value: 'maker-1' },
      });
      await storage.setState(first.id, 'approved');
      const original = await storage.publish(first.id, bytes('<h1>v1</h1>'));

      const remade = await storage.submit({
        bytes: bytes('<h1>v2</h1>'),
        metadata: { title: `${title} remade`, description: 'the better one', tags: [] },
        maker: { value: 'maker-1' },
      });
      return { storage, original, remade };
    }

    it('publishes the new file at the original tool id', async () => {
      const { storage, original, remade } = await withPublished();
      const d = await deps({ storage });

      const response = await route(
        d,
        post('/approve', { id: remade.id.value, replaces: original.id.value }),
      );

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.published.id).toBe(original.id.value);
      expect(body.replaced.id).toBe(original.id.value);

      const published = await storage.listPublished();
      expect(published).toHaveLength(1);
      expect(published[0]?.metadata.title).toBe('Jigsaw remade');
    });

    it('records into the original tool’s folder, not the new title’s', async () => {
      const announce = vi.fn(async (_n: Parameters<AdminDeps['dispatcher']['announce']>[0]) => [
        'o/record',
      ]);
      const { storage, original, remade } = await withPublished();
      const d = await deps({ storage, dispatcher: { announce } });

      await route(d, post('/approve', { id: remade.id.value, replaces: original.id.value }));

      // "jigsaw", from the original — not "jigsaw-remade". A new folder would
      // orphan the old one and split one tool's history across two directories.
      expect(announce.mock.calls[0]?.[0].slug).toBe('jigsaw');
      expect(announce.mock.calls[0]?.[0].tool.id.value).toBe(original.id.value);
    });

    it('publishes as new when nothing is chosen, which is what an empty picker sends', async () => {
      const { storage, original, remade } = await withPublished();
      const d = await deps({ storage });

      // The select's "— publish as new —" option has an empty value.
      await route(d, post('/approve', { id: remade.id.value, replaces: '' }));

      const published = await storage.listPublished();
      expect(published).toHaveLength(2);
      expect(published.map((t) => t.id.value)).toContain(original.id.value);
      expect(published.map((t) => t.id.value)).toContain(remade.id.value);
    });

    it('refuses an id that names nothing published, and publishes nothing', async () => {
      const { storage, remade } = await withPublished();
      const d = await deps({ storage });

      const response = await route(
        d,
        post('/approve', { id: remade.id.value, replaces: 'not-a-published-tool' }),
      );

      expect(response.statusCode).toBe(400);
      // The "and not" half: the submission is untouched and nothing was published.
      await expect(storage.getSubmission(remade.id)).resolves.toMatchObject({ state: 'pending' });
      expect(await storage.listPublished()).toHaveLength(1);
    });

    it('carries curation onto the replacement', async () => {
      const { storage, original, remade } = await withPublished();
      await storage.createCollection({
        slug: 'dina',
        title: 'For Dina',
        blurb: '',
        listed: false,
      });
      const d = await deps({ storage });

      await route(
        d,
        post('/approve', {
          id: remade.id.value,
          replaces: original.id.value,
          collections: ['dina'],
          hidden: true,
        }),
      );

      const published = await storage.listPublished();
      expect(published[0]?.curation).toEqual({ collections: ['dina'], hidden: true });
    });

    it('lists what can be replaced, and refuses a stranger the list', async () => {
      const { storage } = await withPublished();

      const mine = await route(await deps({ storage }), get('/published'));
      expect(mine.statusCode).toBe(200);
      const listed = JSON.parse(mine.body).published;
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ title: 'Jigsaw', maker: 'maker-1' });

      const theirs = await route(
        await deps({ storage, identify: async () => STRANGER }),
        get('/published'),
      );
      expect(theirs.statusCode).toBe(403);
    });
  });

  /**
   * Creating a collection from the approval page.
   *
   * The slug becomes a URL path segment and a directory name, so it is checked
   * here and not merely in the page: this endpoint answers curl too.
   */
  describe('creating a collection', () => {
    it('creates one and hands it back', async () => {
      const storage = await storageWith();
      const d = await deps({ storage });

      const response = await route(
        d,
        post('/collections', { slug: 'britpop_quizzes', title: 'Britpop quizzes' }),
      );

      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body).collection.slug).toBe('britpop_quizzes');
      expect((await storage.listCollections()).map((c) => c.slug)).toEqual(['britpop_quizzes']);
    });

    it('creates it unlisted, whatever was asked for', async () => {
      const storage = await storageWith();
      const d = await deps({ storage });

      // Putting a collection on the front page of the site is a commit, not a
      // side effect of approving something, so the field is not even read.
      const response = await route(
        d,
        post('/collections', { slug: 'loud', title: 'Loud', listed: true }),
      );

      expect(JSON.parse(response.body).collection.listed).toBe(false);
    });

    it.each([
      ['Dina', 'an uppercase letter'],
      ['two words', 'a space'],
      ['has-a-hyphen', 'a hyphen'],
      ['9lives', 'a leading digit'],
      ['../etc/passwd', 'a path'],
      ['', 'nothing at all'],
    ])('refuses %s, which is %s', async (slug) => {
      const storage = await storageWith();
      const response = await route(
        await deps({ storage }),
        post('/collections', { slug, title: 'T' }),
      );

      expect(response.statusCode).toBe(400);
      expect(await storage.listCollections()).toEqual([]);
    });

    it('refuses a slug that is already a page on the site', async () => {
      const storage = await storageWith();
      // `run` would never be reachable: Astro prefers the static route, so the
      // collection would look created and have no page.
      const response = await route(
        await deps({ storage }),
        post('/collections', { slug: 'run', title: 'Run' }),
      );

      expect(response.statusCode).toBe(400);
      expect(await storage.listCollections()).toEqual([]);
    });

    it('requires a title, because an untitled collection has no heading', async () => {
      const storage = await storageWith();
      const response = await route(
        await deps({ storage }),
        post('/collections', { slug: 'ok', title: '  ' }),
      );

      expect(response.statusCode).toBe(400);
      expect(await storage.listCollections()).toEqual([]);
    });

    it('answers 409 rather than overwriting one that exists', async () => {
      const storage = await storageWith();
      await storage.createCollection({ slug: 'dina', title: 'For Dina', blurb: '', listed: false });
      const d = await deps({ storage });

      const response = await route(
        d,
        post('/collections', { slug: 'dina', title: 'Something else' }),
      );

      expect(response.statusCode).toBe(409);
      // The "and not" half: the existing one is untouched, not renamed.
      expect((await storage.listCollections())[0]?.title).toBe('For Dina');
    });

    it('lists what exists, and refuses a stranger', async () => {
      const storage = await storageWith();
      await storage.createCollection({ slug: 'dina', title: 'For Dina', blurb: '', listed: false });

      const mine = await route(await deps({ storage }), get('/collections'));
      expect(JSON.parse(mine.body).collections).toHaveLength(1);

      const theirs = await route(
        await deps({ storage, identify: async () => STRANGER }),
        get('/collections'),
      );
      expect(theirs.statusCode).toBe(403);
    });
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
