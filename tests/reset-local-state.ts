import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Returns the working tree to its committed state: the catalogue index as
 * committed, no tool files beyond the committed ones, no local store.
 *
 * Run before a run so an interrupted previous one cannot poison this one, and
 * after a run so the journey does not leave its "Shouty Text" submission behind.
 * The phase-0 catalogue is genuinely files on disk — that is the point of it —
 * which is exactly why the test that creates them has to clear them up.
 *
 * It used to write `[]` and delete every tool the index named. That was correct
 * while nothing had ever really been published: the committed index *was* empty,
 * so emptying it and restoring it were the same act. They stopped being the same
 * the moment a real tool was published — the reset then deleted a genuine
 * catalogue entry and its file, and CI caught it as a dirty tree, which is the
 * good outcome. Silently reverting a publish would have been the bad one.
 *
 * So it asks git what is committed rather than assuming. Committed tools survive;
 * anything a test created does not.
 *
 * Retired by task-3.5, when the catalogue is generated from storage and resetting
 * is a fixture's job rather than a directory deletion.
 */
export async function resetLocalState(): Promise<void> {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const index = 'packages/site/src/data/published.json';
  const tools = 'packages/site/public/tools';

  // Whatever the run appended to the index, undone.
  await run('git', ['checkout', 'HEAD', '--', index], { cwd: root });

  // Untracked files only: -f removes what is not committed, and without -x it
  // leaves ignored files alone. The committed seed and any genuinely published
  // tool are tracked, so they stay.
  await run('git', ['clean', '-f', '--', tools], { cwd: root });

  await rm(fileURLToPath(new URL('../.mimawsi-local/', import.meta.url)), {
    recursive: true,
    force: true,
  });
}
