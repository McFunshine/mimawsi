import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

/**
 * A temporary directory that is really outside the project.
 *
 * `os.tmpdir()` reports whatever TMPDIR says, and TMPDIR is not always somewhere
 * temporary. Two environments have now got this wrong in different ways: one left
 * it relative, so every mkdtemp resolved against the working directory; another
 * set it to the repository root itself. The first version of this guard only
 * checked `isAbsolute`, which the second case passes cleanly — thirty-odd store
 * directories still appeared in the checkout.
 *
 * So the test is not "is it absolute" but "is it inside a checkout". A directory
 * under version control is not a temp directory, whatever TMPDIR claims.
 */
const insideCheckout = (start: string): boolean => {
  let current = start;
  for (;;) {
    if (existsSync(join(current, '.git'))) {
      return true;
    }
    const parent = dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
};

// Resolved once: this walks to the filesystem root, and every test asks.
let resolved: string | undefined;

export const tempRoot = (): string => {
  if (resolved === undefined) {
    const candidate = tmpdir();
    resolved = isAbsolute(candidate) && !insideCheckout(candidate) ? candidate : '/tmp';
  }
  return resolved;
};
