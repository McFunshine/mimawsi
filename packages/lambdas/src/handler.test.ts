import { describe, expect, it } from 'vitest';
import type { Submission } from '@mimawsi/domain';
import { route } from './handler.ts';
import type { FunctionUrlEvent, RouteDeps } from './handler.ts';

const TOKEN = 'operator-token';

const storage = {
  submitted: [] as unknown[],
  async submit(input: unknown): Promise<Submission> {
    this.submitted.push(input);
    return {
      id: { value: 'sub-1' },
      maker: { value: 'operator' },
      metadata: { title: 'T', description: 'D', tags: [] },
      state: 'pending',
      sha256: 'a'.repeat(64),
      sizeBytes: 3,
    };
  },
};

const deps = (): RouteDeps => ({
  storage: { submit: storage.submit.bind({ submitted: [] }) },
  operatorToken: TOKEN,
  googleClientId: '',
  configured: true,
});

const event = (
  over: Partial<FunctionUrlEvent> & { token?: string | null } = {},
): FunctionUrlEvent => {
  const headers =
    over.token === undefined
      ? { authorization: `Bearer ${TOKEN}` }
      : over.token === null
        ? {}
        : { authorization: `Bearer ${over.token}` };

  // Built by spreading rather than by assigning undefined: exactOptionalPropertyTypes
  // distinguishes "absent" from "present and undefined", and so does the real event.
  return {
    rawPath: over.rawPath ?? '/submit',
    requestContext: { http: { method: over.requestContext?.http?.method ?? 'POST' } },
    headers,
    ...(over.body === undefined ? {} : { body: over.body }),
    ...(over.isBase64Encoded === undefined ? {} : { isBase64Encoded: over.isBase64Encoded }),
  };
};

const submitBody = (html = '<p>hi</p>') => JSON.stringify({ title: 'T', description: 'D', html });

describe('route', () => {
  it('accepts a submission from the operator', async () => {
    const response = await route(deps(), event({ body: submitBody() }));
    expect(response.statusCode).toBe(201);
  });

  it('refuses a submission with no token', async () => {
    const response = await route(deps(), event({ body: submitBody(), token: null }));
    expect(response.statusCode).toBe(401);
  });

  it('refuses a submission with the wrong token', async () => {
    const response = await route(deps(), event({ body: submitBody(), token: 'guess' }));
    expect(response.statusCode).toBe(401);
  });

  it('decodes a base64 body, which is how Lambda delivers one', async () => {
    const response = await route(
      deps(),
      event({ body: Buffer.from(submitBody()).toString('base64'), isBase64Encoded: true }),
    );
    expect(response.statusCode).toBe(201);
  });

  it('reports a fault, not a refusal, when the bucket is unset', async () => {
    // The operator must not be sent hunting for a bad token when the deployment
    // is the thing that is wrong.
    const response = await route({ ...deps(), configured: false }, event({ body: submitBody() }));
    expect(response.statusCode).toBe(500);
  });

  it('refuses a file too large for the transport, naming the real limit', async () => {
    const response = await route(deps(), event({ body: submitBody('x'.repeat(6 * 1024 * 1024)) }));
    expect(response.statusCode).toBe(413);
    expect(JSON.parse(response.body).maxBytes).toBeGreaterThan(0);
  });

  it('answers a malformed body with 400 rather than 500', async () => {
    const response = await route(deps(), event({ body: 'not json' }));
    expect(response.statusCode).toBe(400);
  });

  it('reports the maker on GET /session when the token is right', async () => {
    const response = await route(
      deps(),
      event({ rawPath: '/session', requestContext: { http: { method: 'GET' } } }),
    );
    expect(JSON.parse(response.body).maker).not.toBeNull();
  });

  it('reports nobody on GET /session without a token, rather than refusing', async () => {
    // The page asks this *before* submitting to decide whether to prompt. A 401
    // here would turn a normal first visit into an error.
    const response = await route(
      deps(),
      event({ rawPath: '/session', requestContext: { http: { method: 'GET' } }, token: null }),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).maker).toBeNull();
  });

  it('never leaks an internal error message to the caller', async () => {
    const exploding: RouteDeps = {
      ...deps(),
      storage: { submit: async () => { throw new Error('bucket mimawsi-pending-123 denied'); } },
    };
    const response = await route(exploding, event({ body: submitBody() }));
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('mimawsi-pending');
  });
});
