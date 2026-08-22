/**
 * The phase-0 review surface: one command.
 *
 * Retired by task-5.1, which puts a real admin page in front of the same
 * transitions. The journey test drives whichever exists — approving is approving,
 * and TC-T01 does not care which surface performs it.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakePorts } from '@mimawsi/adapters-fake';
import { injectCsp } from '@mimawsi/injector';
import { NoSuchSubmission, selectTarget } from './select-target.ts';
import type { Tool } from '@mimawsi/domain';

const STORE =
  process.env.MIMAWSI_STORE ?? fileURLToPath(new URL('../../../.mimawsi-local/', import.meta.url));

const ports = fakePorts(STORE);
const [command, ...rest] = process.argv.slice(2);

const SITE = fileURLToPath(new URL('../../site/', import.meta.url));

/**
 * The publish step: inject the policy, store the published bytes, then put them
 * where the catalogue serves from and regenerate its index.
 *
 * In production this is a GitHub Actions workflow writing to the published S3
 * prefix and invalidating CloudFront. Here it is two file writes — but the order
 * is the same, and the policy is injected before the bytes are published either
 * way, which is the part that matters.
 */
async function publish(id: { value: string }): Promise<Tool> {
  const raw = await ports.storage.readSubmittedBytes(id);
  const withPolicy = new TextEncoder().encode(injectCsp(new TextDecoder().decode(raw)));

  const tool = await ports.storage.publish(id, withPolicy);

  await mkdir(join(SITE, 'public/tools'), { recursive: true });
  await writeFile(join(SITE, `public/tools/${id.value}.html`), withPolicy);

  // Writing into src/ is what makes the dev server re-render — the local stand-in
  // for a catalogue rebuild and a CDN invalidation.
  const published = await ports.storage.listPublished();
  await writeFile(
    join(SITE, 'src/data/published.json'),
    `${JSON.stringify(published, null, 2)}\n`,
    'utf8',
  );

  return tool;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function pending() {
  const queue = await ports.storage.listSubmissions('pending');
  if (queue.length === 0) {
    fail('nothing pending');
  }
  return queue;
}

/** selectTarget throws; the CLI exits with a message instead of a stack trace. */
function select<T extends { id: { value: string } }>(queue: readonly T[], args: readonly string[]) {
  try {
    return selectTarget(queue, args);
  } catch (error) {
    if (error instanceof NoSuchSubmission) {
      fail(error.message);
    }
    throw error;
  }
}

switch (command) {
  case 'list': {
    for (const submission of await ports.storage.listSubmissions('pending')) {
      process.stdout.write(`${submission.id.value}  ${submission.metadata.title}\n`);
    }
    break;
  }

  case 'approve': {
    const { target } = select(await pending(), rest);

    await ports.storage.setState(target.id, 'approved');
    const tool = await publish(target.id);
    await ports.notifier.notify({ kind: 'approved', submission: target.id, maker: target.maker });
    process.stdout.write(`approved and published ${tool.id.value} (${tool.metadata.title})\n`);
    break;
  }

  case 'reject': {
    const { target, rest: reasonArgs } = select(await pending(), rest);

    await ports.storage.setState(target.id, 'rejected');
    await ports.notifier.notify({
      kind: 'rejected',
      submission: target.id,
      maker: target.maker,
      reason: reasonArgs[0] ?? 'unspecified',
      remedy: reasonArgs[1] ?? 'unspecified',
    });
    process.stdout.write(`rejected ${target.id.value}\n`);
    break;
  }

  default:
    fail('usage: review <list|approve|reject> [--latest|<id>] [reason] [remedy]');
}
