import { MAX_DESCRIPTION_CHARS, MAX_TITLE_CHARS, MAX_TOOL_BYTES } from '@mimawsi/domain';
import { DuplicateFileError } from '@mimawsi/ports';
import type { IdentityPort, StoragePort } from '@mimawsi/ports';

export interface SubmitRequest {
  title: string;
  description: string;
  html: string;
}

export type SubmitResult =
  | { status: 400; body: { error: string } }
  | { status: 401; body: { error: string } }
  | { status: 413; body: { error: string; maxBytes: number } }
  | { status: 409; body: { error: string; existing: string } }
  | { status: 201; body: { id: string; state: string } };

/**
 * What the handler needs, and nothing else. It never scans and never notifies, so
 * asking for the whole Ports aggregate made every caller and every test supply two
 * dependencies this code cannot use.
 */
export interface SubmitDeps {
  readonly identity: Pick<IdentityPort, 'current'>;
  readonly storage: Pick<StoragePort, 'submit'>;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/**
 * The upload Lambda, as a plain function of its ports. Nothing here knows about
 * HTTP, S3 or DynamoDB, which is why the same code runs behind a local server in
 * phase 0 and behind a Function URL from task-3.5.
 */
export async function submit(ports: SubmitDeps, request: SubmitRequest): Promise<SubmitResult> {
  const maker = await ports.identity.current();
  if (!maker) {
    // Nothing is hashed or written on this path. Bytes must not reach storage
    // before authentication (AC-19) — refusing *after* storing would satisfy a
    // status-code test and still break the criterion.
    return { status: 401, body: { error: 'authentication required' } };
  }

  // The fields are checked before anything is encoded or stored. A request with no
  // html used to reach storage as the six characters "undefined", because encoding
  // an absent field stringifies it — a submission that looks valid and contains
  // nothing is worse than a refusal.
  const title = text(request.title);
  const html = text(request.html);
  if (title === null) {
    return { status: 400, body: { error: 'title is required' } };
  }
  if (html === null) {
    return { status: 400, body: { error: 'html is required' } };
  }

  // Metadata is bounded separately: the byte cap below measures the file only, so
  // without this a 9-byte tool could still carry megabytes of title into a record
  // that every subsequent read has to parse.
  const description = text(request.description) ?? '';
  if (title.length > MAX_TITLE_CHARS) {
    return { status: 400, body: { error: `title exceeds ${MAX_TITLE_CHARS} characters` } };
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    return {
      status: 400,
      body: { error: `description exceeds ${MAX_DESCRIPTION_CHARS} characters` },
    };
  }

  const bytes = new TextEncoder().encode(html);
  if (bytes.byteLength > MAX_TOOL_BYTES) {
    return { status: 413, body: { error: 'file too large', maxBytes: MAX_TOOL_BYTES } };
  }

  try {
    const submission = await ports.storage.submit({
      bytes,
      metadata: { title, description, tags: [] },
      maker: maker.id,
    });
    return { status: 201, body: { id: submission.id.value, state: submission.state } };
  } catch (error) {
    if (error instanceof DuplicateFileError) {
      return { status: 409, body: { error: 'already published', existing: error.existing.value } };
    }
    throw error;
  }
}
