/**
 * The approval endpoint: the queue, and the two decisions.
 *
 * A separate function from `mimawsi-submit`, on a separate role, behind a
 * separate origin. The submit endpoint is public and unauthenticated at the
 * platform level, and it must never hold the ability to publish to the site —
 * that is the whole reason there are two roles rather than one convenient one.
 *
 * Every route that does anything checks the allowlist server-side, on every
 * request. The page hides buttons from people who cannot use them, and that is
 * courtesy: anyone can call these routes directly with curl, so the check here is
 * the entire security of the feature.
 */
import type { Maker, Submission, SubmissionId } from '@mimawsi/domain';
import type { NotifierPort, ReviewStorage, StoragePort } from '@mimawsi/ports';
import { NotFoundError } from '@mimawsi/ports';
import type { PublishTargets } from '@mimawsi/publisher';
import { publishSubmission } from '@mimawsi/publisher';
import { page } from './admin-page.ts';

export interface AdminEvent {
  readonly rawPath?: string;
  readonly rawQueryString?: string;
  readonly headers?: Record<string, string | undefined>;
  readonly body?: string;
  readonly isBase64Encoded?: boolean;
  readonly requestContext?: { readonly http?: { readonly method?: string } };
}

export interface AdminResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface AdminDeps {
  readonly storage: Pick<StoragePort, 'publish'> & ReviewStorage;
  /** Resolves the caller from a bearer token. Google only — no operator token here. */
  readonly identify: (token: string | null) => Promise<Maker | null>;
  /** Server-side allowlist check. Fails closed on every error. */
  readonly allows: (maker: Maker | null) => Promise<boolean>;
  readonly notifier: NotifierPort;
  readonly targets: PublishTargets;
  /** Shipped to the browser so the page can start Google sign-in. Public by design. */
  readonly googleClientId: string;
  /** False when a bucket is unset, so misconfiguration reads as a fault not a refusal. */
  readonly configured: boolean;
}

const json = (statusCode: number, body: unknown): AdminResponse => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

function bearer(headers: Record<string, string | undefined> = {}): string | null {
  const header = headers.authorization ?? headers.Authorization;
  return header?.startsWith('Bearer ') === true ? header.slice('Bearer '.length) : null;
}

