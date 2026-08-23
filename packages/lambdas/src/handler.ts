/**
 * The upload endpoint, behind a Lambda Function URL.
 *
 * Deliberately thin. All it does is turn an HTTP event into a SubmitRequest and a
 * SubmitResult back into a response — the rules about what may be submitted live
 * in submit(), which is why the same rules apply here and behind the local server
 * in serve.ts without being written twice.
 *
 * CORS is configured on the Function URL itself rather than handled here, so
 * preflight never reaches this code and the allowed origin is infrastructure
 * (reviewable in Terraform) rather than a string in a handler.
 */
import { S3Storage, operatorIdentity } from '@mimawsi/adapters-aws';
import { MAX_TOOL_BYTES } from '@mimawsi/domain';
import { submit } from './submit.ts';
import type { SubmitDeps, SubmitRequest } from './submit.ts';

interface FunctionUrlEvent {
  readonly rawPath?: string;
  readonly headers?: Record<string, string | undefined>;
  readonly body?: string;
  readonly isBase64Encoded?: boolean;
  readonly requestContext?: { readonly http?: { readonly method?: string } };
}

interface Response {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/**
 * Lambda refuses a synchronous request payload above 6 MB before any of this runs,
 * and answers with its own error rather than ours. MAX_TOOL_BYTES is 25 MiB, so a
 * tool at the domain cap cannot reach this endpoint at all.
 *
 * That gap is transport, not policy: the rule about how large a tool may be still
 * belongs to the domain, and a presigned S3 PUT would carry the full 25 MiB
 * without changing it. Until then this refuses oversized files itself, with a
 * message naming the real limit, because "we could not read your request" is a
 * worse answer than "this endpoint currently carries 5 MiB".
 */
const TRANSPORT_LIMIT_BYTES = 5 * 1024 * 1024;

const json = (statusCode: number, body: unknown): Response => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

function bearer(headers: Record<string, string | undefined> = {}): string | null {
  // Lambda lower-cases header names, but a local caller may not.
  const header = headers.authorization ?? headers.Authorization;
  return header?.startsWith('Bearer ') === true ? header.slice('Bearer '.length) : null;
}

function bodyOf(event: FunctionUrlEvent): SubmitRequest {
  const raw = event.isBase64Encoded === true
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');

  if (raw === '') {
    return {} as SubmitRequest;
  }

  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SyntaxError('body must be a JSON object');
  }
  return parsed as SubmitRequest;
}

/** What routing needs. Env and AWS clients are assembled at the edge, below. */
export interface RouteDeps {
  readonly storage: SubmitDeps['storage'];
  readonly operatorToken: string;
  /** False when the bucket is unset, so misconfiguration is reported as a fault. */
  readonly configured: boolean;
}

/**
 * Routing as a function of its dependencies, so it can be tested without AWS,
 * without env, and without a container — the same reason submit() is shaped this
 * way. `handler` below is the only part that reads the environment.
 */
export async function route(deps: RouteDeps, event: FunctionUrlEvent): Promise<Response> {
  const path = event.rawPath ?? '/';
  const method = event.requestContext?.http?.method ?? 'GET';
  const identity = operatorIdentity(bearer(event.headers), deps.operatorToken);

  // Misconfiguration is reported as a server fault, not as a refusal. A 401 here
  // would send the operator hunting for a bad token when the bucket is unset.
  if (!deps.configured) {
    return json(500, { error: 'storage is not configured' });
  }

  try {
    if (path === '/health') {
      return json(200, { ok: true });
    }

    // Both session routes answer the same way, because a bearer token has no
    // sign-in step: presenting it *is* signing in. The page reads `maker` from GET
    // and `token` from POST, so POST echoes the token it was given rather than
    // issuing one — there is nothing for this endpoint to issue.
    if (path === '/session') {
      const maker = await identity.current();
      if (method === 'POST') {
        return maker
          ? json(200, { maker, token: bearer(event.headers) })
          : json(401, { error: 'authentication required' });
      }
      return json(200, { maker });
    }

    if (path === '/submit' && method === 'POST') {
      const size = Buffer.byteLength(event.body ?? '', 'utf8');
      if (size > TRANSPORT_LIMIT_BYTES) {
        return json(413, { error: 'file too large for this endpoint', maxBytes: TRANSPORT_LIMIT_BYTES });
      }

      const result = await submit({ identity, storage: deps.storage }, bodyOf(event));
      return json(result.status, result.body);
    }

    return json(404, { error: 'not found' });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return json(400, { error: 'body is not valid JSON' });
    }
    // Logged for CloudWatch, not returned: an internal message may name a bucket
    // or a key, and the caller has no use for either.
    console.error('submit failed', error);
    return json(500, { error: 'internal error' });
  }
}

/**
 * The deployed entry point. Reads the environment exactly once, at container
 * start: the S3 client keeps connections warm across invocations, and rebuilding
 * it per request throws that away.
 */
const bucket = process.env.MIMAWSI_BUCKET ?? '';
const deps: RouteDeps = {
  storage: new S3Storage(bucket),
  operatorToken: process.env.MIMAWSI_OPERATOR_TOKEN ?? '',
  configured: bucket !== '',
};

export const handler = (event: FunctionUrlEvent): Promise<Response> => route(deps, event);

export { MAX_TOOL_BYTES, TRANSPORT_LIMIT_BYTES };
export type { FunctionUrlEvent, Response };
