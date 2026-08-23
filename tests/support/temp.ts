import { tmpdir } from 'node:os';
import { isAbsolute } from 'node:path';

/**
 * As packages/adapters-fake/src/temp-root.ts, duplicated deliberately: nothing
 * in packages/ may import from tests/ and nothing here reaches the other way,
 * so a five-line guard is cheaper than a shared package.
 *
 * `os.tmpdir()` honours a relative `TMPDIR`, and then `mkdtemp` writes into the
 * working directory rather than anywhere temporary.
 */
export const tempRoot = (): string => (isAbsolute(tmpdir()) ? tmpdir() : '/tmp');
