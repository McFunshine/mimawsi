import { randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { describeStoragePort } from '@mimawsi/ports/contracts';
import { S3Storage } from './storage.ts';

/**
 * The real adapter against real S3, running the same contract as the fake and not
 * a weakened copy of it (RULE-46).
 *
 * Gated on a bucket being configured, because it needs credentials and a network
 * that CI deliberately does not give the unit suite — GitHub Actions holds deploy
 * rights only (RULE-17a), and handing the test job write credentials to widen
 * coverage would trade a real security boundary for a convenience.
 *
 *   MIMAWSI_S3_TEST_BUCKET=mimawsi-pending-<acct> npm test
 *
 * Every run gets its own key prefix, so a failure leaves evidence behind rather
 * than deleting it, and two runs cannot collide. The bucket's lifecycle rule
 * collects what they leave.
 */
const bucket = process.env.MIMAWSI_S3_TEST_BUCKET;

if (bucket) {
  const client = new S3Client({});
  describeStoragePort(
    'S3Storage',
    async () => new S3Storage(bucket, client, `contract-test/${randomUUID()}`),
  );
} else {
  const { describe, it } = await import('vitest');
  describe('StoragePort contract: S3Storage', () => {
    it.skip('needs MIMAWSI_S3_TEST_BUCKET — see the comment in this file', () => {});
  });
}
