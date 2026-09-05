import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Maker } from '@mimawsi/domain';

/**
 * Who may approve a submission.
 *
 * Read from S3 on the server, on every decision. Never sent to a browser and
 * never cached across invocations: removing someone must take effect at once,
 * and a stale allowlist is the one kind of stale data that matters here. The
 * read costs a few milliseconds against a request that is already writing to S3.
 *
 * The page will hide buttons from people who cannot use them, but that is
 * courtesy, not enforcement. Anyone can call the endpoint directly, so this
 * check is the whole of the security and it runs server-side or not at all.
 */

/** One entry. `email` and `note` are for a human reading the file. */
interface Approver {
  readonly sub?: unknown;
}

interface AllowList {
  readonly approvers?: unknown;
}

export const APPROVERS_KEY = 'approvers.json';

export class ApproverList {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(bucket: string, client: S3Client = new S3Client({})) {
    this.bucket = bucket;
    this.client = client;
  }

  /**
   * Whether this maker may approve. Matched on the Google `sub`, never on the
   * email: Google's own guidance is that an address can change hands, so an
   * allowlist keyed on email grants authority to whoever holds the address next.
   *
   * Fails closed. A missing file, an unreadable one, malformed JSON, a network
   * error — every one of them means nobody is approved, because the alternative
   * is an outage that grants access rather than denying it.
   */
  async allows(maker: Maker | null): Promise<boolean> {
    if (!maker || maker.id.value === '') {
      return false;
    }

    let parsed: AllowList;
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: APPROVERS_KEY }),
      );
      const body = await response.Body?.transformToString();
      if (!body) {
        return false;
      }
      parsed = JSON.parse(body) as AllowList;
    } catch {
      return false;
    }

    if (!Array.isArray(parsed.approvers)) {
      return false;
    }

    // Compared as strings and exactly. A `sub` is an opaque identifier; trimming,
    // lowercasing or coercing it would be inventing equivalences Google does not
    // promise.
    return parsed.approvers.some(
      (entry: Approver) => typeof entry?.sub === 'string' && entry.sub === maker.id.value,
    );
  }
}
