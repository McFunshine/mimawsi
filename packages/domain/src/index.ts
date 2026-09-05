/**
 * The vocabulary. Depends on nothing, and nothing about it is AWS-shaped —
 * that is what lets the catalogue, the Lambdas and the pipeline all speak it
 * without any of them inheriting the others' credentials (RULE-48).
 */

/** Where a submission sits. The tracer only walks pending -> approved. */
export type SubmissionState = 'pending' | 'approved' | 'rejected';

/** What a scanner concluded. Only `reject` may block a publish automatically. */
export type ScanVerdict = 'pass' | 'flag' | 'reject';

export interface UserId {
  readonly value: string;
}

export interface SubmissionId {
  readonly value: string;
}

export interface Maker {
  readonly id: UserId;
  /** Display-only. Duplicates are permitted — identity is the account, not the name. */
  readonly displayName: string;
  /**
   * Contact address, and nothing else. Never an identity: `id` is the account,
   * because Google's own guidance is that an address can change hands, and a
   * lookup keyed on email would hand a later holder someone else's submissions.
   *
   * Optional because the operator token carries no address, and because a Google
   * account whose address is unverified supplies none — an unverified address
   * belongs to whoever claimed it, not to whoever holds it.
   */
  readonly email?: string;
}

export interface ToolMetadata {
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
}

export interface Submission {
  readonly id: SubmissionId;
  readonly maker: UserId;
  readonly metadata: ToolMetadata;
  readonly state: SubmissionState;
  /** SHA-256 of the file bytes. Duplicate submissions are refused on this. */
  readonly sha256: string;
  readonly sizeBytes: number;
  /**
   * Where to write if this is rejected. Kept beside the submission rather than
   * looked up later, because by the time a rejection is written the maker may
   * have changed their address and the old one is where they are expecting to
   * hear. Absent for anything submitted with the operator token, and for
   * submissions predating this field.
   */
  readonly makerEmail?: string;
  /** Free text for a human reading the store. Never shown to the maker. */
  readonly makerNote?: string;
}

/** A published tool, as the catalogue sees it. */
export interface Tool {
  readonly id: SubmissionId;
  readonly metadata: ToolMetadata;
  readonly maker: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface ScanFinding {
  readonly rule: string;
  readonly detail: string;
}

export interface ScanResult {
  readonly verdict: ScanVerdict;
  readonly findings: readonly ScanFinding[];
}

/** 25 MiB, exactly. */
export const MAX_TOOL_BYTES = 26_214_400;

/** Accepted submissions per account per rolling 24 hours. */
export const DAILY_SUBMISSION_LIMIT = 5;

/**
 * Metadata bounds. No AC fixes these numbers — they are chosen, and they exist
 * because metadata is the one part of a submission the file-size cap does not
 * cover: a tiny html file with a 20 MiB title is inside every limit we had and
 * still bloats the record every read of the store has to parse.
 */
export const MAX_TITLE_CHARS = 200;
export const MAX_DESCRIPTION_CHARS = 2_000;
