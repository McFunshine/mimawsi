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

const entry = {
  id: { value: payload.id },
  metadata: {
    title: payload.title,
    description: typeof payload.description === 'string' ? payload.description : '',
    tags: [],
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
  console.log(`added ${payload.id} (${payload.title})`);
} else {
  // Replaced rather than skipped: a republish of the same id is a real case, and
  // leaving the old title and size behind would describe the previous file.
  published[existing] = entry;
  console.log(`updated ${payload.id} (${payload.title})`);
}

writeFileSync(INDEX, `${JSON.stringify(published, null, 2)}\n`, 'utf8');
