/**
 * The runner origin.
 *
 * Published tools execute here and nowhere else. In production this is a second
 * CloudFront distribution over the same S3 prefix the catalogue downloads from —
 * one copy of the bytes, two origins. In phase 0 it is this, on port 4322, reading
 * the same directory the catalogue serves downloads from.
 *
 * A different port is a different origin as far as the browser is concerned, so the
 * isolation the tests assert is the real thing rather than a simulation of it.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = fileURLToPath(new URL('../../site/public/tools/', import.meta.url));
const PORT = Number(process.env.RUNNER_PORT ?? 4322);
const CATALOGUE = process.env.CATALOGUE_ORIGIN ?? 'http://localhost:4321';

createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;

  // The only non-tool route on this origin. Readiness checks need something that
  // answers 200, and pointing them at a seed tool would couple them to content.
  if (path === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  // basename() strips any traversal; only files directly in the tools dir are reachable.
  const name = basename(path);

  if (!name.endsWith('.html')) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }

  try {
    const body = await readFile(join(TOOLS, name));
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      // Only the catalogue may frame a tool. Belt and braces alongside the
      // sandbox attribute — this one the tool cannot influence.
      'content-security-policy': `frame-ancestors ${CATALOGUE}`,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      // A delisted or edited tool must stop running, and a cached copy would keep
      // running. Correctness here, not just hygiene.
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(PORT, () => {
  process.stdout.write(`runner origin on http://localhost:${PORT}\n`);
});
