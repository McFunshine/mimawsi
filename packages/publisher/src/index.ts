import { CreateInvalidationCommand, CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { SubmissionId, Tool } from '@mimawsi/domain';
import { injectCsp } from '@mimawsi/injector';
import type { ReviewStorage, StoragePort } from '@mimawsi/ports';

/**
 * Making an approved submission reachable.
 *
 * Extracted so the review CLI and the approval endpoint run the same code rather
 * than two copies of it. They had begun to diverge — the CLI grew a step to put
 * bytes where the runner serves them and nothing else knew about it, which is
 * exactly how a catalogue ends up listing a tool whose file was never uploaded.
 *
 * The order matters and is the same in both callers: inject the policy, record
 * the publication, then put the bytes where they are served. A file served
 * before its policy is injected is a file served without a policy.
 */

export interface PublishTargets {
  /** Bucket the runner distribution serves at /tools. */
  readonly siteBucket?: string | undefined;
  /** Distribution to invalidate, so a republished tool is not served stale. */
  readonly runnerDistribution?: string | undefined;
}

export interface PublishDeps {
  readonly storage: Pick<StoragePort, 'publish'> & Pick<ReviewStorage, 'readSubmittedBytes'>;
  readonly s3?: S3Client;
  readonly cloudfront?: CloudFrontClient;
}

export interface Published {
  readonly tool: Tool;
  /** The exact bytes now being served, policy included. */
  readonly bytes: Uint8Array;
}

export async function publishSubmission(
  deps: PublishDeps,
  id: SubmissionId,
  targets: PublishTargets = {},
): Promise<Published> {
  const raw = await deps.storage.readSubmittedBytes(id);
  const withPolicy = new TextEncoder().encode(injectCsp(new TextDecoder().decode(raw)));

  // Recorded before the bytes are served. If this throws, nothing is reachable
  // and the submission stays as it was; the other order would leave a file
  // published that the store has no record of.
  const tool = await deps.storage.publish(id, withPolicy);

  if (targets.siteBucket) {
    const s3 = deps.s3 ?? new S3Client({});
    await s3.send(
      new PutObjectCommand({
        Bucket: targets.siteBucket,
        Key: `tools/${id.value}.html`,
        Body: withPolicy,
        ContentType: 'text/html; charset=utf-8',
      }),
    );

    // Unconditional. A new key needs no invalidation and a republished id does,
    // and the caller cannot tell which case it is in. One path is free.
    if (targets.runnerDistribution) {
      const cloudfront = deps.cloudfront ?? new CloudFrontClient({});
      await cloudfront.send(
        new CreateInvalidationCommand({
          DistributionId: targets.runnerDistribution,
          InvalidationBatch: {
            CallerReference: `publish-${id.value}-${Date.now()}`,
            Paths: { Quantity: 1, Items: [`/${id.value}.html`] },
          },
        }),
      );
    }
  }

  return { tool, bytes: withPolicy };
}
