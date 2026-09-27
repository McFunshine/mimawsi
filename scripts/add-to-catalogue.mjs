/**
 * Add one published tool to the catalogue index.
 *
 * The same edit the review CLI makes locally, made from a dispatch payload
 * instead. Kept as a script rather than inline in the workflow so it can be read,
 * reasoned about and run by hand when a publish needs catching up:
 *
 *   node scripts/add-to-catalogue.mjs payload.json
 *
 * It appends rather than regenerating from S3, because CI has no credentials for
 * the store — the deploy role can write the site bucket and nothing else. That is
 * a deliberately small blast radius, and the cost is this file being append-only.
 * `npm run publish` remains the way to rebuild it wholesale from the store.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const INDEX = fileURLToPath(new URL('../packages/site/src/data/published.json', import.meta.url));
const COLLECTIONS = fileURLToPath(
  new URL('../packages/site/src/data/collections.json', import.meta.url),
);

const payload = JSON.parse(readFileSync(process.argv[2] ?? '/dev/stdin', 'utf8'));

for (const required of ['id', 'title']) {
  if (typeof payload[required] !== 'string' || payload[required] === '') {
    console.error(`payload is missing ${required}`);
    process.exit(1);
  }
}

// The id becomes a URL path segment on the catalogue page, and arrives from a
// dispatch. Constrained here rather than trusted — the same expression the store
// applies before an id is allowed to become an S3 key.
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(payload.id)) {
  console.error(`id is not a safe key: ${payload.id}`);
  process.exit(1);
}

const published = JSON.parse(readFileSync(INDEX, 'utf8'));
if (!Array.isArray(published)) {
  console.error('published.json is not an array; refusing to write');
  process.exit(1);
}

/**
 * Collection slugs, constrained the same way the id is: this arrives from a
 * dispatch and is written into a file the site builds routes from. An unknown or
 * malformed slug would put the tool on no page at all while the record claimed
 * otherwise, so anything that is not a plain lowercase slug is dropped.
 *
 * Not checked against the collection registry here on purpose — this script runs in
 * CI from a checkout that may be older or newer than the Lambda that sent the
 * payload, and the site's own build is what refuses a slug with no page.
 */
const SLUG = /^[a-z][a-z0-9_]{0,63}$/;

const slugs = (value) =>
  Array.isArray(value)
    ? [...new Set(value.filter((s) => typeof s === 'string' && SLUG.test(s)))]
    : [];

const entry = {
  id: { value: payload.id },
  metadata: {
    title: payload.title,
    description: typeof payload.description === 'string' ? payload.description : '',
    tags: [],
  },
  curation: {
    collections: slugs(payload.curation?.collections),
    // Strictly `=== true`: an absent field must mean listed. Anything looser would
    // let a missing value read as truthy one day and empty the front page.
    hidden: payload.curation?.hidden === true,
  },
  maker: typeof payload.maker === 'string' && payload.maker !== '' ? payload.maker : 'operator',
  // The submitted hash, matching what the store records. See the note in
  // adapters-aws/src/storage.ts: this identifies the file the maker sent, which is
  // what duplicate detection compares against.
  sha256: typeof payload.sha256 === 'string' ? payload.sha256 : '',
  sizeBytes: typeof payload.sizeBytes === 'number' ? payload.sizeBytes : 0,
};

const existing = published.findIndex((tool) => tool?.id?.value === payload.id);
if (existing === -1) {
  published.push(entry);
} else {
  // Replaced rather than skipped: a republish of the same id is a real case, and
  // leaving the old title and size behind would describe the previous file.
  published[existing] = entry;
}

/*
 * The collections this tool was put in, added to the site's own copy of the
 * registry if they are not already there.
 *
 * Collections are created on the approval page and live in the store; the site
 * cannot read the store at build time, so they arrive here the same way tools do.
 * A collection therefore appears on the site with its first published member,
 * which is also when it first has anything to show.
 *
 * Existing entries are left alone. `listed` and `pinned` are edited in this file
 * by hand — putting a collection on the front page is a commit, not a checkbox on
 * the approval page — and an upsert from a dispatch would undo that.
 *
 * Both files are read and computed BEFORE either is written. They were not, once,
 * and a crash in this section left the tool added to the catalogue and its
 * collection missing — published, curated, and with no page. Writes go last.
 */
const defined = Array.isArray(payload.curation?.defined) ? payload.curation.defined : [];
const registry = JSON.parse(readFileSync(COLLECTIONS, 'utf8'));
if (!Array.isArray(registry)) {
  console.error('collections.json is not an array; refusing to write');
  process.exit(1);
}

let addedCollections = 0;
for (const collection of defined) {
  if (!SLUG.test(collection?.slug ?? '')) {
    console.error(
      `skipping a collection with an unusable slug: ${JSON.stringify(collection?.slug)}`,
    );
    continue;
  }
  if (registry.some((known) => known?.slug === collection.slug)) {
    continue;
  }
  registry.push({
    slug: collection.slug,
    title: typeof collection.title === 'string' ? collection.title : collection.slug,
    blurb: typeof collection.blurb === 'string' ? collection.blurb : '',
    listed: collection.listed === true,
  });
  addedCollections += 1;
}

// Both writes, after everything that could throw.
writeFileSync(INDEX, `${JSON.stringify(published, null, 2)}\n`, 'utf8');
if (addedCollections > 0) {
  writeFileSync(COLLECTIONS, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

console.log(
  `${existing === -1 ? 'added' : 'updated'} ${payload.id} (${payload.title})` +
    (addedCollections > 0 ? `, and ${addedCollections} new collection(s)` : ''),
);
