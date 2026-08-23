import { createHash, randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type {
  Submission, SubmissionId, SubmissionState, Tool, ToolMetadata, UserId,
} from '@mimawsi/domain';
import { DuplicateFileError, NotFoundError } from '@mimawsi/ports';
import type { StoragePort } from '@mimawsi/ports';

/**
 * The real store: one S3 bucket, no database.
 *
 * DynamoDB is deliberately not here yet. The tables exist, but the upload path
 * needs one write and the review path needs a small list, and a bucket does both.
 * Adding a second service before anything demands it buys schema work, a second
 * failure mode and a container in the test suite, in exchange for nothing this
 * phase can use. It grows in behind StoragePort when a query appears that an
 * index file genuinely cannot answer.
 *
 * Layout mirrors LocalDirectoryStorage exactly — `pending/<id>.html`,
 * `published/<id>.html`, `index.json` — so the two adapters can be read side by
 * side and the contract suite cannot tell them apart (RULE-46).
 */

interface Persisted {
  submissions: Submission[];
  published: Tool[];
}

const EMPTY: Persisted = { submissions: [], published: [] };

/**
 * Ids become object keys, and `readPublished(id)` is reachable from an HTTP route,
 * so an id carrying `../` would address whatever the role can. S3 keys are not
 * filesystem paths and do not collapse `..` themselves, which makes this *more*
 * important here, not less: the key would be created verbatim.
 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertSafeId(id: SubmissionId): void {
  if (!SAFE_ID.test(id.value)) {
    throw new NotFoundError(`submission ${id.value}`);
  }
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The index as it was read, with the ETag that read produced. */
interface Snapshot {
  readonly state: Persisted;
  /** Absent when the index does not exist yet — the create case. */
  readonly etag: string | undefined;
}

/**
 * How many times a conflicting index write is retried before giving up. Each retry
 * re-reads, so a caller that loses is applying its change to the winner's result
 * rather than overwriting it.
 */
const MAX_ATTEMPTS = 5;

export class S3Storage implements StoragePort {
  private readonly client: S3Client;
  private readonly bucket: string;
  /** Key prefix, so a test run cannot address the live store's objects. */
  private readonly prefix: string;

  // Longhand rather than parameter properties: Node's type-stripping runs these
  // files directly and rejects that syntax, while Vitest's transform accepts it —
  // so the shorthand passes unit tests and dies in the Lambda.
  constructor(bucket: string, client: S3Client = new S3Client({}), prefix = '') {
    this.bucket = bucket;
    this.client = client;
    this.prefix = prefix === '' || prefix.endsWith('/') ? prefix : `${prefix}/`;
  }

  private key(suffix: string): string {
    return `${this.prefix}${suffix}`;
  }

  async submit(input: { bytes: Uint8Array; metadata: ToolMetadata; maker: UserId }): Promise<Submission> {
    const hash = sha256(input.bytes);

    return this.mutate(async (state) => {
      const duplicate = state.published.find((tool) => tool.sha256 === hash);
      if (duplicate) {
        throw new DuplicateFileError(duplicate.id);
      }

      const submission: Submission = {
        id: { value: randomUUID() },
        maker: input.maker,
        metadata: input.metadata,
        state: 'pending',
        sha256: hash,
        sizeBytes: input.bytes.byteLength,
      };

      // Bytes first. An index entry pointing at an object that does not exist is a
      // broken record; an orphaned object nothing references is merely litter, and
      // the bucket's lifecycle rule collects it.
      await this.putBytes(`pending/${submission.id.value}.html`, input.bytes);
      return { next: { ...state, submissions: [...state.submissions, submission] }, result: submission };
    });
  }

  async getSubmission(id: SubmissionId): Promise<Submission> {
    const found = (await this.snapshot()).state.submissions.find((s) => s.id.value === id.value);
    if (!found) {
      throw new NotFoundError(`submission ${id.value}`);
    }
    return found;
  }

  async listSubmissions(state: SubmissionState): Promise<readonly Submission[]> {
    return (await this.snapshot()).state.submissions.filter((s) => s.state === state);
  }

  async setState(id: SubmissionId, next: SubmissionState): Promise<Submission> {
    return this.mutate(async (state) => {
      const index = state.submissions.findIndex((s) => s.id.value === id.value);
      if (index === -1) {
        throw new NotFoundError(`submission ${id.value}`);
      }

      const updated: Submission = { ...(state.submissions[index] as Submission), state: next };
      const submissions = [...state.submissions];
      submissions[index] = updated;
      return { next: { ...state, submissions }, result: updated };
    });
  }

  async publish(id: SubmissionId, publishedBytes: Uint8Array): Promise<Tool> {
    assertSafeId(id);

    return this.mutate(async (state) => {
      const submission = state.submissions.find((s) => s.id.value === id.value);
      if (!submission) {
        throw new NotFoundError(`submission ${id.value}`);
      }
      if (submission.state !== 'approved') {
        throw new Error(`submission ${id.value} is ${submission.state}, not approved`);
      }

      const tool: Tool = {
        id: submission.id,
        metadata: submission.metadata,
        maker: submission.maker.value,
        // The submitted hash, not a hash of the published bytes: this is what
        // duplicate detection compares against, and it must keep identifying the
        // file the maker sent rather than the one policy injection produced.
        sha256: submission.sha256,
        sizeBytes: publishedBytes.byteLength,
      };

      await this.putBytes(`published/${id.value}.html`, publishedBytes);
      return {
        next: { ...state, published: [...state.published.filter((t) => t.id.value !== id.value), tool] },
        result: tool,
      };
    });
  }

  async listPublished(): Promise<readonly Tool[]> {
    return (await this.snapshot()).state.published;
  }

  async readPublished(id: SubmissionId): Promise<Uint8Array> {
    assertSafeId(id);
    return this.readBytes(`published/${id.value}.html`, `published tool ${id.value}`);
  }

  async readSubmittedBytes(id: SubmissionId): Promise<Uint8Array> {
    assertSafeId(id);
    return this.readBytes(`pending/${id.value}.html`, `submitted bytes for ${id.value}`);
  }

  /**
   * Read the index, apply a change, write it back only if nobody else wrote in the
   * meantime.
   *
   * LocalDirectoryStorage says plainly that it cannot close this race across
   * processes, and it could not — a directory offers no compare-and-set. S3 does:
   * a conditional PutObject fails with 412 if the ETag moved. The submit Lambda
   * and the review CLI are separate processes writing the same index, which is
   * exactly the case the fake had to leave open.
   */
  private async mutate<T>(
    change: (state: Persisted) => Promise<{ next: Persisted; result: T }>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const { state, etag } = await this.snapshot();
      const { next, result } = await change(state);

      try {
        await this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: this.key('index.json'),
            Body: `${JSON.stringify(next, null, 2)}\n`,
            ContentType: 'application/json',
            // If-Match pins the write to the version we read. If-None-Match:* is the
            // create case — it fails if anyone created the index since we found it
            // absent, so a first write cannot silently clobber another first write.
            ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }),
          }),
        );
        return result;
      } catch (error) {
        if (!isConflict(error) || attempt === MAX_ATTEMPTS) {
          throw error;
        }
        // Lost the race: loop, re-read, and re-apply against what the winner wrote.
      }
    }

    throw new Error(`index.json contended after ${MAX_ATTEMPTS} attempts`);
  }

  private async snapshot(): Promise<Snapshot> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key('index.json') }),
      );
      const body = await response.Body?.transformToString();
      return {
        state: body ? (JSON.parse(body) as Persisted) : { ...EMPTY },
        etag: response.ETag,
      };
    } catch (error) {
      if (isMissing(error)) {
        return { state: { ...EMPTY }, etag: undefined };
      }
      throw error;
    }
  }

  private async putBytes(key: string, bytes: Uint8Array): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(key),
        Body: bytes,
        // Declared, but nothing serves from this bucket: it is closed to the
        // internet and no distribution has it as an origin. An unreviewed
        // submission is hostile input until a human says otherwise.
        ContentType: 'text/html',
      }),
    );
  }

  private async readBytes(key: string, what: string): Promise<Uint8Array> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }),
      );
      const bytes = await response.Body?.transformToByteArray();
      if (!bytes) {
        throw new NotFoundError(what);
      }
      return bytes;
    } catch (error) {
      if (isMissing(error)) {
        throw new NotFoundError(what);
      }
      throw error;
    }
  }
}

/** S3 answers a missing key as NoSuchKey, and a missing *bucket* as NoSuchBucket. */
const isMissing = (error: unknown): boolean =>
  error instanceof NoSuchKey ||
  (error as { name?: string })?.name === 'NoSuchKey' ||
  (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404;

/** A conditional write that lost: 412 PreconditionFailed, or 409 on the create race. */
const isConflict = (error: unknown): boolean => {
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return status === 412 || status === 409;
};
