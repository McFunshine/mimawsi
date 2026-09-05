import { describe, expect, it } from 'vitest';
import type { Maker } from '@mimawsi/domain';
import { ApproverList } from './approvers.ts';

const OWNER: Maker = { id: { value: '108056334774193947679' }, displayName: 'Owner' };
const STRANGER: Maker = { id: { value: '999999999999999999999' }, displayName: 'Stranger' };

/** A stand-in for S3 that returns whatever the test wants, including failures. */
const s3 = (body: string | Error) =>
  ({
    send: async () => {
      if (body instanceof Error) throw body;
      return { Body: { transformToString: async () => body } };
    },
  }) as never;

const listOf = (body: string | Error) => new ApproverList('bucket', s3(body));

const VALID = JSON.stringify({
  approvers: [{ sub: '108056334774193947679', email: 'owner@example.com' }],
});

describe('ApproverList', () => {
  it('allows someone on the list', async () => {
    expect(await listOf(VALID).allows(OWNER)).toBe(true);
  });

  it('refuses someone who is not', async () => {
    expect(await listOf(VALID).allows(STRANGER)).toBe(false);
  });

  it('refuses nobody signed in', async () => {
    expect(await listOf(VALID).allows(null)).toBe(false);
  });

  describe('fails closed', () => {
    // Every one of these is an outage. An outage must deny, never grant.
    it('when the file is missing', async () => {
      expect(await listOf(new Error('NoSuchKey')).allows(OWNER)).toBe(false);
    });

    it('when S3 refuses the read', async () => {
      expect(await listOf(new Error('AccessDenied')).allows(OWNER)).toBe(false);
    });

    it('when the file is not valid JSON', async () => {
      expect(await listOf('not json at all').allows(OWNER)).toBe(false);
    });

    it('when the file has no approvers array', async () => {
      expect(await listOf('{"approvers":"everyone"}').allows(OWNER)).toBe(false);
    });

    it('when the list is empty', async () => {
      expect(await listOf('{"approvers":[]}').allows(OWNER)).toBe(false);
    });
  });

  it('does not match on email, even an exact one', async () => {
    // An allowlist keyed on email grants authority to whoever holds the address
    // next. Google says a sub is stable and an address is not.
    const byEmail = JSON.stringify({ approvers: [{ email: 'owner@example.com' }] });
    expect(await listOf(byEmail).allows(OWNER)).toBe(false);
  });

  it('ignores an entry whose sub is not a string', async () => {
    const odd = JSON.stringify({ approvers: [{ sub: true }, { sub: 12345 }, { sub: null }] });
    expect(await listOf(odd).allows(OWNER)).toBe(false);
  });

  it('matches exactly, not by prefix or after trimming', async () => {
    const nearly = JSON.stringify({ approvers: [{ sub: ' 108056334774193947679 ' }] });
    expect(await listOf(nearly).allows(OWNER)).toBe(false);
    const prefix = JSON.stringify({ approvers: [{ sub: '10805633477419394' }] });
    expect(await listOf(prefix).allows(OWNER)).toBe(false);
  });
});
