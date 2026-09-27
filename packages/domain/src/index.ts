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
  /**
   * When this arrived, ISO-8601 in UTC. Optional only because submissions made
   * before this field existed have none — anything counting them must treat an
   * absent value as "too old to count" rather than as now, or a record from last
   * year would sit inside today's allowance.
   */
  readonly submittedAt?: string;
}

/**
 * What an approver decided about where a tool appears. Not metadata: metadata is
 * what the maker wrote, curation is what the operator chose, and keeping them
 * apart is what stops a submitter from putting their own tool on a curated page.
 */
export interface Curation {
  /**
   * Collection slugs this tool belongs to. A tool can be in several, or none.
   * Every slug must name a collection in `COLLECTIONS` — an unknown one is a
   * typo that would silently put the tool nowhere.
   */
  readonly collections: readonly string[];
  /**
   * Keep this tool out of the front-page listing and out of search.
   *
   * It stays published: it has a run page, it downloads, and anyone with the link
   * can use it. What hidden buys is that the only way to *find* it is a collection
   * page that names it. This is not access control and must never be described as
   * one.
   */
  readonly hidden: boolean;
}

/** A published tool, as the catalogue sees it. */
export interface Tool {
  readonly id: SubmissionId;
  readonly metadata: ToolMetadata;
  readonly maker: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  /**
   * Chosen at approval. Optional because every tool published before curation
   * existed has none — read an absent value as `NO_CURATION`, never as hidden, or
   * a deploy would empty the front page.
   */
  readonly curation?: Curation;
}

/** What an uncurated tool means: in no collection, and listed like anything else. */
export const NO_CURATION: Curation = { collections: [], hidden: false };

/** A tool's curation, with the absent case resolved. */
export const curationOf = (tool: Tool): Curation => tool.curation ?? NO_CURATION;

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

/**
 * Accepted submissions per account per rolling 24 hours.
 *
 * Rolling rather than per calendar day: a midnight reset lets an account send
 * twice the limit in a few minutes either side of it, which is exactly when
 * somebody testing the edges will try.
 */
export const DAILY_SUBMISSION_LIMIT = 20;

/** The window that limit is measured over. */
export const SUBMISSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Metadata bounds. No AC fixes these numbers — they are chosen, and they exist
 * because metadata is the one part of a submission the file-size cap does not
 * cover: a tiny html file with a 20 MiB title is inside every limit we had and
 * still bloats the record every read of the store has to parse.
 */
export const MAX_TITLE_CHARS = 200;
export const MAX_DESCRIPTION_CHARS = 2_000;

/**
 * A named, curated set of published tools with a URL of its own.
 *
 * Deliberately not the same thing as a tag. A tag is *descriptive* — supplied by
 * whoever made the tool, free text, many per tool, display only. A collection is
 * *editorial*: it has a title, a blurb, and an order somebody chose.
 *
 * The distinction is load-bearing. If a collection page were generated from
 * whatever anyone typed in a tag box, then any submitter could put their tool on
 * somebody else's page, and any typo or slur would become a live URL. A
 * collection is therefore a closed list committed to the repository and reviewed
 * the way a commit is, not an emergent property of submitted metadata.
 */
export interface Collection {
  /** URL segment. `/dina`, not `/c/dina`: the vanity path *is* the address. */
  readonly slug: string;
  readonly title: string;
  /** One paragraph under the heading. */
  readonly blurb: string;
  /**
   * Whether the collection is advertised — linked from the catalogue front page
   * and indexable — or reachable only by someone given the URL.
   *
   * Unlisted is NOT private, and nothing here should be read as claiming it is.
   * The tools in an unlisted collection are in the main catalogue, have their own
   * run pages, and download like any other. The *page* is unlisted; its contents
   * are public. A genuinely private set would mean not publishing the tools at
   * all, which is a different feature from this one.
   */
  readonly listed: boolean;
  /**
   * Ids pinned here in the repository, in the order they should appear, ahead of
   * anything an approver assigned.
   *
   * Membership normally comes from the *tool* — an approver ticks the collections
   * a submission belongs to, and `Curation.collections` records it. Pinning exists
   * for the two things that cannot express: putting a tool published before
   * curation existed into a collection without re-approving it, and fixing the
   * order of the first few items on a page where order is the point.
   */
  readonly pinned?: readonly string[];
}

/**
 * What a slug may look like: a word stub. A letter, then lowercase letters,
 * digits and underscores.
 *
 * Lowercase because a URL path is compared byte for byte, and two collections
 * differing only in case would be one page overwriting the other on a
 * case-insensitive filesystem. A leading letter because a slug starting with a
 * digit reads as an id rather than a name.
 *
 * Underscore rather than hyphen is the operator's choice. Nothing technical turns
 * on it — both are legal in a path — but one separator used consistently means a
 * slug can be typed from memory instead of guessed at.
 */
export const COLLECTION_SLUG_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Slugs a collection may not take, because the site already serves them or will.
 *
 * Collections live at the top level so that `/dina` is literally the address. The
 * cost of that is this list: Astro prefers a static route to a dynamic one, so a
 * collection called `share` would not shadow the share page — it would simply
 * never be reachable, which is worse than being refused, because it looks like it
 * worked.
 */
export const RESERVED_COLLECTION_SLUGS: readonly string[] = [
  '404',
  'api',
  'assets',
  'c',
  'index',
  'run',
  'share',
  'tools',
];

/**
 * Why a slug cannot be used, or null if it can.
 *
 * The reason rather than a boolean, so the approval page can say what is wrong
 * with what somebody typed instead of just refusing it. Every caller that stores a
 * collection runs this: a slug becomes a URL path segment and a directory name
 * before it becomes anything else.
 */
export function collectionSlugProblem(slug: unknown): string | null {
  if (typeof slug !== 'string' || slug === '') {
    return 'a slug is required';
  }
  if (!COLLECTION_SLUG_PATTERN.test(slug)) {
    return 'use lowercase letters, digits and underscores, starting with a letter';
  }
  if (RESERVED_COLLECTION_SLUGS.includes(slug)) {
    return `${slug} is already a page on the site`;
  }
  return null;
}

/**
 * Keep only the slugs naming a collection in `known`, de-duplicated and in the
 * order `known` gives them.
 *
 * Used on the approval path, where the slugs arrive in a request body. Unknown
 * slugs are dropped rather than rejected: the tick-boxes come from this same list,
 * so an unknown one means the page is working from a stale copy — and publishing
 * into the collections that do exist beats refusing the approval of a tool that
 * has already been reviewed.
 */
export function knownCollectionSlugs(
  slugs: readonly unknown[],
  known: readonly Collection[],
): readonly string[] {
  const wanted = new Set(slugs.filter((slug): slug is string => typeof slug === 'string'));
  return known.filter((collection) => wanted.has(collection.slug)).map((c) => c.slug);
}
