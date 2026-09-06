import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
/**
 * The maker directories the journey creates, wherever they landed.
 *
 * The journey writes its file to `mkdtemp(join(tmpdir(), 'mimawsi-maker-'))`,
 * which is correct — but on this machine `TMPDIR` is set to the repository root,
 * so os.tmpdir() returns the project and every one of them appears beside the
 * source. Six had accumulated since 22 August, along with Playwright's transform
 * cache and Node's compile cache.
 *
 * The environment is the real fault and is not this file's to fix. Clearing up
 * after itself is the test's job either way: a temp directory left behind is
 * litter in /var/folders too, it is merely invisible there.
 *
 * Guarded to the exact prefix and to directories containing nothing but the
 * journey's own file, because this deletes things and `TMPDIR` being wrong is
 * precisely the circumstance in which a broad sweep would delete the wrong ones.
 */
async function clearMakerDirectories(root: string): Promise<void> {
  const { readdir, stat } = await import('node:fs/promises');
  for (const base of new Set([root, tmpdir()])) {
    let entries: string[];
    try {
      entries = await readdir(base);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.startsWith('mimawsi-maker-')) {
        continue;
      }
      const dir = join(base, name);
      try {
        if (!(await stat(dir)).isDirectory()) {
          continue;
        }
        const contents = await readdir(dir);
        // Only ever a directory holding the one file the journey wrote.
        if (contents.length === 0 || (contents.length === 1 && contents[0] === 'shouty.html')) {
          await rm(dir, { recursive: true, force: true });
        }
      } catch {
        // A directory that vanished under us, or one we may not read. Neither is
        // worth failing a test run over.
      }
    }
  }
}

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

  await clearMakerDirectories(root);
}
