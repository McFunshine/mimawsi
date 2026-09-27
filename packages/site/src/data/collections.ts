import { collectionSlugProblem, curationOf, type Collection, type Tool } from '@mimawsi/domain';

import registry from './collections.json';
import { publishedTools } from './tools';

/**
 * The collections, as the site knows them.
 *
 * A committed snapshot, exactly like `published.json`: collections are created
 * from the approval page and live in the store, and a static build cannot read
 * S3, so what the store holds reaches the site as a commit. `add-to-catalogue.mjs`
 * writes this file from the same dispatch that adds a tool.
 */
export const COLLECTIONS: readonly Collection[] = registry;

/** A collection, its tools in the order the page should show them, and what is missing. */
export interface ResolvedCollection {
  readonly collection: Collection;
  readonly tools: readonly Tool[];
  /**
   * Pinned ids with no published tool.
   *
   * Reported rather than silently dropped. A curated page that quietly loses an
   * item is the failure mode worth designing against, so the production build
   * treats it as an error (see [collection].astro) while the dev server warns and
   * renders what it has.
   *
   * Only a pinned id can be missing. A tool assigned to a collection at approval
   * is in the catalogue by construction, because the assignment is recorded on the
   * tool itself.
   */
  readonly missing: readonly string[];
}

/**
 * Tools the front page may show, and the ones a search must be built on:
 * everything published that an approver did not mark hidden.
 *
 * `publishedTools` stays everything, because a collection page and a run page must
 * still serve a hidden tool. Hidden removes a tool from the ways of *finding* it.
 * It is not access control and must not be described as any.
 */
export const catalogueTools: readonly Tool[] = publishedTools.filter(
  (tool) => !curationOf(tool).hidden,
);

/** Collections advertised on the front page, in registry order. */
export const listedCollections: readonly Collection[] = COLLECTIONS.filter((c) => c.listed);

/**
 * Refuse a slug that cannot work before it becomes a route.
 *
 * Called from `resolveAll`, so a bad slug fails every build and every unit test
 * rather than producing a page nobody can reach.
 */
function assertUsableSlug(slug: string): void {
  const problem = collectionSlugProblem(slug);
  if (problem !== null) {
    throw new Error(`collection slug ${JSON.stringify(slug)}: ${problem}`);
  }
}

/**
 * Resolve one collection's membership against a catalogue.
 *
 * Two sources, deliberately, answering different needs:
 *
 *  - **assigned**, from the tool: `curation.collections`, ticked by an approver.
 *    The ordinary path, and it needs no commit to the site.
 *  - **pinned**, from the repository: an explicit, ordered list. The only way to
 *    place a tool published before curation existed, and the only way to fix the
 *    order of the items that open a page.
 *
 * Pinned first in their given order, then everything assigned in catalogue order.
 * A tool that is both appears once, in its pinned position.
 *
 * Exported and pure so the tests can hand it collections built in the test. A test
 * that re-implemented this logic in order to assert on it would pass with the real
 * thing broken.
 */
export function resolveMembers(
  collection: Collection,
  catalogue: readonly Tool[],
): ResolvedCollection {
  const tools: Tool[] = [];
  const missing: string[] = [];

  for (const id of collection.pinned ?? []) {
    const tool = catalogue.find((candidate) => candidate.id.value === id);
    if (tool) tools.push(tool);
    else missing.push(id);
  }

  const alreadyIn = new Set(tools.map((tool) => tool.id.value));
  for (const tool of catalogue) {
    if (alreadyIn.has(tool.id.value)) continue;
    if (curationOf(tool).collections.includes(collection.slug)) tools.push(tool);
  }

  return { collection, tools, missing };
}

/**
 * Resolve every collection against a catalogue.
 *
 * The catalogue is a parameter so the unit tests can hand it a fixture. The
 * default is the same source Astro builds pages from, and it has to be: that is
 * the *working* `published.json`, which the tracer rewrites mid-journey, so a
 * check reading anything else (HEAD, say) would fail on a tool that is in fact
 * published.
 */
export function resolveAll(catalogue: readonly Tool[] = publishedTools): ResolvedCollection[] {
  const seen = new Set<string>();
  return COLLECTIONS.map((collection) => {
    assertUsableSlug(collection.slug);
    if (seen.has(collection.slug)) {
      throw new Error(`two collections share the slug ${collection.slug}`);
    }
    seen.add(collection.slug);
    return resolveMembers(collection, catalogue);
  });
}

/** One collection by slug, or undefined if there is no such collection. */
export function resolveCollection(
  slug: string,
  catalogue: readonly Tool[] = publishedTools,
): ResolvedCollection | undefined {
  return resolveAll(catalogue).find((resolved) => resolved.collection.slug === slug);
}
