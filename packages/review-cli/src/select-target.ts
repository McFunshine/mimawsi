/**
 * Which submission a command acts on, and which arguments are left for it.
 *
 * Extracted from the command switch so it can be tested directly: this is where
 * `reject` used to go wrong, ignoring its argument and always taking the newest
 * pending submission while filing the id you passed as the rejection reason. The
 * defect was in argument handling, so argument handling is what gets asserted.
 */

export class NoSuchSubmission extends Error {
  // Declared, not a parameter property: node's strip-only type stripping runs
  // this file directly and does not support those.
  readonly id: string | undefined;

  constructor(id: string | undefined) {
    super(`no pending submission ${id ?? ''}`);
    this.name = 'NoSuchSubmission';
    this.id = id;
  }
}

export interface Selection<T> {
  readonly target: T;
  /** What follows the target — a reason and a remedy, for reject. */
  readonly rest: string[];
}

export function selectTarget<T extends { id: { value: string } }>(
  queue: readonly T[],
  args: readonly string[],
): Selection<T> {
  const positional = args.filter((arg) => arg !== '--latest');

  if (args.includes('--latest')) {
    const target = queue[queue.length - 1];
    if (!target) {
      throw new NoSuchSubmission('--latest');
    }
    return { target, rest: positional };
  }

  const [id, ...rest] = positional;
  const target = queue.find((submission) => submission.id.value === id);
  if (!target) {
    throw new NoSuchSubmission(id);
  }
  return { target, rest };
}
