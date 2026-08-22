import { readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Returns the working tree to its committed state: no published tools beyond the
 * seed, an empty catalogue index, no local store.
 *
 * Run before a run so an interrupted previous one cannot poison this one, and
 * after a run so the journey does not leave its "Shouty Text" submission behind
 * as untracked files. The phase-0 catalogue is genuinely files on disk — that is
 * the point of it — which is exactly why the test that creates them has to clear
 * them up.
 *
 * Removes only what the index names, never the whole tools directory, which also
 * holds the committed seed tool.
 *
 * Retired by task-3.5, when the store becomes DynamoDB and resetting is a
 * fixture's job rather than a directory deletion.
 */
export async function resetLocalState(): Promise<void> {
  const root = new URL('../', import.meta.url);
  const indexPath = fileURLToPath(new URL('packages/site/src/data/published.json', root));

  let previouslyPublished: Array<{ id: { value: string } }> = [];
  try {
    previouslyPublished = JSON.parse(await readFile(indexPath, 'utf8'));
  } catch {
    previouslyPublished = [];
  }

  for (const tool of previouslyPublished) {
    await rm(fileURLToPath(new URL(`packages/site/public/tools/${tool.id.value}.html`, root)), {
      force: true,
    });
  }

  await rm(fileURLToPath(new URL('.mimawsi-local/', root)), { recursive: true, force: true });
  await writeFile(indexPath, '[]\n');
}
