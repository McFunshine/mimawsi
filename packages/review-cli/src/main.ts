/**
 * The phase-0 review surface: one command.
 *
 * Retired by task-5.1, which puts a real admin page in front of the same
 * transitions. The journey test drives whichever exists — approving is approving,
 * and TC-T01 does not care which surface performs it.
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { S3Storage } from '@mimawsi/adapters-aws';
import { fakePorts } from '@mimawsi/adapters-fake';
import { injectCsp } from '@mimawsi/injector';
import { NoSuchSubmission, selectTarget } from './select-target.ts';
import type { Tool } from '@mimawsi/domain';

const STORE =
  process.env.MIMAWSI_STORE ?? fileURLToPath(new URL('../../../.mimawsi-local/', import.meta.url));

/**
 * Which store to review.
 *
 * With MIMAWSI_BUCKET set this reviews what the upload Lambda actually received;
 * without it, the local directory, which is what the journey test drives. The
 * default is deliberately the local one — a review command that reached for
 * production because a variable was absent would be the wrong way round.
 *
 * Only storage is swapped. The scanner and notifier are still fakes here, and
 * saying so in one line is better than a second factory that hides which parts
 * are real: approving still sends nobody an email.
 */
const BUCKET = process.env.MIMAWSI_BUCKET;

/** Where published bytes must land for the runner to serve them. */
const SITE_BUCKET = process.env.MIMAWSI_SITE_BUCKET;
const RUNNER_DISTRIBUTION = process.env.MIMAWSI_RUNNER_DISTRIBUTION;
const ports = BUCKET
  ? { ...fakePorts(STORE), storage: new S3Storage(BUCKET) }
  : fakePorts(STORE);
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

  // The dev server's copy. Gitignored (RULE-5: bytes live in S3, git holds only
  // metadata), so CI never sees it and it cannot reach production this way.
  await mkdir(join(SITE, 'public/tools'), { recursive: true });
  await writeFile(join(SITE, `public/tools/${id.value}.html`), withPolicy);

  // Production. The runner distribution serves the site bucket at /tools, so this
  // is what actually makes a published tool runnable. Without it the catalogue
  // lists a tool whose bytes 404 — which is precisely what happened to the first
  // one published: the entry deployed, the file did not, because the only copy
  // was the gitignored local one.
  //
  // Done here, by the operator, rather than in the deploy workflow: RULE-17a
  // keeps Actions away from published-prefix credentials.
  if (SITE_BUCKET) {
    await new S3Client({}).send(
      new PutObjectCommand({
        Bucket: SITE_BUCKET,
        Key: `tools/${id.value}.html`,
        Body: withPolicy,
        ContentType: 'text/html; charset=utf-8',
      }),
    );

    // A new key needs no invalidation, but republishing the same id does, and the
    // caller cannot tell which case they are in. Invalidating one path is free
    // (1,000/month) and being right matters more than being frugal here.
    if (RUNNER_DISTRIBUTION) {
      await new CloudFrontClient({}).send(
        new CreateInvalidationCommand({
          DistributionId: RUNNER_DISTRIBUTION,
          InvalidationBatch: {
            CallerReference: `publish-${id.value}-${tool.sha256.slice(0, 12)}`,
            Paths: { Quantity: 1, Items: [`/${id.value}.html`] },
          },
        }),
      );
    }
  }

  // Writing into src/ is what makes the dev server re-render — the local stand-in
  // for a catalogue rebuild and a CDN invalidation.
  //
  // Written to a sibling and renamed. Astro watches this file, and writing in
  // place lets it read a half-written one: it sees a truncated module, restarts,
  // and a navigation arriving mid-restart is aborted. rename is atomic on one
  // filesystem, so the watcher observes the old file or the new one, never both.
  const published = await ports.storage.listPublished();
  const indexPath = join(SITE, 'src/data/published.json');
  const temporary = `${indexPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(published, null, 2)}\n`, 'utf8');
  await rename(temporary, indexPath);

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
