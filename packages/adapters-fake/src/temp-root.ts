import { tmpdir } from 'node:os';
import { isAbsolute } from 'node:path';

/**
 * A temporary directory that is definitely somewhere temporary.
 *
 * `os.tmpdir()` returns whatever `TMPDIR` says, and some environments set it to
 * a relative path — at which point every `mkdtemp` lands in the working
 * directory instead. That scattered thirty-odd store directories through the
 * repository root before anyone noticed.
 */
export const tempRoot = (): string => (isAbsolute(tmpdir()) ? tmpdir() : '/tmp');
