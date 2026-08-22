import { describe, expect, it } from 'vitest';
import { NoSuchSubmission, selectTarget } from './select-target.ts';

const queue = [
  { id: { value: 'older' } },
  { id: { value: 'middle' } },
  { id: { value: 'newest' } },
];

describe('selectTarget', () => {
  it('picks the submission named by id, not the newest', () => {
    // The original defect: reject always took the newest regardless of argument.
    expect(selectTarget(queue, ['older']).target.id.value).toBe('older');
    expect(selectTarget(queue, ['middle']).target.id.value).toBe('middle');
  });

  it('leaves the arguments after the id for the caller', () => {
    // The other half of the defect: the id was consumed as the rejection reason.
    const { rest } = selectTarget(queue, ['older', 'network access', 'remove the fetch']);
    expect(rest).toEqual(['network access', 'remove the fetch']);
  });

  it('takes the newest for --latest, and does not treat the flag as a reason', () => {
    const { target, rest } = selectTarget(queue, ['--latest', 'a reason']);
    expect(target.id.value).toBe('newest');
    expect(rest).toEqual(['a reason']);
  });

  it('accepts --latest in any position', () => {
    expect(selectTarget(queue, ['--latest']).target.id.value).toBe('newest');
    expect(selectTarget(queue, ['reason', '--latest']).rest).toEqual(['reason']);
  });

  it('refuses an unknown id rather than falling back to something', () => {
    expect(() => selectTarget(queue, ['nope'])).toThrow(NoSuchSubmission);
    expect(() => selectTarget(queue, [])).toThrow(NoSuchSubmission);
  });

  it('refuses --latest on an empty queue', () => {
    expect(() => selectTarget([], ['--latest'])).toThrow(NoSuchSubmission);
  });
});
