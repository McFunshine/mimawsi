import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type {
  Submission, SubmissionId, SubmissionState, Tool, ToolMetadata, UserId,
} from '@mimawsi/domain';
import { DuplicateFileError, NotFoundError } from '@mimawsi/ports';
import type { StoragePort } from '@mimawsi/ports';

/**
 * Retired by task-3.5 (S3 + DynamoDB).
 *
 * Genuinely on disk, not in memory: the submit endpoint and the review CLI are
 * separate processes and have to see the same records. Storage that does not
 * survive the process is not storage, and faking it that way would have hidden
 * a real constraint until the day something else had to read the data.
 *
 * Read-modify-write, serialised within a process and atomic at the index file.
 * That is as far as a directory can honestly go: the submit server and the review
 * CLI are separate processes, so two of them mutating the same store still race.
 * Closing that properly is what DynamoDB's conditional writes do at task-3.5 —
 * this keeps the single-process case correct without pretending to more.
 */

interface Persisted {
  submissions: Submission[];
  published: Tool[];
}

const EMPTY: Persisted = { submissions: [], published: [] };

/**
 * Ids become path segments, so they are checked before they are interpolated. A
 * submission id is generated here (a uuid) or seeded (`word-counter`), never
 * supplied by a caller — but `readPublished(id)` grows an HTTP route the moment
 * storage becomes S3 at task-3.5, and an id carrying `../` would then read
 * whatever the process can. Validating at the boundary that builds the path
 * means no future caller has to remember to.
 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertSafeId(id: SubmissionId): void {
  if (!SAFE_ID.test(id.value) || id.value.includes('..')) {
    throw new NotFoundError(`submission ${id.value}`);
  }
}
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export class LocalDirectoryStorage implements StoragePort {
  private readonly root: string;

  /** Tail of the in-process write chain. See the note on `mutate`. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.root = root;
  }

  /**
   * Runs a read-modify-write with no other one from this process interleaved.
   * Without it two concurrent submits both read the same index and the second
   * write drops the first submission. Cross-process races remain — see the note
   * at the top of the file.
   */
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(operation, operation);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async submit(input: { bytes: Uint8Array; metadata: ToolMetadata; maker: UserId }): Promise<Submission> {
    return this.mutate(async () => {
      const state = await this.read();
      const hash = sha256(input.bytes);

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

      await this.writeFileAt(`pending/${submission.id.value}.html`, input.bytes);
      state.submissions.push(submission);
      await this.write(state);
      return submission;
    });
  }

  async getSubmission(id: SubmissionId): Promise<Submission> {
    const found = (await this.read()).submissions.find((s) => s.id.value === id.value);
    if (!found) {
      throw new NotFoundError(`submission ${id.value}`);
    }
    return found;
  }

  async listSubmissions(state: SubmissionState): Promise<readonly Submission[]> {
    return (await this.read()).submissions.filter((s) => s.state === state);
  }

  async setState(id: SubmissionId, next: SubmissionState): Promise<Submission> {
    return this.mutate(async () => {
      const state = await this.read();
      const index = state.submissions.findIndex((s) => s.id.value === id.value);
      if (index === -1) {
        throw new NotFoundError(`submission ${id.value}`);
      }

      const existing = state.submissions[index] as Submission;
      const updated: Submission = { ...existing, state: next };
      state.submissions[index] = updated;
      await this.write(state);
      return updated;
    });
  }

  async publish(id: SubmissionId, publishedBytes: Uint8Array): Promise<Tool> {
    return this.mutate(async () => {
      const state = await this.read();
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
        sha256: submission.sha256,
        sizeBytes: publishedBytes.byteLength,
      };

      await this.writeFileAt(`published/${id.value}.html`, publishedBytes);
      state.published = [...state.published.filter((t) => t.id.value !== id.value), tool];
      await this.write(state);
      return tool;
    });
  }

  async listPublished(): Promise<readonly Tool[]> {
    return (await this.read()).published;
  }

  async readPublished(id: SubmissionId): Promise<Uint8Array> {
    assertSafeId(id);
    return this.readFileAt(`published/${id.value}.html`, `published tool ${id.value}`);
  }

  async readSubmittedBytes(id: SubmissionId): Promise<Uint8Array> {
    assertSafeId(id);
    return this.readFileAt(`pending/${id.value}.html`, `submitted bytes for ${id.value}`);
  }

  /** Wipes the store. Phase-0 convenience for tests and local resets only. */
  async reset(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }

  private get indexPath(): string {
    return join(this.root, 'index.json');
  }

  /**
   * A missing index is the empty store — that is the first run, and it is normal.
   * Anything else is not. An unreadable or half-written index used to land in the
   * same branch and silently return an empty store, so the next write persisted
   * that emptiness and every submission and published tool was gone. Corruption
   * has to be loud: losing the store quietly is worse than refusing to start.
   */
  private async read(): Promise<Persisted> {
    let raw: string;
    try {
      raw = await readFile(this.indexPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return structuredClone(EMPTY);
      }
      throw error;
    }

    try {
      return JSON.parse(raw) as Persisted;
    } catch (error) {
      throw new Error(
        `corrupted storage index at ${this.indexPath}: ${(error as Error).message}`,
        { cause: error },
      );
    }
  }

  /**
   * Written to a sibling then renamed. rename is atomic on the same filesystem,
   * so a reader sees either the whole previous index or the whole next one, and
   * a crash mid-write can no longer leave a half-written file behind.
   */
  private async write(state: Persisted): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const temporary = `${this.indexPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
    await rename(temporary, this.indexPath);
  }

  /**
   * Last line of defence: whatever the segment turned out to be, the resolved
   * path has to still be inside the store. Cheap, and it does not depend on the
   * id check above having been remembered.
   */
  private within(relative: string): string {
    const root = resolve(this.root);
    const path = resolve(root, relative);
    if (path !== root && !path.startsWith(root + sep)) {
      throw new NotFoundError(`path outside the store: ${relative}`);
    }
    return path;
  }

  private async writeFileAt(relative: string, bytes: Uint8Array): Promise<void> {
    const path = this.within(relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  private async readFileAt(relative: string, what: string): Promise<Uint8Array> {
    const path = this.within(relative);
    try {
      return new Uint8Array(await readFile(path));
    } catch {
      throw new NotFoundError(what);
    }
  }
}