function bodyOf(event: AdminEvent): Record<string, unknown> {
  const raw = event.isBase64Encoded === true
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');
  if (raw === '') {
    return {};
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SyntaxError('body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

const asId = (value: unknown): SubmissionId | null =>
  typeof value === 'string' && value !== '' ? { value } : null;

/**
 * What the queue shows. Deliberately not the whole record: the maker's address is
 * in the store and has no business being sent to a browser, even an approver's.
 * It is needed to send a rejection, and that send happens server-side.
 */
interface QueueItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly maker: string;
  readonly contactable: boolean;
}

const queueItem = (s: Submission): QueueItem => ({
  id: s.id.value,
  title: s.metadata.title,
  description: s.metadata.description,
  sizeBytes: s.sizeBytes,
  sha256: s.sha256,
  maker: s.maker.value,
  // So the page can warn that denying this one will record a reason nobody
  // receives, before the approver spends time writing one.
  contactable: typeof s.makerEmail === 'string' && s.makerEmail !== '',
});

export async function route(deps: AdminDeps, event: AdminEvent): Promise<AdminResponse> {
  const path = event.rawPath ?? '/';
  const method = event.requestContext?.http?.method ?? 'GET';

  // The page is static and carries no data, so it is served before any auth check
  // — there is nothing on it to protect. Everything it later asks for is checked.
  if (path === '/' || path === '/index.html') {
    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        // The admin page's own policy, which is not the tool policy: it has to
        // reach Google to sign in. Tools get `default-src 'none'` and never this.
        'content-security-policy': [
          "default-src 'none'",
          "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com",
          "style-src 'unsafe-inline'",
          "connect-src 'self' https://accounts.google.com",
          'frame-src https://accounts.google.com',
          "img-src data: https://*.googleusercontent.com",
          "form-action 'none'",
          "base-uri 'none'",
        ].join('; '),
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
      body: page(deps.googleClientId),
    };
  }

  if (path === '/health') {
    return json(200, { ok: true, configured: deps.configured });
  }

  if (!deps.configured) {
    return json(500, { error: 'storage is not configured' });
  }

  const maker = await deps.identify(bearer(event.headers));

  // One gate for every route below. Answering 403 rather than 404 for a signed-in
  // non-approver is deliberate: they are a real account and telling them they are
  // not on the list is more use than pretending the route does not exist.
  if (!maker) {
    return json(401, { error: 'sign in to continue' });
  }
  if (!(await deps.allows(maker))) {
    return json(403, { error: 'not an approver' });
  }

  try {
    if (path === '/queue' && method === 'GET') {
      const pending = await deps.storage.listSubmissions('pending');
      return json(200, {
        approver: { name: maker.displayName },
        queue: pending.map(queueItem),
      });
    }

    // The submitted file, for looking at before deciding. Served as text/plain,
    // never text/html: rendering an unreviewed submission on the admin origin
    // would hand it the one origin that can reach admin storage, which is the
    // exact thing this subdomain exists to prevent.
    if (path === '/source' && method === 'GET') {
      const id = asId(new URLSearchParams(event.rawQueryString ?? '').get('id'));
      if (!id) {
        return json(400, { error: 'id is required' });
      }
      const bytes = await deps.storage.readSubmittedBytes(id);
      return {
        statusCode: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'content-disposition': 'inline',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
        },
        body: Buffer.from(bytes).toString('utf8'),
      };
    }

    if (path === '/approve' && method === 'POST') {
      const id = asId(bodyOf(event).id);
      if (!id) {
        return json(400, { error: 'id is required' });
      }

      const submission = await deps.storage.getSubmission(id);
      if (submission.state !== 'pending') {
        // Not an error worth a 500, and not a silent success either: two approvers
        // on the same queue is the ordinary case this must answer sensibly.
        return json(409, { error: `already ${submission.state}`, state: submission.state });
      }

      await deps.storage.setState(id, 'approved');
      // The same publishSubmission the CLI calls. Not a second implementation —
      // that divergence is what put a tool in the catalogue whose file was never
      // uploaded, and it is why the publisher was extracted.
      const { tool } = await publishSubmission(deps, id, deps.targets);
      return json(200, { published: { id: tool.id.value, title: tool.metadata.title } });
    }

    if (path === '/deny' && method === 'POST') {
      const body = bodyOf(event);
      const id = asId(body.id);
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      const remedy = typeof body.remedy === 'string' ? body.remedy.trim() : '';

      if (!id) {
        return json(400, { error: 'id is required' });
      }
      // A refusal with no reason is the thing this feature exists to prevent. The
      // maker is owed why, and "denied" alone is not why.
      if (reason === '') {
        return json(400, { error: 'a reason is required' });
      }

      const submission = await deps.storage.getSubmission(id);
      if (submission.state !== 'pending') {
        return json(409, { error: `already ${submission.state}`, state: submission.state });
      }

      // Recorded before the email. If sending throws, the submission is still
      // rejected and the operator sees the failure; the other order risks a maker
      // holding a rejection notice for something the store still calls pending.
      await deps.storage.setState(id, 'rejected');
      await deps.notifier.notify({
        kind: 'rejected',
        submission: id,
        maker: submission.maker,
        reason,
        remedy,
      });

      return json(200, {
        denied: { id: id.value },
        emailed: typeof submission.makerEmail === 'string' && submission.makerEmail !== '',
      });
    }

    return json(404, { error: 'not found' });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return json(404, { error: 'no such submission' });
    }
    if (error instanceof SyntaxError) {
      return json(400, { error: 'body is not valid JSON' });
    }
    // Logged, not returned: an internal message may name a bucket or a key.
    console.error('admin route failed', path, error);
    return json(500, { error: 'internal error' });
  }
}
