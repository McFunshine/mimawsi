import type {
  Collection,
  Curation,
  Maker,
  ScanResult,
  Submission,
  SubmissionId,
  SubmissionState,
  Tool,
  ToolMetadata,
  UserId,
} from '@mimawsi/domain';

/**
 * The four places mimawsi talks to something outside itself. Product code reaches
 * storage, identity, scanning and notification only through these (RULE-46), which
 * is what lets phase 0 run entirely on a laptop and every later phase be a swap.
 *
 * Each is deliberately small. They were shaped by what the tracer journey actually
 * does, not by what S3, Google, semgrep or SES happen to offer.
 */

export class DuplicateFileError extends Error {
  readonly existing: SubmissionId;

  constructor(existing: SubmissionId) {
    super(`file already published as ${existing.value}`);
    this.name = 'DuplicateFileError';
    this.existing = existing;
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

/**
 * Storage, split by who actually needs what. One adapter still implements the lot
 * — the store is one thing and StoragePort is still the port it satisfies — but
 * the upload handler, the review surface and the catalogue each depend on the
 * slice they use rather than on all of it. That is what keeps a test double for
 * the upload path from having to grow a publish method it never calls, and it is
 * the seam the read-only catalogue keeps when storage becomes S3 at task-3.5.
 */

/** What the upload path needs. */
export interface SubmissionWriter {
  /**
   * Stores the file and its pending record together. Throws DuplicateFileError if
   * these exact bytes are already published — the check belongs here because only
   * storage knows what it already holds.
   */
  submit(input: {
    bytes: Uint8Array;
    metadata: ToolMetadata;
    maker: UserId;
    /**
     * Where to write if this is rejected. Optional: the operator token carries no
     * address, and a Google account with an unverified one supplies none. A
     * rejection without it is still recorded, it just is not posted.
     */
    makerEmail?: string | undefined;
  }): Promise<Submission>;

  /**
   * How many submissions this account has made since `since`.
   *
   * A count rather than a list: the caller needs a number, and handing it every
   * record a maker ever sent so it can measure the length would make the cost of
   * the check grow with the busiest account on the site.
   */
  countSince(maker: UserId, since: Date): Promise<number>;
}

/** What the review surface needs: the queue, and the bytes it is judging. */
export interface ReviewStorage {
  getSubmission(id: SubmissionId): Promise<Submission>;
  listSubmissions(state: SubmissionState): Promise<readonly Submission[]>;
  setState(id: SubmissionId, state: SubmissionState): Promise<Submission>;
  readSubmittedBytes(id: SubmissionId): Promise<Uint8Array>;
}

/**
 * The collections a tool may be approved into.
 *
 * In the store rather than in code, because they are created from the approval
 * page at runtime. The site keeps a committed snapshot in `collections.json` — the
 * same arrangement `published.json` already has, and for the same reason: a static
 * build cannot read S3, so what the store holds reaches the site as a commit.
 */
export interface CollectionStore {
  listCollections(): Promise<readonly Collection[]>;
  /**
   * Adds a collection. Throws if the slug is already taken — a silent overwrite
   * would rename somebody else's page and move every tool in it.
   */
  createCollection(collection: Collection): Promise<Collection>;
}

/** What the catalogue needs. Read-only on purpose — it must never be able to mutate. */
export interface CatalogueReader {
  listPublished(): Promise<readonly Tool[]>;
  readPublished(id: SubmissionId): Promise<Uint8Array>;
}

/** Bytes and submission records. Becomes S3 + DynamoDB at task-3.5. */
export interface StoragePort
  extends SubmissionWriter,
    ReviewStorage,
    CatalogueReader,
    CollectionStore {
  /**
   * Moves an approved submission's bytes into the published set, policy already
   * injected.
   *
   * `curation` is the approver's choice of collections and whether the tool is
   * hidden, and it is recorded here rather than only in the dispatch that updates
   * the catalogue index. That matters: `npm run publish` rebuilds the index
   * wholesale from the store, so curation kept only in the dispatch payload would
   * be erased by the next rebuild. Omitted means `NO_CURATION` — in no collection,
   * listed like anything else.
   */
  publish(id: SubmissionId, publishedBytes: Uint8Array, curation?: Curation): Promise<Tool>;
}

/** Who is asking. Becomes Google OAuth at task-3.4. */
export interface IdentityPort {
  /** The signed-in maker, or null. No side effects — never triggers a sign-in. */
  current(): Promise<Maker | null>;
  signIn(): Promise<Maker>;
  signOut(): Promise<void>;
}

/** Whether a file may be published. Becomes semgrep in Actions at task-4.2. */
export interface ScannerPort {
  scan(bytes: Uint8Array): Promise<ScanResult>;
}

export type NotifiableEvent =
  | { kind: 'approved'; submission: SubmissionId; maker: UserId }
  | { kind: 'rejected'; submission: SubmissionId; maker: UserId; reason: string; remedy: string };

/** Telling a maker what happened. Becomes SES at task-5.4. */
export interface NotifierPort {
  notify(event: NotifiableEvent): Promise<void>;
}

export interface Ports {
  readonly storage: StoragePort;
  readonly identity: IdentityPort;
  readonly scanner: ScannerPort;
  readonly notifier: NotifierPort;
}
