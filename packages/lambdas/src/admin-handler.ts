/**
 * The deployed entry point for the approval endpoint.
 *
 * Reads the environment once, at container start, for the same reason
 * handler.ts does: the S3 and SES clients keep connections warm across
 * invocations and rebuilding them per request throws that away.
 *
 * Note what is absent. There is no operator token here. The submit endpoint
 * accepts one because scripts and the publishing path need a credential that does
 * not depend on Google being reachable; this endpoint publishes to the live site,
 * and a long-lived bearer string in an environment variable is not what should
 * guard that. Approving is Google-only, checked against the allowlist.
 */
import { ApproverList, S3Storage, emailNotifier, googleIdentity } from '@mimawsi/adapters-aws';
import type { Maker } from '@mimawsi/domain';
import { route } from './admin.ts';
import type { AdminDeps, AdminEvent, AdminResponse } from './admin.ts';

const bucket = process.env.MIMAWSI_BUCKET ?? '';
const adminBucket = process.env.MIMAWSI_ADMIN_BUCKET ?? '';
const googleClientId = process.env.GOOGLE_CLIENT_ID ?? '';

const storage = new S3Storage(bucket);
const approvers = new ApproverList(adminBucket);

const deps: AdminDeps = {
  storage,
  identify: (token: string | null): Promise<Maker | null> =>
    googleIdentity(token, googleClientId).current(),
  allows: (maker: Maker | null) => approvers.allows(maker),
  notifier: emailNotifier({
    // Read at send time from the submission itself, so the address used is the one
    // captured when the file was sent rather than whatever an account says now.
    addressFor: async (id: string) => {
      try {
        return (await storage.getSubmission({ value: id })).makerEmail;
      } catch {
        return undefined;
      }
    },
  }),
  targets: {
    siteBucket: process.env.MIMAWSI_SITE_BUCKET,
    runnerDistribution: process.env.MIMAWSI_RUNNER_DISTRIBUTION,
  },
  googleClientId,
  // Both buckets, not one. Without the admin bucket the allowlist cannot be read,
  // and ApproverList fails closed — which would look like "you are not an
  // approver" to the one person who is, rather than like the misconfiguration it
  // is.
  configured: bucket !== '' && adminBucket !== '',
};

export const handler = (event: AdminEvent): Promise<AdminResponse> => route(deps, event);
