/**
 * Local host for the phase-0 Lambdas. Retired when the handlers move behind
 * Function URLs; the handlers themselves do not change, because they are
 * functions of their ports rather than of HTTP.
 *
 * Deliberately a separate origin from the catalogue, so CORS is exercised from
 * day one rather than discovered at task-3.5.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { fakePorts } from '@mimawsi/adapters-fake';
import { MAX_TOOL_BYTES } from '@mimawsi/domain';
import type { Maker } from '@mimawsi/domain';
import type { IdentityPort } from '@mimawsi/ports';
import { submit } from './submit.ts';
import type { SubmitRequest } from './submit.ts';

const PORT = Number(process.env.API_PORT ?? 4323);
const CATALOGUE = process.env.CATALOGUE_ORIGIN ?? 'http://localhost:4321';
const STORE =
  process.env.MIMAWSI_STORE ?? fileURLToPath(new URL('../../../.mimawsi-local/', import.meta.url));

const ports = fakePorts(STORE);
const MAKER: Maker = { id: { value: 'stub-maker' }, displayName: 'Stub Maker' };

/**
 * Phase-0 stand-in for the session cookie the design calls for (task-3.4 issues a
 * signed one from the Google exchange). A bearer token rather than a cookie only
 * because cross-origin cookies over plain http need SameSite=None; Secure, which
 * is more ceremony than a placeholder deserves.
 *
 * Per-client, deliberately. It began as a process-wide flag and that made TC-T01
 * flaky: a reused server stayed signed in between runs, so the sign-in step
 * sometimes never appeared. Session state belonging to the process rather than
 * the caller is wrong in production too — this is the shape, just with a weaker
 * token.
 */
const sessions = new Set<string>();

function identityFor(token: string | null): IdentityPort {
  return {
    current: async () => (token !== null && sessions.has(token) ? MAKER : null),
    signIn: async () => {
      if (token !== null) {
        sessions.add(token);
      }
      return MAKER;
    },
    signOut: async () => {
      if (token !== null) {
        sessions.delete(token);
      }
    },
  };
}

function tokenOf(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') === true ? header.slice('Bearer '.length) : null;
}

const cors: Record<string, string> = {
  'access-control-allow-origin': CATALOGUE,
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', ...cors });
  res.end(JSON.stringify(body));
}

/** Refusals that map to a status rather than to a 500. */
class BadRequest extends Error {}
class TooLarge extends Error {}

/**
 * Generous enough that a file at the 25 MiB cap still reaches the handler and is
 * refused there with the documented maxBytes — JSON escaping can inflate the html
 * field considerably, so the transport cap sits well above the file cap and only
 * exists to stop an unbounded upload.
 */
const MAX_BODY_BYTES = MAX_TOOL_BYTES * 2 + 65_536;

/**
 * Buffers the body with a ceiling. Reading an entire stream into memory with no
 * limit is a free out-of-memory kill for anyone who can reach the port, and a
 * body that is not valid JSON is the caller's mistake, not a server fault.
 */
async function readBody(req: IncomingMessage): Promise<SubmitRequest> {
  const chunks: Buffer[] = [];
  let received = 0;

  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    received += buffer.byteLength;
    if (received > MAX_BODY_BYTES) {
      req.destroy();
      throw new TooLarge('request body too large');
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw === '') {
    return {} as SubmitRequest;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequest('body is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequest('body must be a JSON object');
  }
  return parsed as SubmitRequest;
}

createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  try {
    if (path === '/health') {
      json(res, 200, { ok: true });
      return;
    }
    if (path === '/session' && req.method === 'GET') {
      json(res, 200, { maker: await identityFor(tokenOf(req)).current() });
      return;
    }
    if (path === '/session' && req.method === 'POST') {
      // The client brings its own token; the server only records that it signed in.
      const token = tokenOf(req) ?? randomUUID();
      const maker = await identityFor(token).signIn();
      json(res, 200, { maker, token });
      return;
    }
    if (path === '/submit' && req.method === 'POST') {
      const identity = identityFor(tokenOf(req));
      const result = await submit({ ...ports, identity }, await readBody(req));
      json(res, result.status, result.body);
      return;
    }
    json(res, 404, { error: 'not found' });
  } catch (error) {
    if (error instanceof BadRequest) {
      json(res, 400, { error: error.message });
      return;
    }
    if (error instanceof TooLarge) {
      json(res, 413, { error: error.message, maxBytes: MAX_TOOL_BYTES });
      return;
    }
    json(res, 500, { error: error instanceof Error ? error.message : 'unknown' });
  }
}).listen(PORT, () => {
  process.stdout.write(`api on http://localhost:${PORT} (store: ${STORE})\n`);
});
