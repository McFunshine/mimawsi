import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { JWTVerifyGetKey, KeyLike } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { googleIdentity } from './google-identity.ts';

/**
 * Verified against a keypair this test owns, standing in for Google's.
 *
 * That makes the checks real rather than mocked: a token that fails here fails
 * for the same reason a forged one would fail in production — the signature, the
 * audience or the expiry, checked by the same library doing the same work.
 */
const OURS = '708712241310-example.apps.googleusercontent.com';
const SOMEONE_ELSE = '999999999999-other.apps.googleusercontent.com';

let privateKey: KeyLike;
let keys: JWTVerifyGetKey;
let wrongKeys: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  keys = async () => pair.publicKey;

  // A different keypair entirely: what a forged token verifies against.
  const other = await generateKeyPair('RS256');
  wrongKeys = async () => other.publicKey;
  await exportJWK(pair.publicKey);
});

const token = async (claims: Record<string, unknown>, options: { expired?: boolean } = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(options.expired ? now - 7200 : now)
    .setExpirationTime(options.expired ? now - 3600 : now + 3600)
    .sign(privateKey);
};

describe('googleIdentity', () => {
  it('accepts a valid token and reports the Google account id', async () => {
    const t = await token({
      iss: 'https://accounts.google.com',
      aud: OURS,
      sub: '1029384756',
      name: 'Ada Lovelace',
    });
    expect(await googleIdentity(t, OURS, keys).current()).toEqual({
      id: { value: '1029384756' },
      displayName: 'Ada Lovelace',
    });
  });

  it('refuses a token minted for a different site', async () => {
    // The check that is easy to leave out and must not be. Google signs tokens
    // for every application that uses it, so without this, anyone holding a
    // Google login for any site at all could submit here.
    const t = await token({ iss: 'https://accounts.google.com', aud: SOMEONE_ELSE, sub: '1' });
    expect(await googleIdentity(t, OURS, keys).current()).toBeNull();
  });

  it('refuses a token signed by someone other than Google', async () => {
    const t = await token({ iss: 'https://accounts.google.com', aud: OURS, sub: '1' });
    expect(await googleIdentity(t, OURS, wrongKeys).current()).toBeNull();
  });

  it('refuses an expired token', async () => {
    const t = await token({ iss: 'https://accounts.google.com', aud: OURS, sub: '1' }, { expired: true });
    expect(await googleIdentity(t, OURS, keys).current()).toBeNull();
  });

  it('refuses a token from the wrong issuer', async () => {
    const t = await token({ iss: 'https://accounts.evil.example', aud: OURS, sub: '1' });
    expect(await googleIdentity(t, OURS, keys).current()).toBeNull();
  });

  it('accepts both spellings of the Google issuer', async () => {
    // Google issues under both, and has for years. Accepting one rejects real
    // tokens depending on which Google chose — a bug that works when you test it.
    const t = await token({ iss: 'accounts.google.com', aud: OURS, sub: '77' });
    expect((await googleIdentity(t, OURS, keys).current())?.id.value).toBe('77');
  });

  it('refuses everything when no client id is configured', async () => {
    // A deployment that forgets the client id must authenticate nobody, rather
    // than verify against an empty audience and accept the world.
    const t = await token({ iss: 'https://accounts.google.com', aud: OURS, sub: '1' });
    expect(await googleIdentity(t, '', keys).current()).toBeNull();
  });

  it('refuses a token that is not a token', async () => {
    expect(await googleIdentity('not.a.jwt', OURS, keys).current()).toBeNull();
    expect(await googleIdentity(null, OURS, keys).current()).toBeNull();
    expect(await googleIdentity('', OURS, keys).current()).toBeNull();
  });

  it('falls back to a placeholder name rather than an empty one', async () => {
    const t = await token({ iss: 'https://accounts.google.com', aud: OURS, sub: '5', name: '  ' });
    expect((await googleIdentity(t, OURS, keys).current())?.displayName).toBe('Maker');
  });
});

describe('algorithm pinning', () => {
  it('refuses a token signed with a different algorithm', async () => {
    // The verifier decides the algorithm, never the token. A verifier that
    // trusts the header's `alg` is the shape of every substitution attack.
    const { SignJWT: Sign } = await import('jose');
    const secret = new Uint8Array(32).fill(7);
    const hmacToken = await new Sign({
      iss: 'https://accounts.google.com',
      aud: OURS,
      sub: '1',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    expect(await googleIdentity(hmacToken, OURS, async () => secret as never).current()).toBeNull();
  });
});
